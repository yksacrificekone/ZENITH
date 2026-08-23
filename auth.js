const express = require('express');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const db = require('../db');
const { signToken, authMiddleware, privateUser } = require('../utils');

const router = express.Router();

const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;

router.post('/register', (req, res) => {
  const { username, email, password, displayName } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required.' });
  }
  const uname = String(username).trim();
  if (!USERNAME_RE.test(uname.toLowerCase())) {
    return res.status(400).json({ error: 'Username must be 3-32 characters: lowercase letters, numbers, dots, underscores.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username_lower = ? OR email = ?')
    .get(uname.toLowerCase(), String(email).toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Username or email is already taken.' });
  }

  const id = nanoid();
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  // First-ever account becomes the owner account, named requirement from spec.
  const isFirstUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;

  db.prepare(`INSERT INTO users (id, username, username_lower, display_name, email, password_hash, avatar, status, created_at, is_owner_account, points)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 'online', ?, ?, 0)`)
    .run(id, uname, uname.toLowerCase(), displayName?.trim() || uname, String(email).toLowerCase(), hash, now, isFirstUser ? 1 : 0);

  const sessionId = nanoid();
  db.prepare('INSERT INTO sessions (id, user_id, device_label, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, id, req.headers['user-agent'] || 'Unknown device', now, now);

  const token = signToken(id, sessionId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ token, user: privateUser(user) });
});

router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username/email and password are required.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username_lower = ? OR email = ?')
    .get(String(identifier).toLowerCase(), String(identifier).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username/email or password.' });
  }
  const now = Date.now();
  const sessionId = nanoid();
  db.prepare('INSERT INTO sessions (id, user_id, device_label, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, user.id, req.headers['user-agent'] || 'Unknown device', now, now);
  db.prepare("UPDATE users SET status = 'online' WHERE id = ?").run(user.id);
  const token = signToken(user.id, sessionId);
  res.json({ token, user: privateUser(user) });
});

router.post('/logout', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: privateUser(req.user) });
});

router.get('/sessions', authMiddleware, (req, res) => {
  const sessions = db.prepare('SELECT id, device_label, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC')
    .all(req.userId);
  res.json({ sessions: sessions.map(s => ({ ...s, isCurrent: s.id === req.sessionId })) });
});

router.delete('/sessions/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

// Simple reset-token flow. In production this would email the link;
// here we return the token directly since there's no mail service configured.
router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user) return res.json({ ok: true }); // don't leak whether the email exists
  const token = nanoid(32);
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, user.id, Date.now() + 1000 * 60 * 30);
  res.json({ ok: true, resetToken: token, note: 'No email service is configured, so the reset token is returned here directly.' });
});

router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  const row = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!row || row.expires_at < Date.now()) {
    return res.status(400).json({ error: 'Reset link is invalid or expired.' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
  db.prepare('DELETE FROM password_resets WHERE token = ?').run(token);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id); // log out everywhere
  res.json({ ok: true });
});

module.exports = router;
