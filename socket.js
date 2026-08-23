// socket.js — loads socket.io-client from CDN and exposes a single shared connection.

import { getToken } from './api.js';

let socket = null;
let loaderPromise = null;

function loadSocketIoScript() {
  if (window.io) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export async function connectSocket() {
  await loadSocketIoScript();
  if (socket) socket.disconnect();
  socket = window.io({ auth: { token: getToken() } });
  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}
