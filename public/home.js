// Landing page: create a game, list games on this device, render the demo chain.
(function () {
  const f = document.getElementById('createForm');
  const errEl = document.getElementById('createError');
  const btn = document.getElementById('createBtn');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const name = document.getElementById('gName').value.trim();
    const host = document.getElementById('hName').value.trim();
    if (!name) { errEl.textContent = 'Give your game a name, e.g. "Smith family".'; document.getElementById('gName').focus(); return; }
    if (!host) { errEl.textContent = 'Enter your nickname.'; document.getElementById('hName').focus(); return; }
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const r = await api('/groups', { method: 'POST', body: {
        name, host,
        revealAt: revealChoice(document.getElementById('reveal').value),
        steps: +document.getElementById('steps').value,
      } });
      Store.set(r.id, { token: r.token, memberId: r.memberId, name, at: Date.now() });
      location.href = '/g/' + r.id + '?new=1';
    } catch (ex) {
      errEl.textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Create game and get the link';
    }
  });

  const mine = Store.all();
  if (mine.length) {
    document.getElementById('mine').hidden = false;
    document.getElementById('mineList').innerHTML = mine.slice(0, 12)
      .map((g) => `<li><a href="/g/${esc(g.id)}">${esc(g.name || 'Game')}</a></li>`).join('');
  }

  // Demo drawings, made of simple strokes (grid 1000x1000).
  const circle = (cx, cy, r, c, w, n = 18) => {
    const s = [c, w];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; s.push(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)); }
    return s;
  };
  const cat = { s: [
    [8, 2, 120, 820, 880, 820], [8, 1, 180, 820, 180, 960], [8, 1, 820, 820, 820, 960],
    circle(420, 420, 170, 0, 1), [0, 1, 290, 320, 300, 170, 400, 260], [0, 1, 450, 255, 560, 170, 560, 320],
    [0, 0, 360, 410, 380, 410], [0, 0, 460, 410, 480, 410], [7, 1, 410, 470, 430, 470],
    [0, 0, 300, 470, 200, 450], [0, 0, 540, 470, 650, 450], [0, 1, 300, 590, 260, 800], [0, 1, 540, 590, 580, 800],
    [5, 1, 640, 560, 860, 560, 860, 800, 640, 800, 640, 560], [0, 0, 680, 620, 820, 620], [0, 0, 680, 680, 800, 680], [0, 0, 680, 740, 780, 740],
    [1, 1, 560, 700, 640, 650],
  ] };
  const raccoon = { s: [
    circle(380, 400, 180, 0, 1), [0, 2, 250, 390, 510, 390], [9, 0, 330, 390, 340, 390], [9, 0, 420, 390, 430, 390],
    [0, 1, 250, 280, 240, 160, 330, 240], [0, 1, 430, 240, 520, 160, 510, 280], [0, 1, 360, 480, 400, 480],
    [0, 1, 300, 580, 260, 860], [0, 1, 460, 580, 500, 860],
    circle(700, 700, 150, 4, 1), [4, 1, 640, 560, 700, 520, 760, 560], [4, 2, 700, 640, 660, 680, 740, 720, 700, 760], [4, 1, 700, 610, 700, 790],
    [0, 1, 160, 700, 100, 640, 160, 600, 100, 540],
  ] };
  const d1 = document.getElementById('demo1');
  const d2 = document.getElementById('demo2');
  const paint = () => {
    for (const [c, d] of [[d1, cat], [d2, raccoon]]) {
      const px = Math.round((c.clientWidth || 200) * (window.devicePixelRatio || 1));
      c.width = px; c.height = px;
      renderDrawing(c.getContext('2d'), d, px);
    }
  };
  paint();
  window.addEventListener('resize', paint);
})();
