const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('../db');
const { authMiddleware, publicUser } = require('../utils');

const router = express.Router();

const iconStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'avatars'),
  filename: (req, file, cb) => cb(null, `servericon_${Date.now()}${path.extname(file.originalname)}`),
});
const uploadIcon = multer({ storage: iconStorage, limits: { fileSize: 8 * 1024 * 1024 } });

function isMember(serverId, userId) {
  return !!db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
}
function isOwner(serverId, userId) {
  const s = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
  return s && s.owner_id === userId;
}

function serializeServer(server, userId) {
  const categories = db.prepare('SELECT * FROM categories WHERE server_id = ? ORDER BY position').all(server.id);
  const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position').all(server.id);
  const members = db.prepare(`
    SELECT sm.*, u.* FROM server_members sm JOIN users u ON u.id = sm.user_id WHERE sm.server_id = ?
  `).all(server.id);
  const roles = db.prepare('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC').all(server.id);
  return {
    id: server.id,
    name: server.name,
    icon: server.icon,
    ownerId: server.owner_id,
    inviteCode: server.invite_code,
    createdAt: server.created_at,
    categories: categories.map(c => ({ id: c.id, name: c.name, position: c.position })),
    channels: channels.map(c => ({ id: c.id, name: c.name, type: c.type, topic: c.topic, categoryId: c.category_id, position: c.position })),
    roles: roles.map(r => ({ id: r.id, name: r.name, color: r.color, permissions: JSON.parse(r.permissions || '{}'), position: r.position })),
    members: members.map(m => ({
      ...publicUser(m),
      nickname: m.nickname,
      roles: JSON.parse(m.roles || '[]'),
      joinedAt: m.joined_at,
    })),
  };
}

router.get('/', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT s.* FROM servers s JOIN server_members sm ON sm.server_id = s.id WHERE sm.user_id = ?
  `).all(req.userId);
  res.json({ servers: rows.map(s => ({ id: s.id, name: s.name, icon: s.icon, ownerId: s.owner_id, inviteCode: s.invite_code })) });
});

router.post('/', authMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Server name is required.' });
  const id = nanoid();
  const inviteCode = nanoid(8);
  const now = Date.now();
  db.prepare('INSERT INTO servers (id, name, icon, owner_id, invite_code, created_at) VALUES (?, ?, NULL, ?, ?, ?)')
    .run(id, String(name).trim().slice(0, 100), req.userId, inviteCode, now);
  db.prepare('INSERT INTO server_members (server_id, user_id, roles, joined_at) VALUES (?, ?, ?, ?)')
    .run(id, req.userId, '[]', now);

  const generalCat = nanoid();
  db.prepare('INSERT INTO categories (id, server_id, name, position) VALUES (?, ?, ?, 0)').run(generalCat, id, 'General');
  const textCh = nanoid();
  db.prepare('INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, 0)')
    .run(textCh, id, generalCat, 'general', 'text');
  const voiceCh = nanoid();
  db.prepare('INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, 1)')
    .run(voiceCh, id, generalCat, 'General Voice', 'voice');

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  res.json({ server: serializeServer(server, req.userId) });
});

router.get('/:id', authMiddleware, (req, res) => {
  if (!isMember(req.params.id, req.userId)) return res.status(403).json({ error: 'Not a member of this server.' });
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found.' });
  res.json({ server: serializeServer(server, req.userId) });
});

router.post('/join', authMiddleware, (req, res) => {
  const { inviteCode } = req.body || {};
  const server = db.prepare('SELECT * FROM servers WHERE invite_code = ?').get(String(inviteCode || '').trim());
  if (!server) return res.status(404).json({ error: 'Invalid invite code.' });
  if (isMember(server.id, req.userId)) return res.status(409).json({ error: "You're already in this server." });
  db.prepare('INSERT INTO server_members (server_id, user_id, roles, joined_at) VALUES (?, ?, ?, ?)')
    .run(server.id, req.userId, '[]', Date.now());
  req.app.get('io').to(`server:${server.id}`).emit('server:member_joined', { serverId: server.id, user: publicUser(req.user) });
  res.json({ server: serializeServer(server, req.userId) });
});

router.post('/:id/leave', authMiddleware, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found.' });
  if (server.owner_id === req.userId) return res.status(400).json({ error: 'Owners must transfer ownership or delete the server instead of leaving.' });
  db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(req.params.id, req.userId);
  req.app.get('io').to(`server:${req.params.id}`).emit('server:member_left', { serverId: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can delete this server.' });
  db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  req.app.get('io').to(`server:${req.params.id}`).emit('server:deleted', { serverId: req.params.id });
  res.json({ ok: true });
});

router.patch('/:id', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can edit server settings.' });
  const { name } = req.body || {};
  if (name) db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(String(name).trim().slice(0, 100), req.params.id);
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  req.app.get('io').to(`server:${req.params.id}`).emit('server:updated', serializeServer(server, req.userId));
  res.json({ server: serializeServer(server, req.userId) });
});

router.post('/:id/icon', authMiddleware, uploadIcon.single('icon'), (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can change the server icon.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const url = `/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE servers SET icon = ? WHERE id = ?').run(url, req.params.id);
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  req.app.get('io').to(`server:${req.params.id}`).emit('server:updated', serializeServer(server, req.userId));
  res.json({ server: serializeServer(server, req.userId) });
});

