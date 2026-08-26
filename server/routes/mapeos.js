// API de Mapeos — usada por Mapear en /app (permiso 'mapear') y por
// el módulo de /desk (permiso 'mapeos'); cualquiera de los dos
// alcanza, ambos leen/escriben la misma data. Persistencia en
// store/mapeos.store.js; el actor de cada mutación sale siempre de
// la sesión autenticada, nunca del cliente.

const express = require('express');
const router = express.Router();
const store = require('../store/mapeos.store');
const variablesStore = require('../store/variables.store');
const { requirePermission } = require('../middleware/auth');
const { buildWorkbook } = require('../services/mapeo-export');
const inventoryStore = require('../store/inventory.store');
const { stockAlerts } = require('../services/ubicacion-picker');

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
// descripcion, ean, grupo) de Variables para autocompletar offline al
// escanear (ver app/modules/mapear/lookup-catalog.js). Debe ir antes
// de GET /:id, si no Express matchea "lookup-catalog" como id. Arrays
// en vez de objetos por payload (14000+ filas); una fila por
// referencia y una más por cada código "dun" (parseDunCodes en
// variables.store.js), mismo criterio que routes/catalog.js.
router.get('/lookup-catalog', (_req, res) => {
  try {
    const items = [];
    for (const r of variablesStore.getRowsForExport()) {
      const ref = r.referencia || '';
      if (!ref) continue;
      const row = [ref, r.descripcion || '', r.productoean || '', r.codgrupoprm || ''];
      items.push(row);
      for (const dunCode of variablesStore.parseDunCodes(r.dun)) {
        if (dunCode && dunCode !== ref) items.push([dunCode, row[1], row[2], row[3]]);
      }
    }
    // 'no-cache' fuerza revalidar por ETag (ver catalog.js): 304 sin
    // cuerpo si Variables no cambió.
    res.set('Cache-Control', 'no-cache');
    res.json({ ok: true, items });
  } catch (e) {
    console.error('[routes/mapeos] lookup-catalog falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/mapeos/stock-alerts?code=... — aviso de stock "de paso"
// contra Referencia (ver services/ubicacion-picker.js#stockAlerts).
// Debe ir antes de GET /:id por el mismo motivo que lookup-catalog.
router.get('/stock-alerts', (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.json({ ok: true, alerts: [] });
    res.json({ ok: true, alerts: stockAlerts(inventoryStore.findAllByReferencia(code)) });
  } catch (e) {
    console.error('[routes/mapeos] stock-alerts falló:', e.message);
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

// GET /api/mapeos/:id/export — descarga el mapeo como XLSX (una hoja
// por motivo, ver services/mapeo-export.js).
router.get('/:id/export', async (req, res) => {
  try {
    const mapeo = await store.get(Number(req.params.id));
    if (!mapeo) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

    const workbook = buildWorkbook(mapeo);
    // Sanitiza el título libre para que sirva como nombre de archivo.
    const safeName = (mapeo.title || `mapeo-${mapeo.id}`).replace(/[^a-z0-9-_ ]/gi, '').trim() || `mapeo-${mapeo.id}`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[routes/mapeos] export falló:', e.message);
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
