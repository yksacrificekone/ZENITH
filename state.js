// state.js — a small in-memory store. Not reactive framework magic, just
// a shared object plus a pub/sub so UI modules can re-render on change.

export const state = {
  currentUser: null,
  servers: [],          // [{id,name,icon,ownerId,inviteCode}]
  activeServer: null,    // full serialized server object, or null (home view)
  activeChannelId: null,
  activeDmId: null,
  dms: [],
  friendsData: { friends: [], incoming: [], outgoing: [], blocked: [] },
  presence: new Map(),   // userId -> publicUser (live status/activity)
  typing: new Map(),     // roomKey -> Map(userId -> username)
  voiceRoomMembers: new Map(), // channelId -> [{user, muted, deafened, screenSharing}]
  currentVoiceChannelId: null,
  replyTarget: null,
  editTarget: null,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify(topic) { for (const fn of listeners) fn(topic); }

export function mergePresence(user) {
  if (!user || !user.id) return;
  state.presence.set(user.id, user);
  notify('presence');
}

export function getPresence(userId) {
  return state.presence.get(userId) || null;
}