// ---- Categories ----
router.post('/:id/categories', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can manage categories.' });
  const { name } = req.body || {};
  const id = nanoid();
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM categories WHERE server_id = ?').get(req.params.id).m || 0;
  db.prepare('INSERT INTO categories (id, server_id, name, position) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, String(name || 'New Category').slice(0, 50), maxPos + 1);
  broadcastServer(req, req.params.id);
  res.json({ ok: true, id });
});

router.delete('/:id/categories/:catId', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can manage categories.' });
  db.prepare('DELETE FROM categories WHERE id = ? AND server_id = ?').run(req.params.catId, req.params.id);
  broadcastServer(req, req.params.id);
  res.json({ ok: true });
});

// ---- Channels ----
router.post('/:id/channels', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can create channels.' });
  const { name, type, categoryId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Channel name is required.' });
  const id = nanoid();
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM channels WHERE server_id = ?').get(req.params.id).m || 0;
  db.prepare('INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, categoryId || null, String(name).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 50), type === 'voice' ? 'voice' : 'text', maxPos + 1);
  broadcastServer(req, req.params.id);
  res.json({ ok: true, id });
});

router.patch('/:id/channels/:chId', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can edit channels.' });
  const { name, topic } = req.body || {};
  if (name) db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(String(name).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 50), req.params.chId);
  if (topic !== undefined) db.prepare('UPDATE channels SET topic = ? WHERE id = ?').run(String(topic).slice(0, 200), req.params.chId);
  broadcastServer(req, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/channels/:chId', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can delete channels.' });
  db.prepare('DELETE FROM channels WHERE id = ? AND server_id = ?').run(req.params.chId, req.params.id);
  broadcastServer(req, req.params.id);
  res.json({ ok: true });
});

// ---- Roles ----
router.post('/:id/roles', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can manage roles.' });
  const { name, color } = req.body || {};
  const id = nanoid();
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM roles WHERE server_id = ?').get(req.params.id).m || 0;
  db.prepare('INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, String(name || 'New Role').slice(0, 40), color || '#99aab5', '{}', maxPos + 1);
  broadcastServer(req, req.params.id);
  res.json({ ok: true, id });
});

router.post('/:id/members/:userId/roles', authMiddleware, (req, res) => {
  if (!isOwner(req.params.id, req.userId)) return res.status(403).json({ error: 'Only the owner can assign roles.' });
  const { roleIds } = req.body || {};
  db.prepare('UPDATE server_members SET roles = ? WHERE server_id = ? AND user_id = ?')
    .run(JSON.stringify(roleIds || []), req.params.id, req.params.userId);
  broadcastServer(req, req.params.id);
  res.json({ ok: true });
});

function broadcastServer(req, serverId) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (server) req.app.get('io').to(`server:${serverId}`).emit('server:updated', serializeServer(server, req.userId));
}

module.exports = router;
