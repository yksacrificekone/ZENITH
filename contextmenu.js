import { el, clear } from '../dom.js';

let closeHandlerAttached = false;

export function openContextMenu(x, y, items) {
  const root = document.getElementById('context-menu-root');
  clear(root);
  const menu = el('div', { class: 'context-menu', style: `left:${x}px;top:${y}px;` });
  for (const item of items) {
    if (item === 'sep') { menu.appendChild(el('div', { class: 'context-sep' })); continue; }
    menu.appendChild(el('div', {
      class: `context-item ${item.danger ? 'danger' : ''}`,
      onclick: (e) => { e.stopPropagation(); clear(root); item.action && item.action(); },
    }, item.label));
  }
  root.appendChild(menu);

  // keep on screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;

  if (!closeHandlerAttached) {
    closeHandlerAttached = true;
    document.addEventListener('click', () => clear(document.getElementById('context-menu-root')));
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.context-menu')) clear(document.getElementById('context-menu-root'));
    });
  }
}
