// Shared helpers
const Store = {
  key: (id) => 'doodlechain:' + id,
  get(id) { try { return JSON.parse(localStorage.getItem(this.key(id)) || 'null'); } catch { return null; } },
  set(id, v) { try { localStorage.setItem(this.key(id), JSON.stringify(v)); } catch {} },
  remove(id) { try { localStorage.removeItem(this.key(id)); } catch {} },
  all() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('doodlechain:')) { const v = JSON.parse(localStorage.getItem(k)); if (v && v.token) out.push({ id: k.slice(12), ...v }); }
      }
    } catch {}
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  },
};

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-member-token'] = token;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('No connection. Check your internet and try again.'), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

// Share a link with the native sheet if there is one, else copy it.
async function shareLink(url, text) {
  if (navigator.share) {
    try { await navigator.share({ title: 'Doodlechain', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (await copyText(url)) toast('Link copied. Paste it in your group chat.');
  else prompt('Copy this link:', url);
}

// Reveal-time choices, computed in the player's own time zone.
function revealChoice(v) {
  const d = new Date();
  if (v === 'tonight') { d.setHours(21, 0, 0, 0); if (d.getTime() - Date.now() < 3600e3) d.setDate(d.getDate() + 1); }
  else if (v === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(21, 0, 0, 0); }
  else if (v === '3days') { d.setDate(d.getDate() + 3); d.setHours(21, 0, 0, 0); }
  else return null;
  return Math.floor(d.getTime() / 1000);
}

function fmtReveal(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today at ${time}`;
  if (d.toDateString() === tmr.toDateString()) return `tomorrow at ${time}`;
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) + ` at ${time}`;
}
