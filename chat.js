import { api } from '../api.js';
import { el, clear, q, avatarImg, formatMessageContent, formatClock, formatDay, formatBytes } from '../dom.js';
import { state } from '../state.js';
import { getSocket } from '../socket.js';
import { toastError } from './toast.js';
import { openContextMenu } from './contextmenu.js';
import { openProfilePopout } from './profile.js';
import { QUICK_REACTIONS, openEmojiPicker, openStickerPicker, openGifPicker, stickerSvgDataUri } from './emoji.js';
import { renderMembersPanel } from './members.js';
import { joinVoiceChannel } from './voice.js';

let currentRoom = null; // { channelId } or { dmId }
let oldestLoadedTs = null;
let typingTimeout = null;
let pendingAttachment = null;

export function initChat() {
  const input = q('#composer-input');
  input.addEventListener('input', () => {
    autoGrow(input);
    handleTypingSignal();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });

  q('#attach-btn').addEventListener('click', () => q('#file-input').click());
  q('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { attachment } = await api.uploadAttachment(file);
      pendingAttachment = attachment;
      renderUploadPreview();
    } catch (err) { toastError('Upload failed', err.message); }
    e.target.value = '';
  });

  q('#emoji-btn').addEventListener('click', (e) => {
    openEmojiPicker(e.currentTarget, (emoji) => {
      const inp = q('#composer-input');
      inp.value += emoji;
      inp.focus();
    });
  });
  q('#gif-btn').addEventListener('click', (e) => {
    openGifPicker(e.currentTarget, (gif) => { pendingAttachment = gif; sendCurrentMessage(); });
  });
  q('#sticker-btn').addEventListener('click', (e) => {
    openStickerPicker(e.currentTarget, (sticker) => {
      pendingAttachment = { url: stickerSvgDataUri(sticker), kind: 'image', name: `${sticker.id}.svg` };
      sendCurrentMessage();
    });
  });

  const scrollEl = q('#messages-scroll');
  scrollEl.addEventListener('scroll', () => {
    if (scrollEl.scrollTop < 60) loadMoreHistory();
  });

  const socket = getSocket();
  socket.on('message:new', (msg) => {
    if (isMsgInCurrentRoom(msg)) appendMessage(msg);
    if (msg.dmId) bumpDmOrder(msg);
  });
  socket.on('message:updated', (msg) => { if (isMsgInCurrentRoom(msg)) updateMessageNode(msg); });
  socket.on('message:deleted', ({ id, channelId, dmId }) => {
    if ((channelId && currentRoom?.channelId === channelId) || (dmId && currentRoom?.dmId === dmId)) {
      const node = document.querySelector(`[data-msg-id="${id}"]`);
      if (node) node.remove();
    }
  });
  socket.on('message:pin_changed', ({ id, pinned }) => {
    const node = document.querySelector(`[data-msg-id="${id}"]`);
    if (node) node.classList.toggle('pinned-msg', pinned);
  });
  socket.on('typing:start', ({ channelId, dmId, user }) => {
    if (isRoomMatch(channelId, dmId)) showTyping(user);
  });
  socket.on('typing:stop', ({ channelId, dmId, userId }) => {
    if (isRoomMatch(channelId, dmId)) hideTyping(userId);
  });
}

function isRoomMatch(channelId, dmId) {
  return (channelId && currentRoom?.channelId === channelId) || (dmId && currentRoom?.dmId === dmId);
}
function isMsgInCurrentRoom(msg) {
  return (msg.channelId && currentRoom?.channelId === msg.channelId) || (msg.dmId && currentRoom?.dmId === msg.dmId);
}

export async function openChannel(channel) {
  currentRoom = { channelId: channel.id, name: channel.name, topic: channel.topic };
  state.activeChannelId = channel.id;
  if (channel.type === 'voice') {
    showVoiceView(channel);
    return;
  }
  showChatViewShell();
  renderChatHeader({ title: `# ${channel.name}`, topic: channel.topic, showSearch: true });
  getSocket().emit('channel:join', channel.id);
  await loadInitialMessages(() => api.channelMessages(channel.id));
  renderMembersPanel(state.activeServer);
  q('#members-panel').classList.remove('hidden');
}

