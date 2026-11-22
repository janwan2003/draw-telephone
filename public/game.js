// Game page: join, write a starting phrase, take turns, wait, reveal, next round.
(function () {
  const id = location.pathname.split('/')[2] || '';
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  let auth = Store.get(id);
  let S = null;          // last state from the server
  let view = 'home';     // home | turn
  let turn = null;       // current claimed turn
  let skips = [];
  let pad = null;
  let pollTimer = null;
  let showAll = false;
  const shown = new Map(); // chainId -> number of steps revealed
  let pastReveal = null;   // { round, reveal } when looking at an older round
  const fresh = params.get('new') === '1';
  if (fresh) history.replaceState(null, '', location.pathname);

  const token = () => (auth && auth.token) || null;
  const link = () => location.origin + '/g/' + id;
  const inviteText = () => `Let's play Doodlechain: draw, guess and pass it on. Takes a minute, no app 🎨`;

  async function load() {
    try {
      S = await api('/groups/' + encodeURIComponent(id), { token: token() });
    } catch (e) {
      app.innerHTML = `<section class="card center"><h1>Game not found</h1><p>${esc(e.message)}</p><a class="btn primary" href="/">Start a new game</a></section>`;
      if (e.status === 404) Store.remove(id);
      return;
    }
    if (auth && !S.me) { Store.remove(id); auth = null; } // removed from the game
    if (S.me) Store.set(id, { ...auth, name: S.group.name, at: Date.now() });
    document.title = `${S.group.name} · Doodlechain`;
    if (view === 'home') render();
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!S || !S.me || S.round.status !== 'open') return;
    pollTimer = setTimeout(() => { if (view === 'home' && document.visibilityState === 'visible') load(); else schedulePoll(); }, 20000);
  }
  // Give a half-finished turn back if the page is closed, so the chain is not held up.
  window.addEventListener('pagehide', () => {
    if (view !== 'turn' || !turn || !token()) return;
    try {
      fetch(`/api/groups/${id}/release`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-member-token': token() }, body: JSON.stringify({ chainId: turn.chainId }) });
    } catch {}
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view === 'home' && S) load(); });

  // ---------- home ----------
  function headerHtml() {
    const r = S.round;
    const n = S.members.length;
    return `<section class="game-head">
      <p class="kicker">Round ${r.n} · ${n} ${n === 1 ? 'player' : 'players'}</p>
      <h1>${esc(S.group.name)}</h1>
      ${r.status === 'open' ? `<p class="sub">${r.revealAt ? `Reveal ${esc(fmtReveal(r.revealAt))}, or when everyone has played.` : 'Reveal when everyone has played.'}</p>` : ''}
    </section>`;
  }

  function inviteHtml(big) {
    return `<section class="card invite${big ? ' big' : ''}" id="inviteCard">
      <h2>${big ? 'Send this link to your group' : 'Invite more people'}</h2>
      ${big ? '<p>Paste it in your group chat. Friends tap it, pick a nickname and play. The more players, the funnier the chains.</p>' : ''}
      <div class="linkbox"><input readonly value="${esc(link())}" aria-label="Game link" id="linkInput"><button class="btn" data-act="copy">Copy</button></div>
      <button class="btn primary" data-act="share">Share link</button>
    </section>`;
  }

  function progressHtml() {
    const open = S.round.status === 'open';
    return `<section class="card players"><h2>Players</h2><ul class="plist">${S.members.map((m) => {
      let chip = '';
      if (open) chip = m.done ? '<span class="chip ok">done</span>' : m.turns ? `<span class="chip">${m.turns} played</span>` : '<span class="chip wait">not yet</span>';
      const kick = S.me.isHost && m.id !== S.me.id ? `<button class="link-btn" data-kick="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">remove</button>` : '';
      return `<li><span class="pname">${esc(m.name)}${m.isHost ? ' <small>host</small>' : ''}${m.id === S.me.id ? ' <small>you</small>' : ''}</span>${chip}${kick}</li>`;
    }).join('')}</ul></section>`;
  }

  // Re-rendering (poll every 20 s, coming back to the tab) must not wipe what the player is typing.
  const KEEP = ['startText', 'joinName', 'nrReveal', 'nrSteps'];
  function render() {
    const kept = {};
    for (const k of KEEP) { const el = document.getElementById(k); if (el) kept[k] = el.value; }
    const focused = document.activeElement && KEEP.includes(document.activeElement.id) ? document.activeElement.id : null;
    renderView();
    for (const k of KEEP) {
      const el = document.getElementById(k);
      if (el && kept[k] !== undefined && kept[k] !== '') el.value = kept[k];
    }
    if (focused) {
      const el = document.getElementById(focused);
      if (el) { el.focus({ preventScroll: true }); if (el.setSelectionRange && el.type !== 'select-one') try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
    }
  }

  function renderView() {
    clearTimeout(pollTimer);
    if (pad) { pad.destroy(); pad = null; }
    if (!S.me) return renderJoin();
    if (pastReveal) return renderPast();
    const r = S.round;
    let main = '';
    if (r.status === 'open') {
      const my = S.my;
      if (!my.started) {
        main = `<section class="card turn-card" id="startCard">
          <h2>Write something for others to draw</h2>
          <p>Your phrase starts a chain. Keep it short and drawable.</p>
          <form id="startForm" novalidate>
            <div class="inrow"><input id="startText" maxlength="80" placeholder="e.g. a penguin selling ice cream" autocomplete="off" aria-label="Your phrase">
            <button type="button" class="btn icon" id="dice" aria-label="Suggest a phrase" title="Suggest a phrase">🎲</button></div>
            <p class="error" id="startError" role="alert"></p>
            <button class="btn primary big" type="submit">Start my chain</button>
          </form>
        </section>`;
      } else if (my.available > 0) {
        main = `<section class="card turn-card ready" id="readyCard">
          <h2>Your turn</h2>
          <p>${my.available} ${my.available === 1 ? 'chain is' : 'chains are'} waiting for you. Each turn takes about a minute.</p>
          <button class="btn primary big" data-act="play">Play now</button>
        </section>`;
      } else {
        const waiting = S.members.filter((m) => !m.done).map((m) => esc(m.name));
        main = `<section class="card turn-card done" id="doneCard">
          <h2>You're all caught up</h2>
          <p>${my.waiting ? `${my.waiting} more ${my.waiting === 1 ? 'chain is' : 'chains are'} being played right now and will come to you. ` : ''}${waiting.length ? `Waiting for ${waiting.slice(0, 6).join(', ')}${waiting.length > 6 ? ` and ${waiting.length - 6} more` : ''}.` : 'Everyone has played.'} We'll show the reveal here${r.revealAt ? ` ${esc(fmtReveal(r.revealAt))} at the latest` : ''}.</p>
          <p class="fine">Nudge the group: the link preview in your chat shows how many have played.</p>
        </section>`;
      }
      if (S.me.isHost && r.chains > 0) {
        main += `<section class="card host"><h2>Host</h2><p>${r.steps} ${r.steps === 1 ? 'step' : 'steps'} played across ${r.chains} ${r.chains === 1 ? 'chain' : 'chains'}.</p>
          <button class="btn" data-act="reveal" ${r.chains ? '' : 'disabled'}>Reveal now</button></section>`;
      }
      app.innerHTML = headerHtml() + (fresh || S.members.length < 3 ? inviteHtml(true) + main : main) + progressHtml() + (fresh || S.members.length < 3 ? '' : inviteHtml(false)) + pastHtml() + footHtml();
    } else {
      app.innerHTML = headerHtml() + revealHtml(S.reveal, S.round.n, true) + nextRoundHtml() + progressHtml() + inviteHtml(false) + pastHtml() + footHtml();
      paintReveal();
    }
    bindHome();
    schedulePoll();
  }

  function pastHtml() {
    if (!S.pastRounds.length) return '';
    return `<section class="card"><h2>Earlier rounds</h2><ul class="rounds">${S.pastRounds.map((x) => `<li><button class="link-btn" data-past="${esc(x.id)}">Round ${x.n} reveal</button></li>`).join('')}</ul></section>`;
  }

  function footHtml() {
    return `<section class="card other"><h2>Got another group chat?</h2><p>Start a separate game for your family, friends or team.</p><a class="btn" href="/">Start a new game</a></section>
      <p class="tiny">${S.me.isHost ? '<button class="link-btn danger" data-act="delete">Delete this game</button>' : '<button class="link-btn" data-act="leave">Leave this game</button>'}</p>`;
  }

  function renderJoin() {
    const revealed = S.round.status === 'revealed';
    app.innerHTML = headerHtml() + `<section class="card join" id="joinCard">
      <h2>${revealed ? 'The reveal is ready' : 'Join the game'}</h2>
      <p>${revealed ? 'Join with a nickname to see how the chains turned out, and play the next round.' : 'Pick a nickname. You’ll write a phrase, then draw and guess on other chains, whenever you have a minute. No app, no sign-up.'}</p>
      <form id="joinForm" novalidate>
        <label for="joinName">Your nickname</label>
        <input id="joinName" maxlength="24" autocomplete="nickname" placeholder="e.g. Ben">
        <p class="error" id="joinError" role="alert"></p>
        <button class="btn primary big" type="submit">Join</button>
      </form>
      ${S.members.length ? `<p class="fine">Already playing: ${S.members.slice(0, 8).map((m) => esc(m.name)).join(', ')}${S.members.length > 8 ? '…' : ''}</p>` : ''}
    </section>` + `<section class="card how-mini"><h2>How it works</h2><ol><li>Write a phrase.</li><li>Draw the phrase you get, or guess the drawing you get.</li><li>See every chain at the reveal.</li></ol></section>`;
    document.getElementById('joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('joinName').value.trim();
      const errEl = document.getElementById('joinError');
      errEl.textContent = '';
      if (!name) { errEl.textContent = 'Enter your nickname.'; return; }
      const b = e.target.querySelector('button[type=submit]');
      b.disabled = true;
      try {
        const r = await api(`/groups/${id}/join`, { method: 'POST', body: { name } });
        auth = { token: r.token, memberId: r.memberId, name: S.group.name, at: Date.now() };
        Store.set(id, auth);
        await load();
      } catch (ex) { errEl.textContent = ex.message; b.disabled = false; }
    });
  }

  function bindHome() {
    app.querySelectorAll('[data-act=copy]').forEach((b) => b.addEventListener('click', async () => {
      if (await copyText(link())) toast('Link copied. Paste it in your group chat.');
    }));
    app.querySelectorAll('[data-act=share]').forEach((b) => b.addEventListener('click', () => shareLink(link(), inviteText())));
    const sf = document.getElementById('startForm');
    if (sf) {
      document.getElementById('dice').addEventListener('click', () => { document.getElementById('startText').value = randomPrompt(); });
      sf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = document.getElementById('startText').value.trim();
        const errEl = document.getElementById('startError');
        if (text.length < 2) { errEl.textContent = 'Write a few words, or tap 🎲 for an idea.'; return; }
        const b = sf.querySelector('button[type=submit]'); b.disabled = true;
        try {
          await api(`/groups/${id}/start`, { method: 'POST', token: token(), body: { text } });
          toast('Chain started!');
          await load();
          if (S.my && S.my.available > 0) play();
        } catch (ex) { errEl.textContent = ex.message; b.disabled = false; }
      });
    }
    const pb = app.querySelector('[data-act=play]');
    if (pb) pb.addEventListener('click', play);
    const rv = app.querySelector('[data-act=reveal]');
    if (rv) rv.addEventListener('click', async () => {
      if (!confirm('Reveal all chains now? Nobody can play this round after that.')) return;
      try { await api(`/groups/${id}/reveal`, { method: 'POST', token: token() }); await load(); } catch (ex) { toast(ex.message); }
    });
    app.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this player from the game? Their steps stay in the chains.')) return;
      try { await api(`/groups/${id}/kick`, { method: 'POST', token: token(), body: { memberId: b.dataset.kick } }); await load(); } catch (ex) { toast(ex.message); }
    }));
    app.querySelectorAll('[data-past]').forEach((b) => b.addEventListener('click', async () => {
      try { pastReveal = await api(`/groups/${id}/rounds/${b.dataset.past}`, { token: token() }); showAll = false; render(); scrollTo(0, 0); } catch (ex) { toast(ex.message); }
    }));
    const del = app.querySelector('[data-act=delete]');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Delete this game for everyone, with all drawings? This cannot be undone.')) return;
      try { await api(`/groups/${id}`, { method: 'DELETE', token: token() }); Store.remove(id); location.href = '/'; } catch (ex) { toast(ex.message); }
    });
    const lv = app.querySelector('[data-act=leave]');
    if (lv) lv.addEventListener('click', async () => {
      if (!confirm('Leave this game? Your steps stay in the chains.')) return;
      try { await api(`/groups/${id}/leave`, { method: 'POST', token: token() }); Store.remove(id); location.href = '/'; } catch (ex) { toast(ex.message); }
    });
    bindReveal();
    bindNextRound();
  }

  // ---------- turns ----------
  async function play() {
    view = 'turn';
    clearTimeout(pollTimer);
    app.innerHTML = '<section class="card center"><p>Finding your next turn…</p></section>';
    try {
      const r = await api(`/groups/${id}/turn?skip=${encodeURIComponent(skips.join(','))}`, { token: token() });
      turn = r.turn;
    } catch (ex) { turn = null; toast(ex.message); }
    if (!turn) { view = 'home'; skips = []; await load(); return; }
    renderTurn();
  }

  function renderTurn() {
    if (pad) { pad.destroy(); pad = null; }
    const t = turn;
    const top = `<div class="turn-top"><button class="link-btn" data-act="back">← ${esc(S.group.name)}</button><span class="kicker">Step ${t.stepOf} of ${t.maxSteps}</span></div>`;
    if (t.need === 'draw') {
      app.innerHTML = top + `<section class="turn" id="turnDraw">
        <p class="label">Draw this</p>
        <p class="phrase" id="phrase">${esc(t.prev.body)}</p>
        <div id="pad"></div>
        <p class="fine">No letters or words in the drawing. That's cheating!</p>
        <div class="turn-actions"><button class="btn" data-act="skip">Skip</button><button class="btn primary big" data-act="submit" disabled>Pass it on</button></div>
      </section>`;
      pad = new DrawPad(document.getElementById('pad'));
      const sb = app.querySelector('[data-act=submit]');
      pad.onchange = () => { sb.disabled = pad.isEmpty(); };
    } else {
      app.innerHTML = top + `<section class="turn" id="turnGuess">
        <p class="label">What is this?</p>
        <div class="guess-art" id="guessArt"></div>
        <form id="guessForm" novalidate>
          <input id="guessText" maxlength="80" placeholder="Describe the drawing" autocomplete="off" aria-label="Your guess">
          <p class="error" id="guessError" role="alert"></p>
          <div class="turn-actions"><button type="button" class="btn" data-act="skip">Skip</button><button class="btn primary big" type="submit" data-act="submit">Pass it on</button></div>
        </form>
      </section>`;
      document.getElementById('guessArt').appendChild(drawingCanvas(t.prev.body, { animate: true, label: 'Drawing to guess' }));
      document.getElementById('guessForm').addEventListener('submit', (e) => { e.preventDefault(); submitTurn(); });
    }
    if (t.need === 'draw') app.querySelector('[data-act=submit]').addEventListener('click', submitTurn);
    app.querySelector('[data-act=skip]').addEventListener('click', async () => {
      skips.push(t.chainId);
      api(`/groups/${id}/release`, { method: 'POST', token: token(), body: { chainId: t.chainId } }).catch(() => {});
      play();
    });
    app.querySelector('[data-act=back]').addEventListener('click', () => {
      if (t.need === 'draw' && pad && !pad.isEmpty() && !confirm('Leave without passing your drawing on? It will be lost.')) return;
      api(`/groups/${id}/release`, { method: 'POST', token: token(), body: { chainId: t.chainId } }).catch(() => {});
      view = 'home'; turn = null; load();
    });
    scrollTo(0, 0);
  }

  async function submitTurn() {
    const t = turn;
    const body = { chainId: t.chainId, idx: t.idx };
    if (t.need === 'draw') {
      if (pad.isEmpty()) return;
      body.drawing = pad.value();
    } else {
      const v = document.getElementById('guessText').value.trim();
      if (v.length < 2) { document.getElementById('guessError').textContent = 'Type your guess (at least 2 letters).'; return; }
      body.text = v;
    }
    const sb = app.querySelector('[data-act=submit]');
    sb.disabled = true; sb.textContent = 'Passing…';
    try {
      const r = await api(`/groups/${id}/turn`, { method: 'POST', token: token(), body });
      toast('Passed on!');
      if (r.revealed) { view = 'home'; await load(); scrollTo(0, 0); return; }
      play();
    } catch (ex) {
      sb.disabled = false; sb.textContent = 'Pass it on';
      if (ex.status === 409) { toast(ex.message); skips.push(t.chainId); play(); }
      else toast(ex.message);
    }
  }

  // ---------- reveal ----------
  function revealHtml(chains, n, current) {
    if (!chains || !chains.length) return `<section class="card"><h2>Round ${n} reveal</h2><p>Nobody played this round.</p></section>`;
    return `<section class="reveal" id="reveal">
      <div class="reveal-head"><h2>Round ${n}: the reveal</h2><button class="link-btn" data-act="showall">${showAll ? 'Step by step' : 'Show everything'}</button></div>
      ${chains.map((c, i) => {
        const k = showAll ? c.steps.length : Math.min(c.steps.length, shown.get(c.id) || 1);
        const steps = c.steps.slice(0, k).map((s) => stepHtml(c, s, current)).join('');
        const more = k < c.steps.length;
        return `<article class="card chain" data-chain="${esc(c.id)}">
          <h3>Chain ${i + 1} <small>started by ${esc(c.starter)}</small></h3>
          <div class="chain-steps">${steps}</div>
          ${more ? `<button class="btn primary" data-next="${esc(c.id)}">Show next (${k}/${c.steps.length})</button>`
            : `<div class="chain-end"><span class="kicker">${describeEnd(c)}</span><button class="btn" data-save="${esc(c.id)}">Save as image</button></div>`}
        </article>`;
      }).join('')}
    </section>`;
  }

  function describeEnd(c, raw) {
    const first = c.steps[0];
    const last = [...c.steps].reverse().find((s) => s.kind === 'text' && !s.removed);
    if (!first || !last || last === first || first.removed) return 'The end';
    const e = raw ? (x) => x : esc;
    return `“${e(first.body)}” became “${e(last.body)}”`;
  }

  function stepHtml(c, s, current) {
    const rm = current && showAll && S.me && S.me.isHost && !s.removed ? `<button class="link-btn" data-rm="${esc(c.id)}:${s.idx}" aria-label="Remove this step">remove</button>` : '';
    if (s.removed) return `<div class="step removed"><small>${esc(s.by)}</small><p>Removed by the host</p></div>`;
    if (s.kind === 'text') return `<div class="step text"><small>${s.idx === 0 ? esc(s.by) + ' wrote' : esc(s.by) + ' guessed'} ${rm}</small><p>${esc(s.body)}</p></div>`;
    return `<div class="step draw"><small>${esc(s.by)} drew ${rm}</small><div class="art" data-art="${esc(c.id)}:${s.idx}"></div></div>`;
  }

  let lastAnimated = null;
  function paintReveal() {
    const chains = pastReveal ? pastReveal.reveal : S.reveal;
    if (!chains) return;
    app.querySelectorAll('[data-art]').forEach((el) => {
      const [cid, idx] = el.dataset.art.split(':');
      const c = chains.find((x) => x.id === cid);
      const s = c && c.steps.find((x) => x.idx === +idx);
      if (!s) return;
      el.appendChild(drawingCanvas(s.body, { animate: lastAnimated === el.dataset.art, label: `Drawing by ${s.by}` }));
    });
    lastAnimated = null;
  }

  function bindReveal() {
    const chains = pastReveal ? pastReveal.reveal : S.reveal;
    app.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => {
      const c = chains.find((x) => x.id === b.dataset.next);
      const k = Math.min(c.steps.length, (shown.get(c.id) || 1) + 1);
      shown.set(c.id, k);
      const s = c.steps[k - 1];
      lastAnimated = `${c.id}:${s.idx}`;
      const y = b.getBoundingClientRect().top;
      render();
      const nb = app.querySelector(`[data-chain="${c.id}"] [data-next], [data-chain="${c.id}"] .chain-end`);
      if (nb) scrollBy(0, nb.getBoundingClientRect().top - y);
    }));
    const sa = app.querySelector('[data-act=showall]');
    if (sa) sa.addEventListener('click', () => { showAll = !showAll; render(); });
    const roundN = pastReveal ? pastReveal.round.n : S.round.n;
    app.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await saveChain(chains.find((x) => x.id === b.dataset.save), roundN); } catch { toast('Could not make the image. Try again.'); }
      b.disabled = false;
    }));
    app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this step for everyone?')) return;
      const [chainId, idx] = b.dataset.rm.split(':');
      try { await api(`/groups/${id}/remove-step`, { method: 'POST', token: token(), body: { chainId, idx: +idx } }); await load(); } catch (ex) { toast(ex.message); }
    }));
    const back = app.querySelector('[data-act=backpast]');
    if (back) back.addEventListener('click', () => { pastReveal = null; render(); });
  }

  function renderPast() {
    app.innerHTML = `<div class="turn-top"><button class="link-btn" data-act="backpast">← Back to round ${S.round.n}</button></div>` + revealHtml(pastReveal.reveal, pastReveal.round.n, false);
    paintReveal();
    bindReveal();
  }

  function nextRoundHtml() {
    return `<section class="card next-round" id="nextRound">
      <h2>Play again?</h2>
      <p>Start round ${S.round.n + 1} on the same link. Everyone in the group can play right away.</p>
      <div class="row2">
        <div><label for="nrReveal">Reveal</label><select id="nrReveal">
          <option value="all">When all have played</option><option value="tonight">Tonight, 9 pm</option><option value="tomorrow">Tomorrow, 9 pm</option><option value="3days">In 3 days</option></select></div>
        <div><label for="nrSteps">Chain length</label><select id="nrSteps">
          <option value="4">4 steps (short)</option><option value="6" ${S.round.maxSteps === 6 ? 'selected' : ''}>6 steps</option><option value="8" ${S.round.maxSteps === 8 ? 'selected' : ''}>8 steps (long)</option></select></div>
      </div>
      <button class="btn primary big" data-act="nextround">Start round ${S.round.n + 1}</button>
    </section>`;
  }

  function bindNextRound() {
    const b = app.querySelector('[data-act=nextround]');
    if (!b) return;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await api(`/groups/${id}/rounds`, { method: 'POST', token: token(), body: {
          revealAt: revealChoice(document.getElementById('nrReveal').value), steps: +document.getElementById('nrSteps').value,
        } });
        toast(`Round ${S.round.n + 1} started. Tell the group!`);
      } catch (ex) { toast(ex.message); }
      shown.clear(); showAll = false;
      await load();
      scrollTo(0, 0);
    });
  }

  // ---------- share image ----------
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  async function saveChain(c, roundN) {
    const W = 1080, pad = 60, art = W - pad * 2;
    const lines = (ctx, text, max) => {
      const words = text.split(' '); const out = []; let cur = '';
      for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; }
      if (cur) out.push(cur); return out;
    };
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const font = (wt, px) => `${wt} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const icon = await loadImg('/icon.svg');
    const ending = describeEnd(c, true);
    // measure
    let h = 200;
    const blocks = [];
    ctx.font = font(700, 52);
    for (const s of c.steps) {
      if (s.removed) continue;
      if (s.kind === 'text') { const ls = lines(ctx, s.body, art - 60); blocks.push({ s, ls, h: 70 + ls.length * 62 + 30 }); }
      else blocks.push({ s, h: 50 + art + 30 });
    }
    for (const b of blocks) h += b.h + 24;
    ctx.font = font(700, 40);
    const endLines = ending === 'The end' ? [] : lines(ctx, ending, art - 60);
    if (endLines.length) h += 40 + endLines.length * 52 + 40 + 24;
    h += 120;
    cv.width = W; cv.height = h;
    ctx.fillStyle = '#fff8ee'; ctx.fillRect(0, 0, W, h);
    if (icon) ctx.drawImage(icon, pad, 44, 76, 76);
    const tx = icon ? pad + 96 : pad;
    ctx.fillStyle = '#1d1b2e'; ctx.font = font(800, 50); ctx.fillText('Doodlechain', tx, 94);
    ctx.fillStyle = '#6b6680'; ctx.font = font(500, 30);
    const sub = `${S.group.name} · Round ${roundN} · started by ${c.starter}`;
    ctx.fillText(sub.length > 58 ? sub.slice(0, 57) + '…' : sub, tx, 134);
    let y = 200;
    for (const b of blocks) {
      ctx.fillStyle = '#6b6680'; ctx.font = font(600, 30);
      ctx.fillText(b.s.kind === 'text' ? (b.s.idx === 0 ? `${b.s.by} wrote` : `${b.s.by} guessed`) : `${b.s.by} drew`, pad, y + 34);
      if (b.s.kind === 'text') {
        ctx.fillStyle = '#ffffff'; roundRect(ctx, pad, y + 52, art, b.h - 52, 28); ctx.fill();
        ctx.strokeStyle = '#ece3d4'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#1d1b2e'; ctx.font = font(700, 52);
        b.ls.forEach((l, i) => ctx.fillText(l, pad + 30, y + 52 + 70 + i * 62));
      } else {
        ctx.save(); roundRect(ctx, pad, y + 50, art, art, 28); ctx.clip();
        renderDrawing(ctx, b.s.body, art, pad, y + 50); ctx.restore();
        ctx.strokeStyle = '#ece3d4'; ctx.lineWidth = 3; roundRect(ctx, pad, y + 50, art, art, 28); ctx.stroke();
      }
      y += b.h + 24;
    }
    if (endLines.length) {
      const bh = 40 + endLines.length * 52 + 40;
      ctx.fillStyle = '#ffd23f'; roundRect(ctx, pad, y, art, bh, 28); ctx.fill();
      ctx.fillStyle = '#1d1b2e'; ctx.font = font(700, 40);
      endLines.forEach((l, i) => ctx.fillText(l, pad + 30, y + 40 + 38 + i * 52));
      y += bh + 24;
    }
    ctx.fillStyle = '#e2443a'; ctx.font = font(700, 34);
    ctx.fillText('Play it in your group chat: ' + location.host, pad, h - 56);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('no image');
    const file = new File([blob], 'doodlechain.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: ending === 'The end' ? 'Doodlechain' : ending }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    showImage(blob);
  }

  // Fallback when the browser cannot share files (desktop, most in-app browsers): show the image
  // with a download button; on phones a long press on the image saves it.
  function showImage(blob) {
    const url = URL.createObjectURL(blob);
    const touch = matchMedia('(pointer: coarse)').matches;
    const el = document.createElement('div');
    el.className = 'sheet';
    el.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <h2 id="sheetTitle">Your chain as an image</h2>
      <img src="${url}" alt="The whole chain as one image">
      <p class="fine">${touch ? 'If the download does nothing, press and hold the image and choose Save or Share.' : 'Download it, then send it to your group or post it anywhere.'}</p>
      <div class="sheet-actions"><button type="button" class="btn" data-close>Close</button><a class="btn primary" href="${url}" download="doodlechain.png" data-download>Download image</a></div>
    </div>`;
    const prevFocus = document.activeElement;
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); document.body.classList.remove('noscroll'); setTimeout(() => URL.revokeObjectURL(url), 60000); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
    el.querySelector('[data-download]').addEventListener('click', () => setTimeout(() => toast('Image saved.'), 300));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    document.body.classList.add('noscroll');
    el.querySelector('[data-download]').focus();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  load();
})();
