/* ============================================================
   API del módulo "Bases de datos" (desk): dispara y consulta el
   estado del motor de actualización (Copernico WMS). Exige sesión
   con el permiso 'basesdatos' — mismo criterio que el resto de los
   módulos protegidos por permiso, no por rol fijo.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const engine = require('../services/inventory-engine');
const inventoryStore = require('../store/inventory.store');
const coordenadasStore = require('../store/coordenadas.store');

// Un solo lugar donde mapear "nombre de fuente" -> su store. Agregar
// una fuente nueva es sumar una entrada acá (y en inventory-engine.js).
const STORES = {
  referencia: inventoryStore,
  coordenadas: coordenadasStore,
};

function requirePermission(key) {
  return (req, res, next) => {
    if (!(req.user.permissions || []).includes(key)) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }
    next();
  };
}

router.use(requireAuth, requirePermission('basesdatos'));

// POST /api/database/refresh — dispara una corrida del motor (todas
// las fuentes configuradas, un solo login). Nunca se llama a sí misma
// ni se reprograma: solo responde a este POST.
router.post('/refresh', async (_req, res) => {
  const result = await engine.refresh();
  if (!result.ok) {
    const status = result.error === 'ALREADY_RUNNING' ? 409 : 502;
    return res.status(status).json(result);
  }
  res.json(result);
});

// GET /api/database/status — estado de todas las fuentes configuradas.
router.get('/status', (_req, res) => {
  const sources = {};
  for (const key in STORES) sources[key] = STORES[key].getMeta();
  res.json({ ok: true, running: engine.isRunning(), sources });
});

// GET /api/database/rows?source=referencia&q=&page=&pageSize=&sortBy=&sortDir=
router.get('/rows', (req, res) => {
  const { source, q, page, pageSize, sortBy, sortDir } = req.query;
  const store = STORES[source || 'referencia'];
  if (!store) return res.status(400).json({ ok: false, error: 'UNKNOWN_SOURCE' });

  const data = store.list({
    q: q || '',
    page: Number(page) || 1,
    pageSize: Number(pageSize) || 50,
    sortBy: sortBy || null,
    sortDir: sortDir === 'desc' ? -1 : 1,
  });
  res.json({ ok: true, ...data });
});

module.exports = router;
