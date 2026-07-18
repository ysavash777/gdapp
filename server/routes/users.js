/* ============================================================
   API de gestión de usuarios.
   Delega toda la persistencia en store/users.store (Supabase) — este
   archivo solo valida entrada y traduce a códigos HTTP.
   ============================================================ */

const express = require('express');
const router = express.Router();
const store = require('../store/users.store');
const { CATALOG } = require('../permissions');
const { requireAdmin } = require('../middleware/auth');

// Gestión de usuarios es un módulo de administrador: toda esta API
// exige una sesión con role 'admin'. Sin esto, cualquier cuenta
// (incluida una recién registrada) podría editar roles, permisos
// o eliminar a otros usuarios llamando directamente a la API.
router.use(requireAdmin);

// GET /api/users?q=&page=&pageSize=
router.get('/', async (req, res) => {
  try {
    const { q, page, pageSize } = req.query;
    const data = await store.list({
      q: q || '',
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
    res.json({ ok: true, ...data });
  } catch (e) {
    console.error('[routes/users] list falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/users/permissions-catalog
router.get('/permissions-catalog', (_req, res) => {
  res.json({ ok: true, catalog: CATALOG });
});

// POST /api/users  { username, password, role, avatar, permissions }
router.post('/', async (req, res) => {
  try {
    const user = await store.create(req.body || {});
    res.status(201).json({ ok: true, user });
  } catch (e) {
    if (e.message === 'MISSING_FIELDS' || e.message === 'USERNAME_TAKEN') {
      return res.status(409).json({ ok: false, error: e.message });
    }
    console.error('[routes/users] create falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// PATCH /api/users/:id  { username?, role?, avatar?, permissions? }
router.patch('/:id', async (req, res) => {
  try {
    const user = await store.update(Number(req.params.id), req.body || {});
    if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, user });
  } catch (e) {
    if (e.message === 'USERNAME_TAKEN') {
      return res.status(409).json({ ok: false, error: e.message });
    }
    console.error('[routes/users] update falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// PATCH /api/users/:id/password  { password }
router.patch('/:id/password', async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) {
    return res.status(400).json({ ok: false, error: 'INVALID_PASSWORD' });
  }
  try {
    const done = await store.updatePassword(Number(req.params.id), password);
    if (!done) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[routes/users] updatePassword falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    const done = await store.remove(Number(req.params.id));
    if (!done) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[routes/users] remove falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