export async function openDm(dm) {
  currentRoom = { dmId: dm.id, name: dmDisplayName(dm) };
  state.activeDmId = dm.id;
  showChatViewShell();
  const title = dmDisplayName(dm);
  renderChatHeader({ title, topic: null, showSearch: true, dmMembers: dm.members });
  getSocket().emit('dm:join', dm.id);
  await loadInitialMessages(() => api.dmMessages(dm.id));
  q('#members-panel').classList.add('hidden');
}

export function dmDisplayName(dm) {
  if (dm.isGroup) return dm.name || dm.members.map(m => m.displayName).join(', ');
  const other = dm.members.find(m => m.id !== state.currentUser.id) || dm.members[0];
  return other ? other.displayName : 'Unknown';
}

function showChatViewShell() {
  q('#no-selection-view').classList.add('hidden');
  q('#friends-view').classList.add('hidden');
  q('#voice-view').classList.add('hidden');
  q('#chat-view').classList.remove('hidden');
  q('#chat-view').style.display = 'flex';
}

function renderChatHeader({ title, topic, showSearch, dmMembers }) {
  const header = q('#chat-header');
  clear(header);
  header.appendChild(el('div', { class: 'title' }, title));
  if (topic) header.appendChild(el('div', { class: 'topic' }, topic));
  else header.appendChild(el('div', { class: 'flex-1' }));
  const actions = el('div', { class: 'header-actions' });
  if (dmMembers && dmMembers.length === 2) {
    actions.appendChild(el('button', { class: 'icon-btn', title: 'Voice Call', onclick: () => startDmCall(dmMembers) }, callIcon()));
  }
  actions.appendChild(el('button', { class: 'icon-btn', title: 'Pinned Messages', onclick: () => showPinnedMessages() }, pinIcon()));
  const search = el('div', { class: 'header-search' }, [
    searchIcon(),
    el('input', {
      type: 'text', placeholder: 'Search', onkeydown: async (e) => {
        if (e.key === 'Enter' && currentRoom?.channelId) {
          const { messages } = await api.searchChannel(currentRoom.channelId, e.target.value);
          showSearchResults(messages, e.target.value);
        }
      },
    }),
  ]);
  actions.appendChild(search);
  header.appendChild(actions);
}

function callIcon() { const s = el('span', {}); s.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5c0 8 7 15 15 15l3-4-6-3-2 2c-3-1-6-4-7-7l2-2-3-6Z" fill="currentColor"/></svg>'; return s; }
function pinIcon() { const s = el('span', {}); s.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2v6M8 8h8l1 5H7l1-5ZM12 13v9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>'; return s; }
function searchIcon() { const s = el('span', {}); s.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="m21 21-4-4" stroke="currentColor" stroke-width="2"/></svg>'; return s; }

async function loadInitialMessages(fetcher) {
  const scrollEl = q('#messages-scroll');
  clear(scrollEl);
  scrollEl.appendChild(el('div', { class: 'skeleton', style: 'height:40px;margin:10px 20px;' }));
  try {
    const { messages } = await fetcher();
    clear(scrollEl);
    if (!messages.length) {
      scrollEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big-hash' }, '#'),
        el('h3', {}, 'This is the start of the conversation.'),
        el('div', {}, 'Say hello 👋'),
      ]));
    } else {
      let lastDay = null, lastAuthor = null, lastTs = 0;
      for (const m of messages) {
        lastDay = maybeInsertDayDivider(scrollEl, m, lastDay);
        appendMessage(m, { grouped: shouldGroup(m, lastAuthor, lastTs) });
        lastAuthor = m.author.id; lastTs = m.createdAt;
      }
      oldestLoadedTs = messages[0].createdAt;
    }
    scrollEl.scrollTop = scrollEl.scrollHeight;
  } catch (err) {
    clear(scrollEl);
    scrollEl.appendChild(el('div', { class: 'empty-state' }, `Couldn't load messages: ${err.message}`));
  }
}

function shouldGroup(m, lastAuthor, lastTs) {
  return lastAuthor === m.author.id && (m.createdAt - lastTs) < 5 * 60 * 1000 && !m.replyTo;
}

function maybeInsertDayDivider(scrollEl, m, lastDay) {
  const day = formatDay(m.createdAt);
  if (day !== lastDay) scrollEl.appendChild(el('div', { class: 'day-divider' }, day));
  return day;
}

