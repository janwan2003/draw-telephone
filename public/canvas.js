// Drawing pad + renderer. Drawings are vectors on a 1000x1000 grid:
// { s: [[colour, size, x0, y0, x1, y1, ...], ...] }
const GRID = 1000;
const COLORS = ['#1d1b2e', '#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff70a6', '#8d5524', '#ffffff'];
const COLOR_NAMES = ['Black', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Brown', 'Eraser'];
const SIZES = [7, 16, 40];
const SIZE_NAMES = ['Thin', 'Medium', 'Thick'];
const ERASER = 9;

function strokePath(ctx, st, scale, upto) {
  const n = upto === undefined ? (st.length - 2) / 2 : Math.min(upto, (st.length - 2) / 2);
  if (n <= 0) return;
  ctx.strokeStyle = COLORS[st[0]];
  ctx.fillStyle = COLORS[st[0]];
  ctx.lineWidth = SIZES[st[1]] * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const x = (i) => st[2 + i * 2] * scale;
  const y = (i) => st[3 + i * 2] * scale;
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(x(0), y(0), (SIZES[st[1]] * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  for (let i = 1; i < n - 1; i++) {
    const mx = (x(i) + x(i + 1)) / 2;
    const my = (y(i) + y(i + 1)) / 2;
    ctx.quadraticCurveTo(x(i), y(i), mx, my);
  }
  ctx.lineTo(x(n - 1), y(n - 1));
  ctx.stroke();
}

// Render a drawing into ctx at (ox, oy) with side `size` px. `points` limits how many
// points are drawn in total (for the playback animation).
function renderDrawing(ctx, drawing, size, ox = 0, oy = 0, points = Infinity) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  const scale = size / GRID;
  let left = points;
  for (const st of (drawing && drawing.s) || []) {
    if (left <= 0) break;
    const n = (st.length - 2) / 2;
    strokePath(ctx, st, scale, Math.min(n, left));
    left -= n;
  }
  ctx.restore();
}

function countPoints(drawing) {
  let n = 0;
  for (const st of (drawing && drawing.s) || []) n += (st.length - 2) / 2;
  return n;
}

// A canvas element sized for the device pixel ratio, showing a drawing.
// animate: replay the strokes over ~1.6 s.
function drawingCanvas(drawing, { animate = false, label = 'Drawing' } = {}) {
  const c = document.createElement('canvas');
  c.className = 'drawing';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', label);
  const paint = (pts) => {
    const css = c.clientWidth || 320;
    const px = Math.round(css * (window.devicePixelRatio || 1));
    if (c.width !== px) { c.width = px; c.height = px; }
    renderDrawing(c.getContext('2d'), drawing, px, 0, 0, pts);
  };
  const total = countPoints(drawing);
  requestAnimationFrame(() => {
    if (!animate || total < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { paint(); return; }
    const start = performance.now();
    const dur = Math.min(2600, 700 + total * 3);
    const tick = (tm) => {
      const k = Math.min(1, (tm - start) / dur);
      paint(Math.ceil(total * k));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => paint(), 150); });
  return c;
}

class DrawPad {
  constructor(root) {
    this.root = root;
    this.strokes = [];
    this.color = 0;
    this.size = 1;
    this.onchange = () => {};
    root.innerHTML = `
      <div class="pad-wrap"><canvas class="pad" aria-label="Drawing area" role="img"></canvas></div>
      <div class="tools" role="toolbar" aria-label="Brush">
        <div class="swatches">${COLORS.map((c, i) => `<button type="button" class="sw${i === ERASER ? ' eraser' : ''}" data-c="${i}" style="--c:${c}" aria-label="${COLOR_NAMES[i]}" title="${COLOR_NAMES[i]}"></button>`).join('')}</div>
        <div class="tool-row">
          <div class="sizes">${SIZES.map((s, i) => `<button type="button" class="sz" data-s="${i}" aria-label="${SIZE_NAMES[i]} brush" title="${SIZE_NAMES[i]}"><i style="--d:${[6, 11, 20][i]}px"></i></button>`).join('')}</div>
          <button type="button" class="tbtn" data-act="undo" aria-label="Undo">↶ Undo</button>
          <button type="button" class="tbtn" data-act="clear" aria-label="Clear drawing">Clear</button>
        </div>
      </div>`;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    root.querySelectorAll('.sw').forEach((b) => b.addEventListener('click', () => { this.color = +b.dataset.c; this.sync(); }));
    root.querySelectorAll('.sz').forEach((b) => b.addEventListener('click', () => { this.size = +b.dataset.s; this.sync(); }));
    root.querySelector('[data-act=undo]').addEventListener('click', () => { this.strokes.pop(); this.redraw(); this.onchange(); });
    root.querySelector('[data-act=clear]').addEventListener('click', () => {
      if (!this.strokes.length || confirm('Clear your whole drawing?')) { this.strokes = []; this.redraw(); this.onchange(); }
    });
    this.bind();
    this.sync();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  sync() {
    this.root.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.c === this.color)));
    this.root.querySelectorAll('.sz').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.s === this.size)));
    this.root.style.setProperty('--brush', COLORS[this.color === ERASER ? 0 : this.color]);
  }

  resize() {
    const css = this.canvas.clientWidth || 320;
    this.px = Math.round(css * (window.devicePixelRatio || 1));
    this.canvas.width = this.px;
    this.canvas.height = this.px;
    this.redraw();
  }

  redraw() {
    renderDrawing(this.ctx, { s: this.strokes }, this.px);
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * GRID);
    const y = Math.round(((e.clientY - r.top) / r.height) * GRID);
    return [Math.max(0, Math.min(GRID, x)), Math.max(0, Math.min(GRID, y))];
  }

  bind() {
    const cv = this.canvas;
    let cur = null;
    let pid = null;
    const add = (e) => {
      const [x, y] = this.point(e);
      const lx = cur[cur.length - 2];
      const ly = cur[cur.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 4) return;
      cur.push(x, y);
    };
    cv.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      pid = e.pointerId;
      try { cv.setPointerCapture(pid); } catch {}
      cur = [this.color, this.size, ...this.point(e)];
      this.strokes.push(cur);
      this.redraw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid || !cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) add(ev);
      // Draw only the newest segment pair for speed; full redraw on undo.
      const scale = this.px / GRID;
      const n = (cur.length - 2) / 2;
      if (n >= 2) {
        const tail = [cur[0], cur[1], ...cur.slice(Math.max(2, cur.length - 6))];
        strokePath(this.ctx, tail, scale);
      }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (cur) { this.redraw(); this.onchange(); }
      cur = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('lostpointercapture', end);
  }

  isEmpty() {
    return !this.strokes.some((s) => s[0] !== ERASER);
  }

  value() {
    return { s: this.strokes };
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}
