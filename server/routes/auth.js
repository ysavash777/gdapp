// API de autenticación (STUB — sin persistencia real todavía).
// Solo usuario + contraseña. Cuando haya base de datos, implementar aquí.

const express = require('express');
const router = express.Router();

// POST /api/auth/login  { username, password }
router.post('/login', (req, res) => {
  const { username } = req.body || {};
  res.json({
    ok: true,
    stub: true,
    user: { id: 1, username: username || 'demo', role: 'admin', avatar: 1 },
  });
});

// POST /api/auth/register  { username, password }
router.post('/register', (req, res) => {
  const { username } = req.body || {};
  res.json({
    ok: true,
    stub: true,
    user: { id: Date.now(), username: username || 'nuevo', role: 'user', avatar: 1 },
  });
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

module.exports = router;