async function loadMoreHistory() {
  if (!currentRoom || !oldestLoadedTs) return;
  const scrollEl = q('#messages-scroll');
  const prevHeight = scrollEl.scrollHeight;
  try {
    const { messages } = currentRoom.channelId
      ? await api.channelMessages(currentRoom.channelId, oldestLoadedTs)
      : await api.dmMessages(currentRoom.dmId, oldestLoadedTs);
    if (!messages.length) return;
    const frag = document.createDocumentFragment();
    let lastDay = null;
    for (const m of messages) {
      const day = formatDay(m.createdAt);
      if (day !== lastDay) frag.appendChild(el('div', { class: 'day-divider' }, day));
      lastDay = day;
      frag.appendChild(buildMessageNode(m, {}));
    }
    scrollEl.insertBefore(frag, scrollEl.firstChild);
    oldestLoadedTs = messages[0].createdAt;
    scrollEl.scrollTop = scrollEl.scrollHeight - prevHeight;
  } catch (e) { /* silent */ }
}

function appendMessage(m, opts = {}) {
  const scrollEl = q('#messages-scroll');
  const wasAtBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
  scrollEl.appendChild(buildMessageNode(m, opts));
  if (wasAtBottom || opts.forceScroll) scrollEl.scrollTop = scrollEl.scrollHeight;
}

function buildMessageNode(m, { grouped = false } = {}) {
  const row = el('div', { class: `msg-row ${grouped ? 'grouped' : ''}`, 'data-msg-id': m.id, 'data-author-id': m.author.id });
  const gutter = el('div', { class: 'gutter' }, [
    avatarImg(m.author, 40, { onclick: () => openProfilePopout(m.author, event) }),
    el('div', { class: 'msg-time' }, formatClock(m.createdAt)),
  ]);
  const body = el('div', { class: 'msg-body' });

  if (m.replyTo) {
    body.appendChild(el('div', { class: 'msg-reply' }, [
      el('span', {}, '↪'),
      el('span', { class: 'r-author' }, m.replyTo.author?.displayName || 'Unknown'),
      el('span', {}, (m.replyTo.content || '').slice(0, 80)),
    ]));
  }
  if (!grouped) {
    body.appendChild(el('div', { class: 'msg-head' }, [
      el('span', { class: 'author', onclick: (e) => openProfilePopout(m.author, e) }, m.author.displayName),
      el('span', { class: 'ts' }, formatClock(m.createdAt)),
    ]));
  }
  if (m.content) {
    const contentNode = el('div', { class: `msg-content ${m.editedAt ? 'edited' : ''}` });
    contentNode.innerHTML = formatMessageContent(m.content);
    body.appendChild(contentNode);
  }
  if (m.attachment) body.appendChild(buildAttachmentNode(m.attachment));
  if (m.reactions && m.reactions.length) body.appendChild(buildReactionsNode(m));

  row.appendChild(gutter);
  row.appendChild(body);
  row.appendChild(buildHoverActions(m));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); openMessageMenu(e, m); });
  return row;
}

function buildAttachmentNode(att) {
  const wrap = el('div', { class: 'msg-attachment' });
  if (att.kind === 'image') wrap.appendChild(el('img', { src: att.url, loading: 'lazy' }));
  else if (att.kind === 'video') wrap.appendChild(el('video', { src: att.url, controls: true }));
  else {
    wrap.className = 'msg-file';
    wrap.appendChild(el('div', {}, '📄'));
    wrap.appendChild(el('div', {}, [
      el('div', { class: 'fname' }, [el('a', { href: att.url, target: '_blank' }, att.name)]),
      el('div', { class: 'fsize' }, att.size ? formatBytes(att.size) : ''),
    ]));
  }
  return wrap;
}

function buildReactionsNode(m) {
  const wrap = el('div', { class: 'msg-reactions' });
  for (const r of m.reactions) {
    const mine = r.userIds.includes(state.currentUser.id);
    wrap.appendChild(el('div', {
      class: `reaction-chip ${mine ? 'mine' : ''}`,
      onclick: () => toggleReaction(m.id, r.emoji),
    }, [el('span', {}, r.emoji), el('span', {}, String(r.userIds.length))]));
  }
  return wrap;
}

