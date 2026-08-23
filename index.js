const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const db = require('../db');
const { JWT_SECRET, publicUser } = require('../utils');
const { serializeMessage, canAccessChannel, canAccessDm } = require('../routes/messages');

// voiceRooms: channelId -> Map(userId -> { socketId, muted, deafened, screenSharing })
const voiceRooms = new Map();

function userServerRooms(userId) {
  return db.prepare('SELECT server_id FROM server_members WHERE user_id = ?').all(userId).map(r => r.server_id);
}
function userDmRooms(userId) {
  return db.prepare('SELECT dm_id FROM dm_members WHERE user_id = ?').all(userId).map(r => r.dm_id);
}
function friendIds(userId) {
  return db.prepare("SELECT friend_id FROM friends WHERE user_id = ? AND status = 'accepted'").all(userId).map(r => r.friend_id);
}

function attachSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
      if (!user) return next(new Error('Unauthorized'));
      socket.userId = payload.uid;
      next();
    } catch (e) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);
    for (const sid of userServerRooms(userId)) socket.join(`server:${sid}`);
    for (const did of userDmRooms(userId)) socket.join(`dm:${did}`);

    db.prepare("UPDATE users SET status = CASE WHEN status = 'invisible' THEN status ELSE 'online' END WHERE id = ?").run(userId);
    broadcastPresence(io, userId);

    // ---- Messaging ----
    socket.on('message:send', (payload, ack) => {
      try {
        const { channelId, dmId, content, attachment, replyTo } = payload || {};
        if (!content && !attachment) return ack && ack({ error: 'Message is empty.' });
        if (channelId && !canAccessChannel(userId, channelId)) return ack && ack({ error: 'No access to this channel.' });
        if (dmId && !canAccessDm(userId, dmId)) return ack && ack({ error: 'No access to this conversation.' });
        if (!channelId && !dmId) return ack && ack({ error: 'No destination specified.' });

        const id = nanoid();
        const now = Date.now();
        db.prepare(`INSERT INTO messages (id, channel_id, dm_id, author_id, content, attachment, reply_to, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, channelId || null, dmId || null, userId, content ? String(content).slice(0, 4000) : null,
            attachment ? JSON.stringify(attachment) : null, replyTo || null, now);

        const msg = serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
        const room = channelId ? `channel:${channelId}` : `dm:${dmId}`;
        io.to(room).emit('message:new', msg);
        ack && ack({ message: msg });
      } catch (e) {
        ack && ack({ error: 'Failed to send message.' });
      }
    });

    socket.on('channel:join', (channelId) => {
      if (canAccessChannel(userId, channelId)) socket.join(`channel:${channelId}`);
    });
    socket.on('channel:leave', (channelId) => socket.leave(`channel:${channelId}`));
    socket.on('dm:join', (dmId) => {
      if (canAccessDm(userId, dmId)) socket.join(`dm:${dmId}`);
    });

    socket.on('message:edit', ({ id, content }, ack) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
      if (!m || m.author_id !== userId) return ack && ack({ error: 'Cannot edit this message.' });
      db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(String(content).slice(0, 4000), Date.now(), id);
      const msg = serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
      const room = m.channel_id ? `channel:${m.channel_id}` : `dm:${m.dm_id}`;
      io.to(room).emit('message:updated', msg);
      ack && ack({ message: msg });
    });

    socket.on('message:delete', ({ id }, ack) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
      if (!m) return ack && ack({ error: 'Message not found.' });
      let allowed = m.author_id === userId;
      if (!allowed && m.channel_id) {
        const ch = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(m.channel_id);
        if (ch) allowed = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(ch.server_id)?.owner_id === userId;
      }
      if (!allowed) return ack && ack({ error: 'Cannot delete this message.' });
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
      const room = m.channel_id ? `channel:${m.channel_id}` : `dm:${m.dm_id}`;
      io.to(room).emit('message:deleted', { id, channelId: m.channel_id, dmId: m.dm_id });
      ack && ack({ ok: true });
    });

    socket.on('message:pin', ({ id, pinned }, ack) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
      if (!m) return ack && ack({ error: 'Message not found.' });
      db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
      const room = m.channel_id ? `channel:${m.channel_id}` : `dm:${m.dm_id}`;
      io.to(room).emit('message:pin_changed', { id, pinned: !!pinned });
      ack && ack({ ok: true });
    });

    socket.on('reaction:toggle', ({ messageId, emoji }, ack) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!m) return ack && ack({ error: 'Message not found.' });
      const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, userId, emoji);
      if (existing) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
      else db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, userId, emoji);
      const msg = serializeMessage(m);
      const room = m.channel_id ? `channel:${m.channel_id}` : `dm:${m.dm_id}`;
      io.to(room).emit('message:updated', msg);
      ack && ack({ ok: true });
    });

    socket.on('typing:start', ({ channelId, dmId }) => {
      const room = channelId ? `channel:${channelId}` : `dm:${dmId}`;
      socket.to(room).emit('typing:start', { channelId, dmId, user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId)) });
    });
    socket.on('typing:stop', ({ channelId, dmId }) => {
      const room = channelId ? `channel:${channelId}` : `dm:${dmId}`;
      socket.to(room).emit('typing:stop', { channelId, dmId, userId });
    });

    // ---- Presence ----
    socket.on('presence:set', (status) => {
      if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) return;
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
      broadcastPresence(io, userId);
    });
    socket.on('activity:set', (activity) => {
      db.prepare('UPDATE users SET activity = ? WHERE id = ?').run(activity ? String(activity).slice(0, 128) : null, userId);
      broadcastPresence(io, userId);
    });

    // ---- Voice channels (WebRTC mesh signaling) ----
    socket.on('voice:join', ({ channelId }, ack) => {
      if (!canAccessChannel(userId, channelId)) return ack && ack({ error: 'No access to this channel.' });
      // leave any other voice room first
      leaveAllVoice(io, socket, userId);

      if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());
      const room = voiceRooms.get(channelId);
      const existingPeers = Array.from(room.keys());
      room.set(userId, { socketId: socket.id, muted: false, deafened: false, screenSharing: false });
      socket.join(`voice:${channelId}`);
      socket.data.voiceChannelId = channelId;

      const u = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
      socket.to(`voice:${channelId}`).emit('voice:peer_joined', { channelId, user: u });
      broadcastVoiceRoom(io, channelId);
      ack && ack({ peers: existingPeers });
    });

    socket.on('voice:leave', () => {
      leaveAllVoice(io, socket, userId);
    });

    socket.on('voice:signal', ({ toUserId, signal }) => {
      const channelId = socket.data.voiceChannelId;
      if (!channelId) return;
      const room = voiceRooms.get(channelId);
      const target = room && room.get(toUserId);
      if (target) io.to(target.socketId).emit('voice:signal', { fromUserId: userId, signal });
    });

    socket.on('voice:state', ({ muted, deafened, screenSharing }) => {
      const channelId = socket.data.voiceChannelId;
      if (!channelId) return;
      const room = voiceRooms.get(channelId);
      const entry = room && room.get(userId);
      if (!entry) return;
      if (muted !== undefined) entry.muted = muted;
      if (deafened !== undefined) entry.deafened = deafened;
      if (screenSharing !== undefined) entry.screenSharing = screenSharing;
      broadcastVoiceRoom(io, channelId);
    });

    // ---- WebRTC for 1:1 DM calls ----
    socket.on('call:signal', ({ toUserId, signal }) => {
      io.to(`user:${toUserId}`).emit('call:signal', { fromUserId: userId, signal });
    });
    socket.on('call:ring', ({ toUserId, dmId }) => {
      io.to(`user:${toUserId}`).emit('call:ring', { fromUserId: userId, dmId, from: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId)) });
    });
    socket.on('call:end', ({ toUserId }) => {
      io.to(`user:${toUserId}`).emit('call:end', { fromUserId: userId });
    });

    socket.on('disconnect', () => {
      leaveAllVoice(io, socket, userId);
      const stillConnected = io.sockets.adapter.rooms.get(`user:${userId}`);
      if (!stillConnected || stillConnected.size === 0) {
        db.prepare("UPDATE users SET status = 'offline' WHERE id = ?").run(userId);
        broadcastPresence(io, userId);
      }
    });
  });
}

function leaveAllVoice(io, socket, userId) {
  const channelId = socket.data.voiceChannelId;
  if (!channelId) return;
  const room = voiceRooms.get(channelId);
  if (room) {
    room.delete(userId);
    if (room.size === 0) voiceRooms.delete(channelId);
  }
  socket.leave(`voice:${channelId}`);
  socket.to(`voice:${channelId}`).emit('voice:peer_left', { channelId, userId });
  socket.data.voiceChannelId = null;
  broadcastVoiceRoom(io, channelId);
}

function broadcastVoiceRoom(io, channelId) {
  const room = voiceRooms.get(channelId);
  const members = room
    ? Array.from(room.entries()).map(([uid, s]) => ({
        user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(uid)),
        muted: s.muted, deafened: s.deafened, screenSharing: s.screenSharing,
      }))
    : [];
  io.emit('voice:room_update', { channelId, members });
}

function broadcastPresence(io, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  io.emit('presence:update', publicUser(user));
}

module.exports = { attachSocket };
