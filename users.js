const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('../db');
const { authMiddleware, publicUser, privateUser } = require('../utils');

const router = express.Router();

const avatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'avatars'),
  filename: (req, file, cb) => cb(null, `${req.userId}_${Date.now()}${path.extname(file.originalname)}`),
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 8 * 1024 * 1024 } });

router.patch('/me', authMiddleware, (req, res) => {
  const { displayName, aboutMe, customStatus, status, accentColor, activity } = req.body || {};
  const fields = [];
  const values = [];
  if (displayName !== undefined) { fields.push('display_name = ?'); values.push(String(displayName).slice(0, 32) || req.user.username); }
  if (aboutMe !== undefined) { fields.push('about_me = ?'); values.push(String(aboutMe).slice(0, 500)); }
  if (customStatus !== undefined) { fields.push('custom_status = ?'); values.push(String(customStatus).slice(0, 128)); }
  if (activity !== undefined) { fields.push('activity = ?'); values.push(String(activity).slice(0, 128)); }
  if (accentColor !== undefined) { fields.push('accent_color = ?'); values.push(String(accentColor).slice(0, 16)); }
  if (status !== undefined && ['online', 'idle', 'dnd', 'invisible'].includes(status)) {
    fields.push('status = ?'); values.push(status);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(req.userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  req.app.get('io').emit('presence:update', publicUser(user));
  res.json({ user: privateUser(user) });
});

router.post('/me/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const url = `/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, req.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  req.app.get('io').emit('presence:update', publicUser(user));
  res.json({ user: privateUser(user) });
});

const bannerStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'avatars'),
  filename: (req, file, cb) => cb(null, `banner_${req.userId}_${Date.now()}${path.extname(file.originalname)}`),
});
const uploadBanner = multer({ storage: bannerStorage, limits: { fileSize: 8 * 1024 * 1024 } });

router.post('/me/banner', authMiddleware, uploadBanner.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const url = `/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET banner = ? WHERE id = ?').run(url, req.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: privateUser(user) });
});

router.get('/search', authMiddleware, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ users: [] });
  const rows = db.prepare(`SELECT * FROM users WHERE username_lower LIKE ? LIMIT 20`).all(`%${q}%`);
  res.json({ users: rows.map(publicUser) });
});

router.get('/:id', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  // mutual servers
  const mutualServers = db.prepare(`
    SELECT s.id, s.name FROM servers s
    JOIN server_members sm1 ON sm1.server_id = s.id AND sm1.user_id = ?
    JOIN server_members sm2 ON sm2.server_id = s.id AND sm2.user_id = ?
  `).all(req.userId, req.params.id);
  res.json({ user: publicUser(user), mutualServers });
});

// ---- Friends ----

router.get('/me/friends', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.* FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
  `).all(req.userId);
  res.json({
    friends: rows.filter(r => r.status === 'accepted').map(publicUser),
    incoming: rows.filter(r => r.status === 'pending' && r.requested_by !== req.userId).map(publicUser),
    outgoing: rows.filter(r => r.status === 'pending' && r.requested_by === req.userId).map(publicUser),
    blocked: rows.filter(r => r.status === 'blocked' && r.requested_by === req.userId).map(publicUser),
  });
});

router.post('/me/friends/request', authMiddleware, (req, res) => {
  const { username } = req.body || {};
  const target = db.prepare('SELECT * FROM users WHERE username_lower = ?').get(String(username || '').toLowerCase());
  if (!target) return res.status(404).json({ error: 'No user found with that username.' });
  if (target.id === req.userId) return res.status(400).json({ error: "You can't friend yourself." });

  const existing = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?').get(req.userId, target.id);
  if (existing) return res.status(409).json({ error: `Friend request already ${existing.status}.` });

  const now = Date.now();
  db.prepare('INSERT INTO friends (user_id, friend_id, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, target.id, 'pending', req.userId, now);
  db.prepare('INSERT INTO friends (user_id, friend_id, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(target.id, req.userId, 'pending', req.userId, now);

  req.app.get('io').to(`user:${target.id}`).emit('friend:request', publicUser(req.user));
  res.json({ ok: true, user: publicUser(target) });
});

router.post('/me/friends/:id/accept', authMiddleware, (req, res) => {
  const other = req.params.id;
  const row = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?').get(req.userId, other);
  if (!row || row.status !== 'pending') return res.status(404).json({ error: 'No pending request from that user.' });
  db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(req.userId, other);
  db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(other, req.userId);
  const io = req.app.get('io');
  io.to(`user:${other}`).emit('friend:accepted', publicUser(req.user));
  io.to(`user:${req.userId}`).emit('friend:accepted', publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(other)));
  res.json({ ok: true });
});

router.delete('/me/friends/:id', authMiddleware, (req, res) => {
  const other = req.params.id;
  db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.userId, other);
  db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(other, req.userId);
  req.app.get('io').to(`user:${other}`).emit('friend:removed', { userId: req.userId });
  res.json({ ok: true });
});

router.post('/me/friends/:id/block', authMiddleware, (req, res) => {
  const other = req.params.id;
  const now = Date.now();
  db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.userId, other);
  db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(other, req.userId);
  db.prepare('INSERT INTO friends (user_id, friend_id, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, other, 'blocked', req.userId, now);
  res.json({ ok: true });
});

module.exports = router;
