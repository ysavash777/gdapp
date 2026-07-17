/* ============================================================
   API del módulo "Bases de datos" (desk): dispara y consulta el
   estado del motor de actualización de referencia (Copernico WMS).
   Exige sesión con el permiso 'basesdatos' — mismo criterio que el
   resto de los módulos protegidos por permiso, no por rol fijo.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const engine = require('../services/inventory-engine');
const inventoryStore = require('../store/inventory.store');

function requirePermission(key) {
  return (req, res, next) => {
    if (!(req.user.permissions || []).includes(key)) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }
    next();
  };
}

router.use(requireAuth, requirePermission('basesdatos'));

// POST /api/database/refresh — dispara una corrida del motor. Nunca
// se llama a sí misma ni se reprograma: solo responde a este POST.
router.post('/refresh', async (_req, res) => {
  const result = await engine.refresh();
  if (!result.ok) {
    const status = result.error === 'ALREADY_RUNNING' ? 409 : 502;
    return res.status(status).json(result);
  }
  res.json(result);
});

// GET /api/database/status
router.get('/status', (_req, res) => {
  res.json({ ok: true, running: engine.isRunning(), meta: inventoryStore.getMeta() });
});

// GET /api/database/rows?q=&page=&pageSize=&sortBy=&sortDir=
router.get('/rows', (req, res) => {
  const { q, page, pageSize, sortBy, sortDir } = req.query;
  const data = inventoryStore.list({
    q: q || '',
    page: Number(page) || 1,
    pageSize: Number(pageSize) || 50,
    sortBy: sortBy || null,
    sortDir: sortDir === 'desc' ? -1 : 1,
  });
  res.json({ ok: true, ...data });
});

module.exports = router;