function buildHoverActions(m) {
  const wrap = el('div', { class: 'msg-hover-actions' });
  for (const emoji of QUICK_REACTIONS.slice(0, 3)) {
    wrap.appendChild(el('button', { class: 'icon-btn', onclick: () => toggleReaction(m.id, emoji) }, emoji));
  }
  wrap.appendChild(el('button', { class: 'icon-btn', title: 'More reactions', onclick: (e) => openEmojiPicker(e.currentTarget, (emoji) => toggleReaction(m.id, emoji)) }, '+'));
  wrap.appendChild(el('button', { class: 'icon-btn', title: 'Reply', onclick: () => startReply(m) }, replyIcon()));
  if (m.author.id === state.currentUser.id) {
    wrap.appendChild(el('button', { class: 'icon-btn', title: 'Edit', onclick: () => startEdit(m) }, '✏️'));
  }
  wrap.appendChild(el('button', { class: 'icon-btn', title: 'More', onclick: (e) => openMessageMenu(e, m) }, '⋯'));
  return wrap;
}
function replyIcon() { const s = el('span', {}); s.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'; return s; }

function openMessageMenu(e, m) {
  const items = [];
  items.push({ label: 'Add Reaction', action: () => openEmojiPicker(e.target, (emoji) => toggleReaction(m.id, emoji)) });
  items.push({ label: 'Reply', action: () => startReply(m) });
  items.push({ label: m.pinned ? 'Unpin Message' : 'Pin Message', action: () => togglePin(m) });
  items.push({ label: 'Copy Text', action: () => navigator.clipboard.writeText(m.content || '') });
  const canManage = m.author.id === state.currentUser.id || (state.activeServer && state.activeServer.ownerId === state.currentUser.id);
  if (m.author.id === state.currentUser.id) items.push({ label: 'Edit Message', action: () => startEdit(m) });
  if (canManage) items.push({ label: 'Delete Message', danger: true, action: () => deleteMessage(m.id) });
  openContextMenu(e.clientX, e.clientY, items);
}

function toggleReaction(messageId, emoji) {
  getSocket().emit('reaction:toggle', { messageId, emoji });
}
function togglePin(m) {
  getSocket().emit('message:pin', { id: m.id, pinned: !m.pinned });
}
function deleteMessage(id) {
  getSocket().emit('message:delete', { id });
}

function startReply(m) {
  state.replyTarget = m;
  state.editTarget = null;
  renderReplyBanner();
  q('#composer-input').focus();
}
function startEdit(m) {
  state.editTarget = m;
  state.replyTarget = null;
  q('#composer-input').value = m.content || '';
  autoGrow(q('#composer-input'));
  renderReplyBanner();
  q('#composer-input').focus();
}
function renderReplyBanner() {
  const wrap = q('#reply-banner-wrap');
  clear(wrap);
  if (state.replyTarget) {
    wrap.appendChild(el('div', { class: 'reply-banner' }, [
      el('span', {}, `Replying to ${state.replyTarget.author.displayName}`),
      el('span', { class: 'cancel', onclick: () => { state.replyTarget = null; renderReplyBanner(); } }, '✕'),
    ]));
  } else if (state.editTarget) {
    wrap.appendChild(el('div', { class: 'edit-banner' }, [
      el('span', {}, 'Editing message'),
      el('span', { class: 'cancel', onclick: () => { state.editTarget = null; q('#composer-input').value = ''; renderReplyBanner(); } }, '✕'),
    ]));
  }
}

function renderUploadPreview() {
  const strip = q('#upload-preview-strip');
  clear(strip);
  if (!pendingAttachment) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  const chip = el('div', { class: 'upload-chip' }, [
    pendingAttachment.kind === 'image' ? el('img', { src: pendingAttachment.url }) : el('div', { style: 'display:flex;align-items:center;justify-content:center;height:100%;font-size:22px;' }, '📄'),
    el('div', { class: 'remove', onclick: () => { pendingAttachment = null; renderUploadPreview(); } }, '✕'),
  ]);
  strip.appendChild(chip);
}

async function sendCurrentMessage() {
  const input = q('#composer-input');
  const content = input.value.trim();
  if (!content && !pendingAttachment) return;
  if (!currentRoom) return;

  if (state.editTarget) {
    getSocket().emit('message:edit', { id: state.editTarget.id, content });
    state.editTarget = null;
    input.value = '';
    renderReplyBanner();
    autoGrow(input);
    return;
  }

  const payload = {
    channelId: currentRoom.channelId,
    dmId: currentRoom.dmId,
    content: content || null,
    attachment: pendingAttachment,
    replyTo: state.replyTarget?.id || null,
  };
  getSocket().emit('message:send', payload, (res) => {
    if (res?.error) toastError('Message failed', res.error);
  });
  input.value = '';
  pendingAttachment = null;
  state.replyTarget = null;
  renderReplyBanner();
  renderUploadPreview();
  autoGrow(input);
  getSocket().emit('typing:stop', { channelId: currentRoom.channelId, dmId: currentRoom.dmId });
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(180, textarea.scrollHeight) + 'px';
}

function handleTypingSignal() {
  if (!currentRoom) return;
  const socket = getSocket();
  socket.emit('typing:start', { channelId: currentRoom.channelId, dmId: currentRoom.dmId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing:stop', { channelId: currentRoom.channelId, dmId: currentRoom.dmId }), 2500);
}

const typingUsers = new Map();
function showTyping(user) {
  typingUsers.set(user.id, user.displayName);
  renderTypingBar();
  clearTimeout(typingUsers[`t_${user.id}`]);
}
function hideTyping(userId) {
  typingUsers.delete(userId);
  renderTypingBar();
}
function renderTypingBar() {
  const bar = q('#typing-bar');
  const names = Array.from(typingUsers.values());
  if (!names.length) { bar.textContent = ''; return; }
  const text = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `Several people are typing…`;
  bar.textContent = text;
}

function updateMessageNode(m) {
  const node = document.querySelector(`[data-msg-id="${m.id}"]`);
  if (!node) return;
  const contentNode = node.querySelector('.msg-content');
  if (contentNode) {
    contentNode.className = `msg-content ${m.editedAt ? 'edited' : ''}`;
    contentNode.innerHTML = formatMessageContent(m.content);
  }
  let reactionsNode = node.querySelector('.msg-reactions');
  const newReactions = m.reactions && m.reactions.length ? buildReactionsNode(m) : null;
  if (reactionsNode) reactionsNode.replaceWith(newReactions || document.createTextNode(''));
  else if (newReactions) node.querySelector('.msg-body').appendChild(newReactions);
}

function bumpDmOrder(msg) {
  // handled by re-render on next dms.js refresh; kept intentionally lightweight
}

async function showPinnedMessages() {
  if (!currentRoom?.channelId) return;
  const { messages } = await api.pinnedMessages(currentRoom.channelId);
  const { openModal } = await import('./modal.js');
  const body = el('div', {});
  if (!messages.length) body.appendChild(el('div', { style: 'color:var(--text-muted);' }, 'No pinned messages yet.'));
  for (const m of messages) {
    body.appendChild(el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--bg-tertiary);' }, [
      el('div', { style: 'font-weight:700;' }, m.author.displayName),
      el('div', {}, m.content || '[attachment]'),
    ]));
  }
  openModal({ title: 'Pinned Messages', bodyNode: body });
}

function showSearchResults(messages, query) {
  const scrollEl = q('#messages-scroll');
  clear(scrollEl);
  scrollEl.appendChild(el('div', { style: 'padding:14px 20px;color:var(--text-muted);' }, `${messages.length} result(s) for "${query}"`));
  for (const m of messages) scrollEl.appendChild(buildMessageNode(m, {}));
}

function showVoiceView(channel) {
  q('#chat-view').classList.add('hidden');
  q('#friends-view').classList.add('hidden');
  q('#no-selection-view').classList.add('hidden');
  q('#voice-view').classList.remove('hidden');
  q('#voice-view').style.display = 'flex';
  q('#members-panel').classList.add('hidden');
  joinVoiceChannel(channel);
}

function startDmCall(members) {
  const other = members.find(m => m.id !== state.currentUser.id);
  if (!other) return;
  import('./voice.js').then(({ startDirectCall }) => startDirectCall(other));
}

export function getCurrentRoom() { return currentRoom; }
