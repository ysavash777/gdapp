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

// GET /api/vacios/empleados?q=... — directorio de Copernico por
// nombre, para elegir el contador (no requiere sesión con la extensión).
router.get('/empleados', async (req, res) => {
  try {
    const empleados = await store.buscarContadores(req.query.q);
    res.json({ ok: true, empleados });
  } catch (e) {
    console.error('[routes/vacios] empleados falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// POST /api/vacios/programar  { records: [{codigo, ubicacion}], targetIdEmpleado, contadorIdEmpleado }
router.post('/programar', async (req, res) => {
  try {
    const { records, targetIdEmpleado, contadorIdEmpleado } = req.body || {};
    const { originClientId } = await store.programarConteo(records, targetIdEmpleado, contadorIdEmpleado);
    res.json({ ok: true, originClientId });
  } catch (e) {
    if (['EMPTY_RECORDS', 'MISSING_TARGET', 'INVALID_TARGET', 'MISSING_CONTADOR', 'INVALID_CONTADOR'].includes(e.message)) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    console.error('[routes/vacios] programar falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/vacios/resultado?originClientId=... — null mientras la
// extensión todavía no procesó el job; el cliente reintenta a intervalos.
router.get('/resultado', async (req, res) => {
  try {
    const resultado = await store.obtenerResultado(req.query.originClientId);
    res.json({ ok: true, resultado });
  } catch (e) {
    if (e.message === 'MISSING_ORIGIN') return res.status(400).json({ ok: false, error: e.message });
    console.error('[routes/vacios] resultado falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
