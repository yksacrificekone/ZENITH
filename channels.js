import { api } from '../api.js';
import { el, clear, q } from '../dom.js';
import { state } from '../state.js';
import { openModal, closeModal, confirmDialog } from './modal.js';
import { openContextMenu } from './contextmenu.js';
import { toastError, toastSuccess } from './toast.js';
import { refreshActiveServer, openServerSettingsModal } from './servers.js';

let onSelectChannelCb = null;

export function initChannels({ onSelectChannel }) {
  onSelectChannelCb = onSelectChannel;
  q('#server-name-header').addEventListener('click', () => {
    if (state.activeServer) openServerContextMenuAtHeader();
  });
}

function openServerContextMenuAtHeader() {
  const rect = q('#server-name-header').getBoundingClientRect();
  const items = [
    { label: 'Invite People', action: () => { navigator.clipboard.writeText(state.activeServer.inviteCode); toastSuccess('Invite code copied', state.activeServer.inviteCode); } },
    { label: 'Server Settings', action: () => openServerSettingsModal(state.activeServer) },
  ];
  if (state.activeServer.ownerId === state.currentUser.id) {
    items.push('sep');
    items.push({ label: 'Create Category', action: () => createCategoryFlow() });
    items.push({ label: 'Create Channel', action: () => createChannelFlow(null) });
  }
  openContextMenu(rect.left, rect.bottom + 4, items);
}

export function renderChannelList() {
  const server = state.activeServer;
  q('#server-name-text').textContent = server.name;
  const listEl = q('#channel-list');
  clear(listEl);

  const uncategorized = server.channels.filter(c => !c.categoryId).sort((a, b) => a.position - b.position);
  if (uncategorized.length) {
    const wrap = el('div', {});
    for (const ch of uncategorized) wrap.appendChild(channelRow(ch));
    listEl.appendChild(wrap);
  }

  const cats = [...server.categories].sort((a, b) => a.position - b.position);
  for (const cat of cats) {
    const chs = server.channels.filter(c => c.categoryId === cat.id).sort((a, b) => a.position - b.position);
    const catNode = el('div', { class: 'category' });
    catNode.appendChild(el('div', {
      class: 'category-name',
      oncontextmenu: (e) => { e.preventDefault(); openCategoryMenu(e, cat); },
    }, [
      el('span', {}, cat.name.toUpperCase()),
      state.activeServer.ownerId === state.currentUser.id ? el('span', {
        style: 'cursor:pointer;font-size:15px;', onclick: (e) => { e.stopPropagation(); createChannelFlow(cat.id); },
      }, '+') : null,
    ]));
    for (const ch of chs) catNode.appendChild(channelRow(ch));
    listEl.appendChild(catNode);
  }
}

