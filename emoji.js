import { el, clear } from '../dom.js';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

export const EMOJI_CATEGORIES = {
  Smileys: ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😎','😴','🥳','😭','😡','🤯','🥺','😇','🙃','😏','🤩'],
  Gestures: ['👍','👎','👏','🙌','🙏','💪','👋','✌️','🤝','👌','🤙','✍️'],
  Hearts: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💖'],
  Animals: ['🐶','🐱','🦊','🐻','🐼','🐨','🐸','🐵','🦁','🐯','🐷','🐧'],
  Objects: ['🔥','⭐','✨','🎉','🎮','🎧','💻','📱','☕','🍕','🍔','🎬'],
};

// Custom emoji are simple: user-uploaded images stored client-side per
// session (real custom emoji would need a dedicated upload+storage
// endpoint; this keeps the picker fully functional without over-scoping).
const customEmoji = [];
export function addCustomEmoji(name, url) { customEmoji.push({ name, url }); }
export function getCustomEmoji() { return customEmoji; }

// A small built-in sticker set — original flat-style stickers, drawn as
// inline SVG data URIs so nothing external is needed and no third-party
// artwork is used.
export const STICKERS = [
  { id: 'wave', label: 'Waving', bg: '#6c5ce7', emoji: '👋' },
  { id: 'fire', label: 'On Fire', bg: '#f3555a', emoji: '🔥' },
  { id: 'love', label: 'Love It', bg: '#f5578a', emoji: '❤️' },
  { id: 'laugh', label: 'Laughing', bg: '#f5b942', emoji: '😂' },
  { id: 'cool', label: 'Cool', bg: '#3bd67a', emoji: '😎' },
  { id: 'shock', label: 'Shocked', bg: '#3aa6ff', emoji: '😮' },
  { id: 'party', label: 'Party', bg: '#a76cf0', emoji: '🎉' },
  { id: 'gg', label: 'GG', bg: '#1f2029', emoji: '🏆' },
];

export function stickerSvgDataUri(sticker) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' rx='28' fill='${sticker.bg}'/><text x='80' y='96' font-size='72' text-anchor='middle'>${sticker.emoji}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function openEmojiPicker(anchorEl, onPick) {
  const root = document.getElementById('modal-root');
  clear(root);
  const pop = el('div', { class: 'profile-popout', style: pickerPosition(anchorEl) });
  const body = el('div', { style: 'padding:14px;max-height:360px;overflow-y:auto;' });
  for (const [cat, list] of Object.entries(EMOJI_CATEGORIES)) {
    body.appendChild(el('div', { style: 'font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin:8px 0 6px;' }, cat));
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;' });
    for (const e of list) {
      grid.appendChild(el('div', {
        style: 'font-size:20px;text-align:center;cursor:pointer;padding:4px 0;border-radius:6px;',
        onclick: () => { onPick(e); clear(root); },
      }, e));
    }
    body.appendChild(grid);
  }
  if (getCustomEmoji().length) {
    body.appendChild(el('div', { style: 'font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin:8px 0 6px;' }, 'Custom'));
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;' });
    for (const ce of getCustomEmoji()) {
      grid.appendChild(el('img', { src: ce.url, title: ce.name, style: 'width:26px;height:26px;cursor:pointer;', onclick: () => { onPick(`:${ce.name}:`); clear(root); } }));
    }
    body.appendChild(grid);
  }
  pop.appendChild(body);
  root.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!pop.contains(e.target) && e.target !== anchorEl) { clear(root); document.removeEventListener('click', h); }
  }), 0);
}

export function openStickerPicker(anchorEl, onPick) {
  const root = document.getElementById('modal-root');
  clear(root);
  const pop = el('div', { class: 'profile-popout', style: pickerPosition(anchorEl) });
  const body = el('div', { style: 'padding:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;' });
  for (const s of STICKERS) {
    body.appendChild(el('img', {
      src: stickerSvgDataUri(s), title: s.label,
      style: 'width:100%;border-radius:10px;cursor:pointer;',
      onclick: () => { onPick(s); clear(root); },
    }));
  }
  pop.appendChild(body);
  root.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!pop.contains(e.target) && e.target !== anchorEl) { clear(root); document.removeEventListener('click', h); }
  }), 0);
}

// Curated GIF picker. Without a licensed GIF-provider API key configured,
// this searches a small original set of looping SVG animations grouped by
// mood, so "GIF" messages work end-to-end without pulling in third-party
// media or requiring a paid key.
const GIF_MOODS = {
  hype: '#f5934b', laugh: '#f5b942', love: '#f5578a', wow: '#3aa6ff', sad: '#6c5ce7', wave: '#3bd67a',
};
export function openGifPicker(anchorEl, onPick) {
  const root = document.getElementById('modal-root');
  clear(root);
  const pop = el('div', { class: 'profile-popout', style: pickerPosition(anchorEl) + 'width:340px;' });
  const search = el('input', { type: 'text', placeholder: 'Search moods (hype, laugh, love…)', style: 'width:100%;background:var(--bg-input);border:none;border-radius:var(--radius-sm);padding:9px 12px;color:var(--text-primary);outline:none;margin:12px 12px 0;box-sizing:border-box;width:calc(100% - 24px);' });
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:12px;' });
  function render(filter = '') {
    clear(grid);
    for (const [mood, color] of Object.entries(GIF_MOODS)) {
      if (filter && !mood.includes(filter.toLowerCase())) continue;
      const svg = animatedGifSvg(mood, color);
      const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      grid.appendChild(el('img', { src: uri, style: 'width:100%;border-radius:8px;cursor:pointer;', onclick: () => { onPick({ url: uri, kind: 'image', name: `${mood}.svg` }); clear(root); } }));
    }
  }
  render();
  search.addEventListener('input', () => render(search.value));
  pop.appendChild(search);
  pop.appendChild(grid);
  root.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!pop.contains(e.target) && e.target !== anchorEl) { clear(root); document.removeEventListener('click', h); }
  }), 0);
}

function animatedGifSvg(label, color) {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='140'><rect width='200' height='140' fill='${color}'/><circle cx='100' cy='60' r='24' fill='white' opacity='.85'><animate attributeName='r' values='20;28;20' dur='1.2s' repeatCount='indefinite'/></circle><text x='100' y='115' font-size='16' fill='white' text-anchor='middle' font-family='sans-serif'>${label}</text></svg>`;
}

function pickerPosition(anchorEl) {
  if (!anchorEl) return 'right:20px;bottom:80px;';
  const rect = anchorEl.getBoundingClientRect();
  return `left:${Math.max(8, rect.left - 260)}px;top:${Math.max(8, rect.top - 380)}px;`;
}
