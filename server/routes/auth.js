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

async function startSession(res, userId) {
  const token = await sessions.create(userId);
  res.cookie('sid', token, COOKIE_OPTS);
}

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await store.findByUsername(username || '');
    if (!user || !store.verifyPassword(password || '', user.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    await startSession(res, user.id);
    res.json({ ok: true, user: store.toPublic(user) });
  } catch (e) {
    console.error('[routes/auth] login falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/auth/me — datos frescos del usuario logueado (permisos/rol al día)
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies.sid;
  if (token) {
    try {
      await sessions.destroy(token);
    } catch (e) {
      console.error('[routes/auth] logout falló al borrar la sesión:', e.message);
    }
  }
  res.clearCookie('sid', { httpOnly: COOKIE_OPTS.httpOnly, sameSite: COOKIE_OPTS.sameSite, secure: COOKIE_OPTS.secure });
  res.json({ ok: true });
});

module.exports = router;
