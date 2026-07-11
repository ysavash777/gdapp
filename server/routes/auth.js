/* ============================================================
   API de autenticación — usa el mismo store que la gestión de
   usuarios, así que un usuario eliminado o editado ahí se refleja
   de inmediato en el login. La sesión vive en una cookie httpOnly
   (token opaco -> id de usuario), no en el objeto que guarda el
   cliente — eso permite refrescar permisos sin volver a loguearse.
   ============================================================ */

const express = require('express');
const router = express.Router();
const store = require('../store/users.store');
const sessions = require('../store/sessions.store');
const { requireAuth } = require('../middleware/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function startSession(res, userId) {
  const token = sessions.create(userId);
  res.cookie('sid', token, COOKIE_OPTS);
}

// POST /api/auth/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.findByUsername(username || '');
  if (!user || !store.verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }
  startSession(res, user.id);
  res.json({ ok: true, user: store.toPublic(user) });
});

// POST /api/auth/register  { username, password }
router.post('/register', (req, res) => {
  const { username, password, avatar } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }
  try {
    const user = store.create({ username, password, avatar: avatar || 1, role: 'user', permissions: [] });
    startSession(res, user.id);
    res.status(201).json({ ok: true, user });
  } catch (e) {
    res.status(409).json({ ok: false, error: e.message });
  }
});

// GET /api/auth/me — datos frescos del usuario logueado (permisos/rol al día)
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.sid;
  if (token) sessions.destroy(token);
  res.clearCookie('sid', { httpOnly: COOKIE_OPTS.httpOnly, sameSite: COOKIE_OPTS.sameSite, secure: COOKIE_OPTS.secure });
  res.json({ ok: true });
});

module.exports = router;
