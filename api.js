// api.js — thin wrapper around fetch() for the Zenith REST API.

const TOKEN_KEY = 'zenith_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

async function request(method, path, body, isForm) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  register: (body) => request('POST', '/auth/register', body),
  login: (body) => request('POST', '/auth/login', body),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  sessions: () => request('GET', '/auth/sessions'),
  revokeSession: (id) => request('DELETE', `/auth/sessions/${id}`),
  forgotPassword: (email) => request('POST', '/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) => request('POST', '/auth/reset-password', { token, newPassword }),

  // users
  updateMe: (body) => request('PATCH', '/users/me', body),
  uploadAvatar: (file) => { const fd = new FormData(); fd.append('avatar', file); return request('POST', '/users/me/avatar', fd, true); },
  uploadBanner: (file) => { const fd = new FormData(); fd.append('banner', file); return request('POST', '/users/me/banner', fd, true); },
  searchUsers: (q) => request('GET', `/users/search?q=${encodeURIComponent(q)}`),
  getUser: (id) => request('GET', `/users/${id}`),
  getFriends: () => request('GET', '/users/me/friends'),
  sendFriendRequest: (username) => request('POST', '/users/me/friends/request', { username }),
  acceptFriend: (id) => request('POST', `/users/me/friends/${id}/accept`),
  removeFriend: (id) => request('DELETE', `/users/me/friends/${id}`),
  blockUser: (id) => request('POST', `/users/me/friends/${id}/block`),

  // servers
  listServers: () => request('GET', '/servers'),
  createServer: (name) => request('POST', '/servers', { name }),
  getServer: (id) => request('GET', `/servers/${id}`),
  joinServer: (inviteCode) => request('POST', '/servers/join', { inviteCode }),
  leaveServer: (id) => request('POST', `/servers/${id}/leave`),
  deleteServer: (id) => request('DELETE', `/servers/${id}`),
  updateServer: (id, body) => request('PATCH', `/servers/${id}`, body),
  uploadServerIcon: (id, file) => { const fd = new FormData(); fd.append('icon', file); return request('POST', `/servers/${id}/icon`, fd, true); },
  createCategory: (id, name) => request('POST', `/servers/${id}/categories`, { name }),
  deleteCategory: (id, catId) => request('DELETE', `/servers/${id}/categories/${catId}`),
  createChannel: (id, body) => request('POST', `/servers/${id}/channels`, body),
  updateChannel: (id, chId, body) => request('PATCH', `/servers/${id}/channels/${chId}`, body),
  deleteChannel: (id, chId) => request('DELETE', `/servers/${id}/channels/${chId}`),
  createRole: (id, body) => request('POST', `/servers/${id}/roles`, body),
  setMemberRoles: (id, userId, roleIds) => request('POST', `/servers/${id}/members/${userId}/roles`, { roleIds }),

  // messages
  uploadAttachment: (file) => { const fd = new FormData(); fd.append('file', file); return request('POST', '/messages/upload', fd, true); },
  channelMessages: (channelId, before) => request('GET', `/messages/channel/${channelId}${before ? `?before=${before}` : ''}`),
  dmMessages: (dmId, before) => request('GET', `/messages/dm/${dmId}${before ? `?before=${before}` : ''}`),
  searchChannel: (channelId, q) => request('GET', `/messages/search/channel/${channelId}?q=${encodeURIComponent(q)}`),
  pinnedMessages: (channelId) => request('GET', `/messages/pinned/${channelId}`),
  listDms: () => request('GET', '/messages/dms'),
  createDm: (userIds, name) => request('POST', '/messages/dms', { userIds, name }),
};