function channelRow(ch) {
  const isVoice = ch.type === 'voice';
  const row = el('div', {
    class: `channel-row ${state.activeChannelId === ch.id ? 'active' : ''}`,
    onclick: () => onSelectChannelCb(ch),
    oncontextmenu: (e) => { e.preventDefault(); openChannelMenu(e, ch); },
  }, [
    el('span', { class: 'hash' }, isVoice ? voiceIcon() : '#'),
    el('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, ch.name),
    state.activeServer.ownerId === state.currentUser.id ? el('div', { class: 'ch-actions' }, [
      el('span', { class: 'icon-btn', style: 'width:22px;height:22px;', onclick: (e) => { e.stopPropagation(); openChannelMenu(e, ch); } }, '⋯'),
    ]) : null,
  ]);
  const wrap = el('div', {});
  wrap.appendChild(row);
  if (isVoice) {
    const members = state.voiceRoomMembers.get(ch.id) || [];
    if (members.length) {
      const vm = el('div', { class: 'voice-members' });
      for (const m of members) {
        vm.appendChild(el('div', { class: 'voice-member-chip' }, [
          m.user.avatar ? el('img', { src: m.user.avatar }) : el('span', { style: 'width:20px;height:20px;border-radius:50%;background:var(--accent);display:inline-block;' }),
          el('span', {}, m.user.displayName),
          m.muted ? el('span', { title: 'Muted' }, '🔇') : null,
        ]));
      }
      wrap.appendChild(vm);
    }
  }
  return wrap;
}

function voiceIcon() {
  const span = el('span', { style: 'display:inline-flex;' });
  span.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
  return span;
}

function openChannelMenu(e, ch) {
  const items = [{ label: `Copy Channel Name`, action: () => navigator.clipboard.writeText(ch.name) }];
  if (state.activeServer.ownerId === state.currentUser.id) {
    items.push('sep');
    items.push({ label: 'Edit Channel', action: () => editChannelFlow(ch) });
    items.push({ label: 'Delete Channel', danger: true, action: () => deleteChannelFlow(ch) });
  }
  openContextMenu(e.clientX, e.clientY, items);
}

function openCategoryMenu(e, cat) {
  if (state.activeServer.ownerId !== state.currentUser.id) return;
  openContextMenu(e.clientX, e.clientY, [
    { label: 'Create Channel', action: () => createChannelFlow(cat.id) },
    { label: 'Delete Category', danger: true, action: () => deleteCategoryFlow(cat) },
  ]);
}

function createCategoryFlow() {
  const input = el('input', { type: 'text', placeholder: 'New Category' });
  const { close } = openModal({
    title: 'Create Category',
    bodyNode: el('div', { class: 'field' }, [el('label', {}, 'Category Name'), input]),
    footNode: [el('button', {
      class: 'btn btn-primary', onclick: async () => {
        await api.createCategory(state.activeServer.id, input.value.trim() || 'New Category');
        await refreshActiveServer(); renderChannelList(); close();
      },
    }, 'Create')],
  });
}

function createChannelFlow(categoryId) {
  const nameInput = el('input', { type: 'text', placeholder: 'new-channel' });
  let type = 'text';
  const typeRow = el('div', { class: 'row gap-8' }, [
    el('button', { class: 'btn btn-primary flex-1', id: 'ct-text' }, '# Text'),
    el('button', { class: 'btn flex-1', id: 'ct-voice' }, '🔊 Voice'),
  ]);
  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, 'Channel Type'), typeRow]),
    el('div', { class: 'field' }, [el('label', {}, 'Channel Name'), nameInput]),
  ]);
  typeRow.querySelector('#ct-text').addEventListener('click', () => { type = 'text'; typeRow.querySelector('#ct-text').className = 'btn btn-primary flex-1'; typeRow.querySelector('#ct-voice').className = 'btn flex-1'; });
  typeRow.querySelector('#ct-voice').addEventListener('click', () => { type = 'voice'; typeRow.querySelector('#ct-voice').className = 'btn btn-primary flex-1'; typeRow.querySelector('#ct-text').className = 'btn flex-1'; });

  const { close } = openModal({
    title: 'Create Channel',
    bodyNode: body,
    footNode: [el('button', {
      class: 'btn btn-primary', onclick: async () => {
        if (!nameInput.value.trim()) return;
        try {
          await api.createChannel(state.activeServer.id, { name: nameInput.value.trim(), type, categoryId });
          await refreshActiveServer(); renderChannelList(); close();
        } catch (err) { toastError('Failed to create channel', err.message); }
      },
    }, 'Create Channel')],
  });
}

function editChannelFlow(ch) {
  const nameInput = el('input', { type: 'text', value: ch.name });
  const topicInput = el('textarea', { rows: 2 }, ch.topic || '');
  const { close } = openModal({
    title: `Edit #${ch.name}`,
    bodyNode: el('div', {}, [
      el('div', { class: 'field' }, [el('label', {}, 'Channel Name'), nameInput]),
      el('div', { class: 'field' }, [el('label', {}, 'Topic'), topicInput]),
    ]),
    footNode: [el('button', {
      class: 'btn btn-primary', onclick: async () => {
        await api.updateChannel(state.activeServer.id, ch.id, { name: nameInput.value.trim(), topic: topicInput.value.trim() });
        await refreshActiveServer(); renderChannelList(); close();
      },
    }, 'Save')],
  });
}

async function deleteChannelFlow(ch) {
  const ok = await confirmDialog('Delete Channel', `Delete #${ch.name}? This cannot be undone.`, { confirmLabel: 'Delete' });
  if (!ok) return;
  await api.deleteChannel(state.activeServer.id, ch.id);
  await refreshActiveServer(); renderChannelList();
  toastSuccess('Channel deleted');
}

async function deleteCategoryFlow(cat) {
  const ok = await confirmDialog('Delete Category', `Delete "${cat.name}"? Channels inside will become uncategorized.`, { confirmLabel: 'Delete' });
  if (!ok) return;
  await api.deleteCategory(state.activeServer.id, cat.id);
  await refreshActiveServer(); renderChannelList();
}
