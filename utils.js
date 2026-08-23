const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function signToken(userId, sessionId) {
  return jwt.sign({ uid: userId, sid: sessionId }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.userId = payload.uid;
    req.sessionId = payload.sid;
    req.user = user;
    // touch session last_seen
    db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(Date.now(), payload.sid);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    banner: u.banner,
    accentColor: u.accent_color,
    status: u.status,
    customStatus: u.custom_status,
    aboutMe: u.about_me,
    activity: u.activity,
    isOwnerAccount: !!u.is_owner_account,
    createdAt: u.created_at,
  };
}

function privateUser(u) {
  if (!u) return null;
  return { ...publicUser(u), email: u.email, points: u.points };
}

module.exports = { signToken, authMiddleware, publicUser, privateUser, JWT_SECRET };
