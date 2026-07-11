/* ============================================================
   API de autenticación — usa el mismo store que la gestión de
   usuarios, así que un usuario eliminado o editado ahí se refleja
   de inmediato en el login.
   ============================================================ */

const express = require('express');
const router = express.Router();
const store = require('../store/users.store');

// POST /api/auth/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.findByUsername(username || '');
  if (!user || !store.verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }
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
    res.status(201).json({ ok: true, user });
  } catch (e) {
    res.status(409).json({ ok: false, error: e.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => res.json({ ok: true }));

module.exports = router;
