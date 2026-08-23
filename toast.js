import { el } from '../dom.js';

export function toast(title, desc = '', kind = '') {
  const stack = document.getElementById('toast-stack');
  const node = el('div', { class: `toast ${kind}` }, [
    el('div', { class: 'tt' }, title),
    desc ? el('div', { class: 'td' }, desc) : null,
  ]);
  stack.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = '.2s'; setTimeout(() => node.remove(), 200); }, 4200);
}

export const toastError = (title, desc) => toast(title, desc, 'error');
export const toastSuccess = (title, desc) => toast(title, desc, 'success');
