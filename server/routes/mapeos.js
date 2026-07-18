/* ============================================================
   API de Mapeos — usada por la herramienta Mapear de /app (permiso
   'mapear') y por el módulo de consulta/administración de /desk
   (permiso 'mapeos') — cualquiera de los dos alcanza, ambos leen y
   escriben la misma data. Delega toda la persistencia en
   store/mapeos.store.js (Supabase); este archivo solo valida entrada,
   traduce a códigos HTTP y fija el actor de cada mutación desde la
   sesión autenticada (nunca desde el cliente).
   ============================================================ */

const express = require('express');
const router = express.Router();
const store = require('../store/mapeos.store');
const variablesStore = require('../store/variables.store');
const { requirePermission } = require('../middleware/auth');

router.use(requirePermission('mapear', 'mapeos'));

function actorOf(req) {
  return req.user.username;
}

// GET /api/mapeos
router.get('/', async (_req, res) => {
  try {
    res.json({ ok: true, items: await store.list() });
  } catch (e) {
    console.error('[routes/mapeos] list falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/mapeos/lookup-catalog — catálogo liviano (referencia,
// descripcion, ean, grupo) de Variables para que el celular pueda
// completar esos datos al escanear SIN red (ver app/modules/mapear/
// lookup-catalog.js) — Variables, no Referencia, porque es la única
// de las dos que tiene el grupo/familia del producto. Tiene que ir
// antes de GET /:id — si no, Express intentaría matchear
// "lookup-catalog" como si fuera un id. Arrays en vez de objetos: con
// 14000+ filas, no repetir las claves por fila ahorra buena parte del
// payload.
router.get('/lookup-catalog', (_req, res) => {
  try {
    const items = variablesStore.getRowsForExport().map((r) => [r.referencia || '', r.descripcion || '', r.productoean || '', r.codgrupoprm || '']);
    res.json({ ok: true, items });
  } catch (e) {
    console.error('[routes/mapeos] lookup-catalog falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/mapeos/:id
router.get('/:id', async (req, res) => {
  try {
    const mapeo = await store.get(Number(req.params.id));
    if (!mapeo) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, mapeo });
  } catch (e) {
    console.error('[routes/mapeos] get falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// POST /api/mapeos  { title? }
router.post('/', async (req, res) => {
  try {
    const mapeo = await store.create(actorOf(req), req.body?.title);
    res.status(201).json({ ok: true, mapeo });
  } catch (e) {
    console.error('[routes/mapeos] create falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// PATCH /api/mapeos/:id  { title }
router.patch('/:id', async (req, res) => {
  try {
    const mapeo = await store.rename(Number(req.params.id), req.body?.title || '', actorOf(req));
    res.json({ ok: true, mapeo });
  } catch (e) {
    if (e.message === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    console.error('[routes/mapeos] rename falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// DELETE /api/mapeos/:id
router.delete('/:id', async (req, res) => {
  try {
    await store.remove(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    console.error('[routes/mapeos] remove falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// POST /api/mapeos/:id/codes  { code }
router.post('/:id/codes', async (req, res) => {
  try {
    const mapeo = await store.addCode(Number(req.params.id), req.body?.code || '', actorOf(req));
    res.status(201).json({ ok: true, mapeo });
  } catch (e) {
    if (e.message === 'EMPTY_CODE') return res.status(400).json({ ok: false, error: e.message });
    console.error('[routes/mapeos] addCode falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// PATCH /api/mapeos/:id/codes/:codeId  { ...patch }
router.patch('/:id/codes/:codeId', async (req, res) => {
  try {
    const mapeo = await store.updateCode(Number(req.params.id), Number(req.params.codeId), req.body || {}, actorOf(req));
    res.json({ ok: true, mapeo });
  } catch (e) {
    if (e.message === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    console.error('[routes/mapeos] updateCode falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// DELETE /api/mapeos/:id/codes/:codeId
router.delete('/:id/codes/:codeId', async (req, res) => {
  try {
    const mapeo = await store.removeCode(Number(req.params.id), Number(req.params.codeId), actorOf(req));
    res.json({ ok: true, mapeo });
  } catch (e) {
    console.error('[routes/mapeos] removeCode falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
