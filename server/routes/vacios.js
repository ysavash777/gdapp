// API de "Programación remota" (permiso 'vacios'): buscar producto
// por código, listar empleados con la extensión activa y programar el
// conteo (ver store/programacion-remota.store.js).

const express = require('express');
const router = express.Router();
const store = require('../store/programacion-remota.store');
const { requirePermission } = require('../middleware/auth');

router.use(requirePermission('vacios'));

// GET /api/vacios/lookup?codigo=... — todas las ubicaciones con stock
// de ese código (EAN o referencia, con sus variantes).
router.get('/lookup', (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) return res.status(400).json({ ok: false, error: 'MISSING_CODIGO' });
  try {
    const rows = store.buscarProducto(codigo);
    res.json({ ok: true, rows });
  } catch (e) {
    console.error('[routes/vacios] lookup falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/vacios/sesiones — empleados en línea (extensión activa)
// para elegir a quién programarle el conteo.
router.get('/sesiones', async (_req, res) => {
  try {
    const sesiones = await store.listSesiones();
    res.json({ ok: true, sesiones });
  } catch (e) {
    console.error('[routes/vacios] sesiones falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// POST /api/vacios/programar  { records: [{codigo, ubicacion}], targetIdEmpleado }
router.post('/programar', async (req, res) => {
  try {
    const { records, targetIdEmpleado } = req.body || {};
    await store.programarConteo(records, targetIdEmpleado);
    res.json({ ok: true });
  } catch (e) {
    if (e.message === 'EMPTY_RECORDS' || e.message === 'MISSING_TARGET' || e.message === 'INVALID_TARGET') {
      return res.status(400).json({ ok: false, error: e.message });
    }
    console.error('[routes/vacios] programar falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
