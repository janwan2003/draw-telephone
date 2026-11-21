// Pure game rules, shared by the API and the unit tests.

export const STEP_OPTIONS = [4, 6, 8]; // chain length the host picks (default 6)
export const DEFAULT_STEPS = 6;
export const MAX_MEMBERS = 30;
export const MIN_TEXT = 2;
export const MAX_TEXT = 80;
export const PALETTE = 10;         // colour indices 0..9 (9 = white, used as eraser)
export const SIZES = 3;            // brush size indices 0..2
export const GRID = 1000;          // drawing coordinates are integers 0..1000 on a square canvas
export const MAX_DRAW_BYTES = 60000;
export const MAX_POINTS = 12000;   // x,y pairs across all strokes
export const LOCK_SECONDS = 15 * 60;

// The kind the next step of a chain must be, given its last step's kind.
export const nextKind = (lastKind) => (lastKind === 'text' ? 'draw' : 'text');

// Validate and normalise a drawing. Input: { s: [[colour, size, x0, y0, x1, y1, ...], ...] }.
// Returns the compact JSON string to store, or null if invalid.
export function validateDrawing(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.s)) return null;
  if (d.s.length === 0 || d.s.length > 1500) return null;
  let points = 0;
  let inked = false;
  const out = [];
  for (const st of d.s) {
    if (!Array.isArray(st) || st.length < 4 || st.length % 2 !== 0) return null;
    const c = st[0];
    const w = st[1];
    if (!Number.isInteger(c) || c < 0 || c >= PALETTE) return null;
    if (!Number.isInteger(w) || w < 0 || w >= SIZES) return null;
    const pts = [c, w];
    for (let i = 2; i < st.length; i++) {
      const v = st[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      pts.push(Math.max(0, Math.min(GRID, Math.round(v))));
    }
    points += (st.length - 2) / 2;
    if (points > MAX_POINTS) return null;
    if (c !== 9) inked = true;
    out.push(pts);
  }
  if (!inked) return null; // only eraser strokes = blank drawing
  const json = JSON.stringify({ s: out });
  if (json.length > MAX_DRAW_BYTES) return null;
  return json;
}

export function validateText(t) {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return s.length >= MIN_TEXT ? s : null;
}

// Choose the chain a member should play next.
// chains: [{ id, len, lock_member, lock_until, updated_at }]
// played: Set of chain ids the member already has a step in.
// skip: Set of chain ids the member asked to skip this time.
// Prefers a chain the member already holds, then the shortest, then the one waiting longest.
export function pickChain(chains, memberId, played, skip, t, maxSteps = DEFAULT_STEPS) {
  const free = chains.filter(
    (c) => !played.has(c.id) && c.len > 0 && c.len < maxSteps &&
      (c.lock_member === memberId || !c.lock_member || c.lock_until < t)
  );
  const held = free.find((c) => c.lock_member === memberId && c.lock_until >= t && !skip.has(c.id));
  if (held) return held;
  const pool = free.filter((c) => !skip.has(c.id));
  const list = pool.length ? pool : free;
  list.sort((a, b) => a.len - b.len || a.updated_at - b.updated_at || (a.id < b.id ? -1 : 1));
  return list[0] || null;
}

// A chain is complete once it is full or every member has a step in it.
// A round is complete once at least 3 people have started chains and every chain is complete.
export function roundComplete(chains, memberIds, playedBy, maxSteps = DEFAULT_STEPS) {
  if (chains.length < 3) return false;
  for (const c of chains) {
    if (c.len >= maxSteps) continue;
    const who = playedBy.get(c.id) || new Set();
    for (const m of memberIds) if (!who.has(m)) return false;
  }
  return true;
}
