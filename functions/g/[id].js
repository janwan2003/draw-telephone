// Serves the game page with a link preview (Open Graph) that shows live state,
// e.g. "Smith family · Doodlechain" / "Round 2 · 4 of 7 have played · reveal at the end of the day".
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function untilText(ts, now) {
  const h = Math.round((ts - now) / 3600);
  if (h <= 1) return 'reveal within the hour';
  if (h < 36) return `reveal in ${h} hours`;
  return `reveal in ${Math.round(h / 24)} days`;
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/g', url.origin));
  let html = await page.text();
  let title = 'Join our drawing game · Doodlechain';
  let desc = 'Draw, guess and pass it on. Takes a minute, no app, no sign-up.';
  try {
    const id = String(params.id || '');
    if (/^[A-Za-z0-9]{6,16}$/.test(id)) {
      const g = await env.DB.prepare('SELECT g.name, r.id AS rid, r.n, r.status, r.reveal_at FROM groups g JOIN rounds r ON r.id = g.round_id WHERE g.id = ?1').bind(id).first();
      if (g) {
        const [m, p] = await Promise.all([
          env.DB.prepare('SELECT COUNT(*) AS c FROM members WHERE group_id = ?1').bind(id).first(),
          env.DB.prepare('SELECT COUNT(DISTINCT s.member_id) AS c FROM steps s JOIN chains c ON c.id = s.chain_id WHERE c.round_id = ?1').bind(g.rid).first(),
        ]);
        const n = m ? m.c : 0;
        const played = p ? p.c : 0;
        title = `${g.name} · Doodlechain`;
        const t = Math.floor(Date.now() / 1000);
        if (g.status === 'revealed' || (g.reveal_at && g.reveal_at <= t)) {
          desc = `Round ${g.n} is revealed! See how the drawings turned out, then play the next round.`;
        } else {
          const bits = [`Round ${g.n}`, `${played} of ${n} ${n === 1 ? 'player has' : 'players have'} played`];
          if (g.reveal_at) bits.push(untilText(g.reveal_at, t));
          desc = bits.join(' · ') + '. Tap to draw and guess, no sign-up.';
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
  const canonical = `${url.origin}${url.pathname}`;
  const meta = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Doodlechain">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta);
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
