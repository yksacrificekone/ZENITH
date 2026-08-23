// dom.js — tiny helpers to avoid repeating boilerplate everywhere.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function q(sel, root = document) { return root.querySelector(sel); }
export function qa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Very small, safe-ish message formatter: escapes HTML first, then linkifies
// URLs and highlights @mentions. No raw HTML is ever inserted from user text.
export function formatMessageContent(text, mentionUsernames = []) {
  let safe = escapeHtml(text || '');
  safe = safe.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  safe = safe.replace(/@([a-zA-Z0-9_.]{2,32})/g, (m, name) => `<span class="mention">@${name}</span>`);
  return safe;
}

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return 'just now';
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

export function formatClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase();
}

// Deterministic color from a string, used for default avatars.
export function colorFromString(str) {
  let hash = 0;
  for (let i = 0; i < String(str).length; i++) hash = String(str).charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

export function avatarUrlOrFallback(user) {
  return user && user.avatar ? user.avatar : null;
}

export function avatarImg(user, size = 40, extraAttrs = {}) {
  if (user && user.avatar) {
    return el('img', { class: 'avatar', src: user.avatar, style: `width:${size}px;height:${size}px;`, ...extraAttrs });
  }
  const name = (user && (user.displayName || user.username)) || '?';
  const node = el('div', {
    class: 'avatar',
    style: `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${colorFromString(user?.id || name)};color:#fff;font-weight:800;font-size:${Math.round(size * 0.4)}px;`,
    ...extraAttrs,
  }, initials(name));
  return node;
}
