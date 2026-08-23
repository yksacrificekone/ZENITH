import { api } from '../api.js';
import { el, clear, q, avatarImg } from '../dom.js';
import { state, notify } from '../state.js';
import { openModal, closeModal, confirmDialog } from './modal.js';
import { openContextMenu } from './contextmenu.js';
import { toast, toastError, toastSuccess } from './toast.js';
import { getSocket } from '../socket.js';

let onSelectServerCb = null;
let onSelectHomeCb = null;

export function initServers({ onSelectServer, onSelectHome }) {
  onSelectServerCb = onSelectServer;
  onSelectHomeCb = onSelectHome;

  q('#rail-home').addEventListener('click', () => {
    state.activeServer = null;
    state.activeChannelId = null;
    renderServerRail();
    onSelectHomeCb();
  });

  q('#rail-add-server').addEventListener('click', openAddServerModal);
}

export async function loadServerList() {
  const { servers } = await api.listServers();
  state.servers = servers;
  renderServerRail();
}

export function renderServerRail() {
  const rail = q('#rail-servers');
  clear(rail);
  q('#rail-home').classList.toggle('active', !state.activeServer);
  for (const s of state.servers) {
    const item = el('div', {
      class: `rail-item ${state.activeServer?.id === s.id ? 'active' : ''}`,
      title: s.name,
      onclick: () => selectServer(s.id),
      oncontextmenu: (e) => { e.preventDefault(); openServerContextMenu(e, s); },
    }, [el('div', { class: 'pill' })]);
    if (s.icon) item.appendChild(el('img', { src: s.icon }));
    else item.appendChild(document.createTextNode(initialsFor(s.name)));
    rail.appendChild(item);
  }
}

function initialsFor(name) {
  return String(name).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
}

export async function selectServer(serverId) {
  try {
    const { server } = await api.getServer(serverId);
    state.activeServer = server;
    state.activeChannelId = null;
    const socket = getSocket();
    renderServerRail();
    onSelectServerCb(server);
  } catch (err) {
    toastError("Couldn't open server", err.message);
  }
}

export async function refreshActiveServer() {
  if (!state.activeServer) return;
  const { server } = await api.getServer(state.activeServer.id);
  state.activeServer = server;
  notify('server');
}

function openServerContextMenu(e, s) {
  const items = [];
  items.push({ label: 'Copy Invite Code', action: () => { navigator.clipboard.writeText(s.inviteCode); toastSuccess('Copied', 'Invite code copied to clipboard.'); } });
  items.push({ label: 'Server Settings', action: () => selectServer(s.id).then(() => openServerSettingsModal(state.activeServer)) });
  items.push('sep');
  if (s.ownerId === state.currentUser.id) {
    items.push({ label: 'Delete Server', danger: true, action: () => deleteServerFlow(s) });
  } else {
    items.push({ label: 'Leave Server', danger: true, action: () => leaveServerFlow(s) });
  }
  openContextMenu(e.clientX, e.clientY, items);
}

async function leaveServerFlow(s) {
  const ok = await confirmDialog('Leave Server', `Leave "${s.name}"? You can rejoin later with an invite code.`, { confirmLabel: 'Leave' });
  if (!ok) return;
  await api.leaveServer(s.id);
  state.servers = state.servers.filter(x => x.id !== s.id);
  if (state.activeServer?.id === s.id) { state.activeServer = null; onSelectHomeCb(); }
  renderServerRail();
  toastSuccess('Left server');
}

async function deleteServerFlow(s) {
  const ok = await confirmDialog('Delete Server', `Permanently delete "${s.name}"? This cannot be undone.`, { confirmLabel: 'Delete Server' });
  if (!ok) return;
  await api.deleteServer(s.id);
  state.servers = state.servers.filter(x => x.id !== s.id);
  if (state.activeServer?.id === s.id) { state.activeServer = null; onSelectHomeCb(); }
  renderServerRail();
  toastSuccess('Server deleted');
}

