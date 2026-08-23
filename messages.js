const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('../db');
const { authMiddleware, publicUser } = require('../utils');

const router = express.Router();

const attachStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'attachments'),
  filename: (req, file, cb) => cb(null, `${nanoid()}${path.extname(file.originalname)}`),
});
// Free tier cap. (Premium tier removed for now — this is the flat limit for everyone.)
const uploadAttachment = multer({ storage: attachStorage, limits: { fileSize: 25 * 1024 * 1024 } });

function canAccessChannel(userId, channelId) {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!ch) return false;
  return !!db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(ch.server_id, userId);
}
function canAccessDm(userId, dmId) {
  return !!db.prepare('SELECT 1 FROM dm_members WHERE dm_id = ? AND user_id = ?').get(dmId, userId);
}

function serializeMessage(m) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(m.author_id);
  const reactions = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?').all(m.id);
  const grouped = {};
  for (const r of reactions) {
    grouped[r.emoji] = grouped[r.emoji] || [];
    grouped[r.emoji].push(r.user_id);
  }
  let replyPreview = null;
  if (m.reply_to) {
    const rm = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.reply_to);
    if (rm) {
      const ra = db.prepare('SELECT * FROM users WHERE id = ?').get(rm.author_id);
      replyPreview = { id: rm.id, content: rm.content, author: publicUser(ra) };
    }
  }
  return {
    id: m.id,
    channelId: m.channel_id,
    dmId: m.dm_id,
    author: publicUser(author),
    content: m.content,
    attachment: m.attachment ? JSON.parse(m.attachment) : null,
    replyTo: replyPreview,
    editedAt: m.edited_at,
    createdAt: m.created_at,
    pinned: !!m.pinned,
    reactions: Object.entries(grouped).map(([emoji, userIds]) => ({ emoji, userIds })),
  };
}

router.post('/upload', authMiddleware, uploadAttachment.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const kind = req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('video/') ? 'video' : 'file';
  res.json({
    attachment: {
      url: `/uploads/attachments/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
      kind,
    },
  });
});

router.get('/channel/:channelId', authMiddleware, (req, res) => {
  if (!canAccessChannel(req.userId, req.params.channelId)) return res.status(403).json({ error: 'No access to this channel.' });
  const before = req.query.before ? Number(req.query.before) : Date.now() + 1;
  const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 50')
    .all(req.params.channelId, before);
  res.json({ messages: rows.reverse().map(serializeMessage) });
});

router.get('/dm/:dmId', authMiddleware, (req, res) => {
  if (!canAccessDm(req.userId, req.params.dmId)) return res.status(403).json({ error: 'No access to this conversation.' });
  const before = req.query.before ? Number(req.query.before) : Date.now() + 1;
  const rows = db.prepare('SELECT * FROM messages WHERE dm_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 50')
    .all(req.params.dmId, before);
  res.json({ messages: rows.reverse().map(serializeMessage) });
});

router.get('/search/channel/:channelId', authMiddleware, (req, res) => {
  if (!canAccessChannel(req.userId, req.params.channelId)) return res.status(403).json({ error: 'No access to this channel.' });
  const q = `%${String(req.query.q || '')}%`;
  const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 50')
    .all(req.params.channelId, q);
  res.json({ messages: rows.map(serializeMessage) });
});

router.get('/pinned/:channelId', authMiddleware, (req, res) => {
  if (!canAccessChannel(req.userId, req.params.channelId)) return res.status(403).json({ error: 'No access to this channel.' });
  const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 ORDER BY created_at DESC').all(req.params.channelId);
  res.json({ messages: rows.map(serializeMessage) });
});

// ---- DM channel creation ----
router.get('/dms', authMiddleware, (req, res) => {
  const dmIds = db.prepare('SELECT dm_id FROM dm_members WHERE user_id = ?').all(req.userId).map(r => r.dm_id);
  const dms = dmIds.map(id => {
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(id);
    const members = db.prepare('SELECT u.* FROM dm_members dmm JOIN users u ON u.id = dmm.user_id WHERE dmm.dm_id = ?').all(id);
    const last = db.prepare('SELECT * FROM messages WHERE dm_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
    return {
      id: dm.id,
      isGroup: !!dm.is_group,
      name: dm.name,
      members: members.filter(m => m.id !== req.userId || members.length === 1).map(publicUser),
      lastMessage: last ? serializeMessage(last) : null,
    };
  }).sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  res.json({ dms });
});

router.post('/dms', authMiddleware, (req, res) => {
  const { userIds, name } = req.body || {};
  const targets = Array.from(new Set([...(userIds || []), req.userId]));
  if (targets.length < 2) return res.status(400).json({ error: 'Select at least one other user.' });

  if (targets.length === 2) {
    // Reuse existing 1:1 DM if one already exists.
    const existing = db.prepare(`
      SELECT dm.id FROM dm_channels dm
      WHERE dm.is_group = 0 AND (SELECT COUNT(*) FROM dm_members WHERE dm_id = dm.id) = 2
      AND EXISTS (SELECT 1 FROM dm_members WHERE dm_id = dm.id AND user_id = ?)
      AND EXISTS (SELECT 1 FROM dm_members WHERE dm_id = dm.id AND user_id = ?)
    `).get(targets[0], targets[1]);
    if (existing) return res.json({ dmId: existing.id });
  }

  const id = nanoid();
  db.prepare('INSERT INTO dm_channels (id, is_group, name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, targets.length > 2 ? 1 : 0, name || null, Date.now());
  for (const uid of targets) {
    db.prepare('INSERT INTO dm_members (dm_id, user_id) VALUES (?, ?)').run(id, uid);
  }
  const io = req.app.get('io');
  for (const uid of targets) io.to(`user:${uid}`).emit('dm:created', { dmId: id });
  res.json({ dmId: id });
});

module.exports = router;
module.exports.serializeMessage = serializeMessage;
module.exports.canAccessChannel = canAccessChannel;
module.exports.canAccessDm = canAccessDm;
