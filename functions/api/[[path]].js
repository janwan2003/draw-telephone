import {
  DEFAULT_STEPS, STEP_OPTIONS, MAX_MEMBERS, LOCK_SECONDS,
  nextKind, validateDrawing, validateText, pickChain, roundComplete,
} from '../_game.js';

const LIMITS = {
  create: [20, 3600],   // new groups per IP per hour
  join: [60, 3600],     // joins per IP per hour
  turn: [400, 3600],    // turn fetches + submits per IP per hour
  write: [200, 3600],   // other writes per IP per hour
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const err = (status, message) => json({ error: message }, status);
const now = () => Math.floor(Date.now() / 1000);

function randomId(len = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clean(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function rateLimit(env, request, action) {
  const [max, windowSec] = LIMITS[action];
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate (k, n, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN reset_at < ?3 THEN 1 ELSE n + 1 END,
       reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
     RETURNING n`
  ).bind(action + ':' + ip, t + windowSec, t).first();
  return row && row.n > max;
}

// Groups with no activity for 90 days are deleted, with everything in them.
async function cleanup(env) {
  const t = now();
  const old = t - 90 * 86400;
  const sub = 'SELECT id FROM groups WHERE active_at < ?1';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM steps WHERE chain_id IN (SELECT c.id FROM chains c JOIN rounds r ON r.id = c.round_id WHERE r.group_id IN (${sub}))`).bind(old),
    env.DB.prepare(`DELETE FROM chains WHERE round_id IN (SELECT id FROM rounds WHERE group_id IN (${sub}))`).bind(old),
    env.DB.prepare(`DELETE FROM rounds WHERE group_id IN (${sub})`).bind(old),
    env.DB.prepare(`DELETE FROM members WHERE group_id IN (${sub})`).bind(old),
    env.DB.prepare('DELETE FROM groups WHERE active_at < ?1').bind(old),
    env.DB.prepare('DELETE FROM rate WHERE reset_at < ?1').bind(t),
  ]);
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (text.length > 80000) return null;
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function revealAtFrom(body, t) {
  const v = Number(body.revealAt);
  if (!v || !Number.isFinite(v)) return null; // null = reveal when everyone has played
  return Math.max(t + 300, Math.min(t + 14 * 86400, Math.round(v)));
}
const stepsFrom = (body) => (STEP_OPTIONS.includes(Number(body.steps)) ? Number(body.steps) : DEFAULT_STEPS);

async function me(env, request, groupId) {
  const tok = request.headers.get('x-member-token');
  if (!tok || tok.length > 100) return null;
  const m = await env.DB.prepare('SELECT * FROM members WHERE token_hash = ?1').bind(await sha256(tok)).first();
  return m && m.group_id === groupId ? m : null;
}

async function newMember(env, groupId, name, isHost) {
  const token = randomId(24);
  const id = randomId(10);
  const stmt = env.DB.prepare(
    'INSERT INTO members (id, group_id, name, token_hash, is_host, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(id, groupId, name, await sha256(token), isHost ? 1 : 0, now());
  return { id, token, stmt };
}

// Everything about the current round needed to assign turns and decide the reveal.
async function roundData(env, round) {
  const [chains, steps] = await Promise.all([
    env.DB.prepare('SELECT id, starter_id, len, lock_member, lock_until, updated_at FROM chains WHERE round_id = ?1').bind(round.id).all(),
    env.DB.prepare('SELECT s.chain_id, s.member_id FROM steps s JOIN chains c ON c.id = s.chain_id WHERE c.round_id = ?1').bind(round.id).all(),
  ]);
  const playedBy = new Map();
  const byMember = new Map();
  for (const s of steps.results) {
    if (!playedBy.has(s.chain_id)) playedBy.set(s.chain_id, new Set());
    playedBy.get(s.chain_id).add(s.member_id);
    if (!byMember.has(s.member_id)) byMember.set(s.member_id, new Set());
    byMember.get(s.member_id).add(s.chain_id);
  }
  return { chains: chains.results, playedBy, byMember, totalSteps: steps.results.length };
}

// Reveal the round if its time has come or everyone has played everything.
async function maybeReveal(env, round, members, data) {
  if (round.status !== 'open') return round;
  const t = now();
  const due = round.reveal_at && t >= round.reveal_at;
  const done = roundComplete(data.chains, members.map((m) => m.id), data.playedBy, round.max_steps);
  if (!due && !done) return round;
  await env.DB.prepare("UPDATE rounds SET status = 'revealed', revealed_at = ?2 WHERE id = ?1 AND status = 'open'").bind(round.id, t).run();
  return { ...round, status: 'revealed', revealed_at: t };
}

async function loadGroup(env, id) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(id)) return null;
  return env.DB.prepare('SELECT * FROM groups WHERE id = ?1').bind(id).first();
}

async function revealData(env, roundId, members) {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const [chains, steps] = await Promise.all([
    env.DB.prepare('SELECT id, starter_id FROM chains WHERE round_id = ?1 ORDER BY rowid').bind(roundId).all(),
    env.DB.prepare('SELECT s.chain_id, s.idx, s.member_id, s.kind, s.body, s.removed FROM steps s JOIN chains c ON c.id = s.chain_id WHERE c.round_id = ?1 ORDER BY s.idx').bind(roundId).all(),
  ]);
  const map = new Map(chains.results.map((c) => [c.id, { id: c.id, starter: names.get(c.starter_id) || 'Someone', steps: [] }]));
  for (const s of steps.results) {
    const c = map.get(s.chain_id);
    if (!c) continue;
    c.steps.push({
      idx: s.idx,
      by: names.get(s.member_id) || 'Someone who left',
      kind: s.kind,
      body: s.removed ? null : s.kind === 'draw' ? JSON.parse(s.body) : s.body,
      removed: !!s.removed,
    });
  }
  return [...map.values()].filter((c) => c.steps.length > 0);
}

async function state(env, group, member) {
  const [membersRes, round, rounds] = await Promise.all([
    env.DB.prepare('SELECT id, name, is_host, created_at FROM members WHERE group_id = ?1 ORDER BY created_at').bind(group.id).all(),
    env.DB.prepare('SELECT * FROM rounds WHERE id = ?1').bind(group.round_id).first(),
    env.DB.prepare("SELECT id, n, revealed_at FROM rounds WHERE group_id = ?1 AND status = 'revealed' ORDER BY n DESC LIMIT 30").bind(group.id).all(),
  ]);
  const members = membersRes.results;
  const data = await roundData(env, round);
  const r = await maybeReveal(env, round, members, data);
  const t = now();
  const open = r.status === 'open';
  const remainingFor = (mid) => {
    const played = data.byMember.get(mid) || new Set();
    let free = 0, busy = 0;
    for (const c of data.chains) {
      if (played.has(c.id) || c.len >= r.max_steps) continue;
      if (c.lock_member && c.lock_member !== mid && c.lock_until >= t) busy++;
      else free++;
    }
    return { free, busy, played: played.size, started: data.chains.some((c) => c.starter_id === mid) };
  };
  const out = {
    group: { id: group.id, name: group.name },
    me: member ? { id: member.id, name: member.name, isHost: !!member.is_host } : null,
    members: members.map((m) => {
      const rem = remainingFor(m.id);
      return { id: m.id, name: m.name, isHost: !!m.is_host, turns: rem.played, done: rem.started && rem.free + rem.busy === 0 };
    }),
    round: {
      id: r.id, n: r.n, status: r.status, revealAt: r.reveal_at, maxSteps: r.max_steps,
      chains: data.chains.length, steps: data.totalSteps, revealedAt: r.revealed_at || null,
    },
    pastRounds: rounds.results.filter((x) => x.id !== r.id).map((x) => ({ id: x.id, n: x.n })),
    now: t,
  };
  if (member) {
    const rem = remainingFor(member.id);
    out.my = { started: rem.started, available: open ? rem.free : 0, waiting: open ? rem.busy : 0, played: rem.played };
    if (!open) out.reveal = await revealData(env, r.id, members);
  }
  return out;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const method = request.method;
  try {
    if (Math.random() < 0.02) context.waitUntil(cleanup(env).catch(() => {}));

    // POST /api/groups -> create a group, its first round and the host member
    if (parts[0] === 'groups' && parts.length === 1 && method === 'POST') {
      if (await rateLimit(env, request, 'create')) return err(429, 'Too many new games from this network. Try again in an hour.');
      const body = await readBody(request);
      if (!body) return err(400, 'Bad request.');
      const name = clean(body.name, 50);
      const host = clean(body.host, 24);
      if (!name) return err(400, 'Give your game a name, e.g. "Smith family".');
      if (!host) return err(400, 'Enter your nickname.');
      const t = now();
      const id = randomId(8);
      const roundId = randomId(10);
      const m = await newMember(env, id, host, true);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO groups (id, name, round_id, created_at, active_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(id, name, roundId, t),
        env.DB.prepare('INSERT INTO rounds (id, group_id, n, status, reveal_at, max_steps, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)')
          .bind(roundId, id, 'open', revealAtFrom(body, t), stepsFrom(body), t),
        m.stmt,
      ]);
      return json({ id, token: m.token, memberId: m.id }, 201);
    }

    if (parts[0] !== 'groups' || !parts[1]) return err(404, 'Not found.');
    const group = await loadGroup(env, parts[1]);
    if (!group) return err(404, 'This game no longer exists. It may have been deleted.');
    const sub = parts[2] || '';
    const member = await me(env, request, group.id);
    const touch = () => env.DB.prepare('UPDATE groups SET active_at = ?2 WHERE id = ?1').bind(group.id, now()).run();

    // GET /api/groups/:id
    if (!sub && method === 'GET') return json(await state(env, group, member));

    // POST /api/groups/:id/join
    if (sub === 'join' && method === 'POST') {
      if (await rateLimit(env, request, 'join')) return err(429, 'Too many joins from this network. Try again later.');
      const body = await readBody(request);
      const name = clean(body && body.name, 24);
      if (!name) return err(400, 'Enter your nickname.');
      const list = (await env.DB.prepare('SELECT name FROM members WHERE group_id = ?1').bind(group.id).all()).results;
      if (list.length >= MAX_MEMBERS) return err(409, `This game is full (${MAX_MEMBERS} players).`);
      if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) return err(409, 'Someone already uses that nickname here. Pick another.');
      const m = await newMember(env, group.id, name, false);
      await m.stmt.run();
      await touch();
      return json({ token: m.token, memberId: m.id }, 201);
    }

    if (!member) return err(401, 'Join the game first.');
    const round = await env.DB.prepare('SELECT * FROM rounds WHERE id = ?1').bind(group.round_id).first();
    const t = now();

    // POST /api/groups/:id/start  { text } -> my starting phrase for this round
    if (sub === 'start' && method === 'POST') {
      if (await rateLimit(env, request, 'turn')) return err(429, 'Slow down a little and try again.');
      if (round.status !== 'open') return err(409, 'This round is over. Start a new one.');
      const body = await readBody(request);
      const text = validateText(body && body.text);
      if (!text) return err(400, 'Write a few words for others to draw.');
      const existing = await env.DB.prepare('SELECT id FROM chains WHERE round_id = ?1 AND starter_id = ?2').bind(round.id, member.id).first();
      if (existing) return err(409, 'You already started a chain this round.');
      const chainId = randomId(10);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO chains (id, round_id, starter_id, len, updated_at) VALUES (?1, ?2, ?3, 1, ?4)').bind(chainId, round.id, member.id, t),
        env.DB.prepare("INSERT INTO steps (chain_id, idx, member_id, kind, body, created_at) VALUES (?1, 0, ?2, 'text', ?3, ?4)").bind(chainId, member.id, text, t),
      ]);
      await touch();
      return json({ ok: true }, 201);
    }

    // GET /api/groups/:id/turn?skip=a,b -> claim the next turn (shows only the previous step)
    if (sub === 'turn' && method === 'GET') {
      if (await rateLimit(env, request, 'turn')) return err(429, 'Slow down a little and try again.');
      if (round.status !== 'open') return json({ turn: null, reason: 'revealed' });
      const skip = new Set((new URL(request.url).searchParams.get('skip') || '').split(',').filter(Boolean).slice(0, 40));
      const data = await roundData(env, round);
      const played = data.byMember.get(member.id) || new Set();
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = pickChain(data.chains, member.id, played, skip, t, round.max_steps);
        if (!c) return json({ turn: null, reason: data.chains.some((x) => x.lock_until >= t && !played.has(x.id) && x.len < round.max_steps) ? 'busy' : 'none' });
        // Claim the lock only if nobody else grabbed it meanwhile.
        const res = await env.DB.prepare(
          'UPDATE chains SET lock_member = ?2, lock_until = ?3 WHERE id = ?1 AND len = ?4 AND (lock_member IS NULL OR lock_member = ?2 OR lock_until < ?5)'
        ).bind(c.id, member.id, t + LOCK_SECONDS, c.len, t).run();
        if (!res.meta.changes) { data.chains = data.chains.filter((x) => x.id !== c.id); continue; }
        const prev = await env.DB.prepare('SELECT kind, body FROM steps WHERE chain_id = ?1 AND idx = ?2').bind(c.id, c.len - 1).first();
        return json({
          turn: {
            chainId: c.id, idx: c.len, need: nextKind(prev.kind), lockUntil: t + LOCK_SECONDS,
            prev: { kind: prev.kind, body: prev.kind === 'draw' ? JSON.parse(prev.body) : prev.body },
            stepOf: c.len + 1, maxSteps: round.max_steps,
          },
        });
      }
      return json({ turn: null, reason: 'busy' });
    }

    // POST /api/groups/:id/turn { chainId, idx, text | drawing }
    if (sub === 'turn' && method === 'POST') {
      if (await rateLimit(env, request, 'turn')) return err(429, 'Slow down a little and try again.');
      if (round.status !== 'open') return err(409, 'Too late, this round has been revealed.');
      const body = await readBody(request);
      if (!body) return err(400, 'That drawing is too big. Try fewer scribbles.');
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?1 AND round_id = ?2').bind(String(body.chainId || ''), round.id).first();
      if (!chain) return err(404, 'That chain is gone.');
      if (chain.len !== Number(body.idx)) return err(409, 'Someone else played this chain first. Take the next one.');
      if (chain.lock_member && chain.lock_member !== member.id && chain.lock_until >= t) return err(409, 'Someone else is playing this chain right now.');
      if (chain.len >= round.max_steps) return err(409, 'This chain is already full.');
      const mine = await env.DB.prepare('SELECT 1 FROM steps WHERE chain_id = ?1 AND member_id = ?2').bind(chain.id, member.id).first();
      if (mine) return err(409, 'You already played this chain.');
      const prev = await env.DB.prepare('SELECT kind FROM steps WHERE chain_id = ?1 AND idx = ?2').bind(chain.id, chain.len - 1).first();
      const kind = nextKind(prev.kind);
      const stored = kind === 'draw' ? validateDrawing(body.drawing) : validateText(body.text);
      if (!stored) return err(400, kind === 'draw' ? 'Draw something first.' : 'Type your guess (at least 2 letters).');
      const ins = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO steps (chain_id, idx, member_id, kind, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(chain.id, chain.len, member.id, kind, stored, t),
        env.DB.prepare('UPDATE chains SET len = len + 1, lock_member = NULL, lock_until = 0, updated_at = ?3 WHERE id = ?1 AND len = ?2')
          .bind(chain.id, chain.len, t),
      ]);
      if (!ins[0].meta.changes) return err(409, 'Someone else played this chain first. Take the next one.');
      await touch();
      const members = (await env.DB.prepare('SELECT id FROM members WHERE group_id = ?1').bind(group.id).all()).results;
      const r = await maybeReveal(env, round, members, await roundData(env, round));
      return json({ ok: true, revealed: r.status === 'revealed' }, 201);
    }

    // POST /api/groups/:id/release { chainId } -> give a claimed turn back (skip)
    if (sub === 'release' && method === 'POST') {
      const body = await readBody(request);
      await env.DB.prepare('UPDATE chains SET lock_member = NULL, lock_until = 0 WHERE id = ?1 AND lock_member = ?2').bind(String((body && body.chainId) || ''), member.id).run();
      return json({ ok: true });
    }

    // POST /api/groups/:id/rounds { revealAt, steps } -> start the next round (anyone, after a reveal)
    if (sub === 'rounds' && parts.length === 3 && method === 'POST') {
      if (await rateLimit(env, request, 'write')) return err(429, 'Too many changes. Try again later.');
      if (round.status !== 'revealed') return err(409, 'Finish this round first.');
      const body = (await readBody(request)) || {};
      const id = randomId(10);
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO rounds (id, group_id, n, status, reveal_at, max_steps, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
          .bind(id, group.id, round.n + 1, 'open', revealAtFrom(body, t), stepsFrom(body), t),
        env.DB.prepare('UPDATE groups SET round_id = ?2, active_at = ?3 WHERE id = ?1 AND round_id = ?4').bind(group.id, id, t, round.id),
      ]);
      if (!res[1].meta.changes) {
        await env.DB.prepare('DELETE FROM rounds WHERE id = ?1').bind(id).run();
        return err(409, 'Someone just started the next round. Reloading.');
      }
      return json({ ok: true, roundId: id }, 201);
    }

    // GET /api/groups/:id/rounds/:rid -> a past round's reveal
    if (sub === 'rounds' && parts[3] && method === 'GET') {
      const r = await env.DB.prepare("SELECT id, n FROM rounds WHERE id = ?1 AND group_id = ?2 AND status = 'revealed'").bind(parts[3], group.id).first();
      if (!r) return err(404, 'Round not found.');
      const members = (await env.DB.prepare('SELECT id, name FROM members WHERE group_id = ?1').bind(group.id).all()).results;
      return json({ round: r, reveal: await revealData(env, r.id, members) });
    }

    // POST /api/groups/:id/leave -> remove myself
    if (sub === 'leave' && method === 'POST') {
      if (member.is_host) return err(400, 'The host cannot leave. Delete the game instead.');
      await env.DB.prepare('DELETE FROM members WHERE id = ?1').bind(member.id).run();
      return json({ ok: true });
    }

    // ---- host only ----
    if (!member.is_host) return err(403, 'Only the host can do that.');

    // POST /api/groups/:id/reveal -> reveal now
    if (sub === 'reveal' && method === 'POST') {
      if (round.status !== 'open') return json({ ok: true });
      const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM chains WHERE round_id = ?1').bind(round.id).first();
      if (!c.n) return err(409, 'Nobody has played yet.');
      await env.DB.prepare("UPDATE rounds SET status = 'revealed', revealed_at = ?2 WHERE id = ?1").bind(round.id, t).run();
      await touch();
      return json({ ok: true });
    }

    // POST /api/groups/:id/remove-step { chainId, idx } -> hide a step (after the reveal)
    if (sub === 'remove-step' && method === 'POST') {
      const body = (await readBody(request)) || {};
      const res = await env.DB.prepare(
        `UPDATE steps SET removed = 1, body = '' WHERE chain_id = ?1 AND idx = ?2 AND chain_id IN
         (SELECT c.id FROM chains c JOIN rounds r ON r.id = c.round_id WHERE r.group_id = ?3 AND r.status = 'revealed')`
      ).bind(String(body.chainId || ''), Number(body.idx), group.id).run();
      if (!res.meta.changes) return err(404, 'Step not found (you can remove steps after the reveal).');
      return json({ ok: true });
    }

    // POST /api/groups/:id/kick { memberId }
    if (sub === 'kick' && method === 'POST') {
      const body = (await readBody(request)) || {};
      if (body.memberId === member.id) return err(400, 'You cannot remove yourself.');
      await env.DB.prepare('DELETE FROM members WHERE id = ?1 AND group_id = ?2').bind(String(body.memberId || ''), group.id).run();
      return json({ ok: true });
    }

    // DELETE /api/groups/:id -> delete everything
    if (!sub && method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM steps WHERE chain_id IN (SELECT c.id FROM chains c JOIN rounds r ON r.id = c.round_id WHERE r.group_id = ?1)').bind(group.id),
        env.DB.prepare('DELETE FROM chains WHERE round_id IN (SELECT id FROM rounds WHERE group_id = ?1)').bind(group.id),
        env.DB.prepare('DELETE FROM rounds WHERE group_id = ?1').bind(group.id),
        env.DB.prepare('DELETE FROM members WHERE group_id = ?1').bind(group.id),
        env.DB.prepare('DELETE FROM groups WHERE id = ?1').bind(group.id),
      ]);
      return json({ ok: true });
    }

    return err(404, 'Not found.');
  } catch (e) {
    console.error(e);
    return err(500, 'Something went wrong on our side. Try again.');
  }
}
