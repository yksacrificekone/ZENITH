import { el, clear } from '../dom.js';

export function openModal({ title, bodyNode, footNode, wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  clear(root);
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const card = el('div', { class: `modal-card ${wide ? 'wide' : ''}` });
  card.appendChild(el('div', { class: 'modal-head' }, [
    el('h2', {}, title),
    el('button', { class: 'icon-btn', onclick: () => close() }, '✕'),
  ]));
  const body = el('div', { class: 'modal-body' });
  if (bodyNode) body.appendChild(bodyNode);
  card.appendChild(body);
  if (footNode) card.appendChild(el('div', { class: 'modal-foot' }, footNode));
  overlay.appendChild(card);
  root.appendChild(overlay);

  function close() { clear(root); onClose && onClose(); }
  return { close, body };
}

export function closeModal() {
  clear(document.getElementById('modal-root'));
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    const body = el('div', {}, message);
    const { close } = openModal({
      title,
      bodyNode: body,
      footNode: [
        el('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { close(); resolve(true); } }, confirmLabel),
      ],
      onClose: () => resolve(false),
    });
  });
}