function openAddServerModal() {
  const body = el('div', {}, [
    el('div', { style: 'display:flex;gap:12px;margin-bottom:4px;' }, [
      el('button', { class: 'btn btn-primary flex-1', id: 'tab-create' }, 'Create a Server'),
      el('button', { class: 'btn flex-1', id: 'tab-join' }, 'Join a Server'),
    ]),
    el('div', { id: 'add-server-body', style: 'margin-top:18px;' }),
  ]);
  const { close } = openModal({ title: 'Add a Server', bodyNode: body });
  const bodyArea = body.querySelector('#add-server-body');

  function showCreate() {
    body.querySelector('#tab-create').className = 'btn btn-primary flex-1';
    body.querySelector('#tab-join').className = 'btn flex-1';
    clear(bodyArea);
    const nameInput = el('input', { type: 'text', placeholder: 'e.g. Late Night Study Group' });
    bodyArea.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Server Name'), nameInput]));
    bodyArea.appendChild(el('button', {
      class: 'btn btn-primary btn-block', onclick: async () => {
        if (!nameInput.value.trim()) return;
        try {
          const { server } = await api.createServer(nameInput.value.trim());
          state.servers.push({ id: server.id, name: server.name, icon: server.icon, ownerId: server.ownerId, inviteCode: server.inviteCode });
          renderServerRail();
          close();
          selectServer(server.id);
          toastSuccess('Server created!', `Invite code: ${server.inviteCode}`);
        } catch (err) { toastError('Failed to create server', err.message); }
      },
    }, 'Create Server'));
  }
  function showJoin() {
    body.querySelector('#tab-join').className = 'btn btn-primary flex-1';
    body.querySelector('#tab-create').className = 'btn flex-1';
    clear(bodyArea);
    const codeInput = el('input', { type: 'text', placeholder: 'Enter an invite code' });
    bodyArea.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Invite Code'), codeInput]));
    bodyArea.appendChild(el('button', {
      class: 'btn btn-primary btn-block', onclick: async () => {
        if (!codeInput.value.trim()) return;
        try {
          const { server } = await api.joinServer(codeInput.value.trim());
          state.servers.push({ id: server.id, name: server.name, icon: server.icon, ownerId: server.ownerId, inviteCode: server.inviteCode });
          renderServerRail();
          close();
          selectServer(server.id);
          toastSuccess(`Joined ${server.name}!`);
        } catch (err) { toastError("Couldn't join server", err.message); }
      },
    }, 'Join Server'));
  }
  body.querySelector('#tab-create').addEventListener('click', showCreate);
  body.querySelector('#tab-join').addEventListener('click', showJoin);
  showCreate();
}

export function openServerSettingsModal(server) {
  const isOwner = server.ownerId === state.currentUser.id;
  const body = el('div', {});

  const nameInput = el('input', { type: 'text', value: server.name, disabled: !isOwner });
  body.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Server Name'), nameInput]));

  body.appendChild(el('div', { class: 'field' }, [
    el('label', {}, 'Server Icon'),
    el('div', { class: 'row gap-8' }, [
      server.icon ? el('img', { src: server.icon, style: 'width:56px;height:56px;border-radius:50%;object-fit:cover;' }) : avatarImg({ displayName: server.name }, 56),
      isOwner ? el('label', { class: 'btn btn-sm' }, [
        'Upload New Icon',
        el('input', {
          type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
            const file = e.target.files[0]; if (!file) return;
            try { await api.uploadServerIcon(server.id, file); await refreshActiveServer(); closeModal(); openServerSettingsModal(state.activeServer); toastSuccess('Icon updated'); }
            catch (err) { toastError('Upload failed', err.message); }
          },
        }),
      ]) : null,
    ]),
  ]));

  body.appendChild(el('div', { class: 'field' }, [
    el('label', {}, 'Invite Code'),
    el('div', { class: 'row gap-8' }, [
      el('input', { type: 'text', value: server.inviteCode, readonly: true, style: 'flex:1' }),
      el('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(server.inviteCode); toastSuccess('Copied'); } }, 'Copy'),
    ]),
  ]));

  if (isOwner) {
    body.appendChild(el('div', { class: 'divider-line' }));
    body.appendChild(el('div', { style: 'font-weight:700;margin-bottom:10px;' }, 'Roles'));
    for (const r of server.roles) {
      body.appendChild(el('div', { class: 'row gap-8', style: 'margin-bottom:6px;' }, [
        el('span', { style: `width:10px;height:10px;border-radius:50%;background:${r.color};display:inline-block;` }),
        el('span', {}, r.name),
      ]));
    }
    const roleNameInput = el('input', { type: 'text', placeholder: 'New role name', style: 'flex:1' });
    body.appendChild(el('div', { class: 'row gap-8', style: 'margin-top:8px;' }, [
      roleNameInput,
      el('button', {
        class: 'btn btn-sm', onclick: async () => {
          if (!roleNameInput.value.trim()) return;
          await api.createRole(server.id, { name: roleNameInput.value.trim(), color: randomRoleColor() });
          await refreshActiveServer(); closeModal(); openServerSettingsModal(state.activeServer);
        },
      }, 'Add Role'),
    ]));
  }

  const foot = [];
  if (isOwner) {
    foot.push(el('button', { class: 'btn btn-primary', onclick: async () => { await api.updateServer(server.id, { name: nameInput.value.trim() }); await refreshActiveServer(); closeModal(); toastSuccess('Server updated'); } }, 'Save Changes'));
  }
  openModal({ title: `${server.name} — Settings`, bodyNode: body, footNode: foot, wide: true });
}

function randomRoleColor() {
  const colors = ['#e8485c', '#f5934b', '#f5c542', '#2fbf71', '#3aa6ff', '#8b6cf0', '#f5578a'];
  return colors[Math.floor(Math.random() * colors.length)];
}
