// API del módulo "Bases de datos" (desk): dispara y consulta el
// estado del motor de actualización (Copernico WMS). Requiere el
// permiso 'basesdatos'.

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const engine = require('../services/inventory-engine');
const inventoryStore = require('../store/inventory.store');
const coordenadasStore = require('../store/coordenadas.store');
const variablesStore = require('../store/variables.store');

// Nombre de fuente -> store. Fuente nueva: sumar acá y en inventory-engine.js.
const STORES = {
  referencia: inventoryStore,
  coordenadas: coordenadasStore,
  variables: variablesStore,
};

router.use(requirePermission('basesdatos'));

// POST /api/database/refresh — body opcional { source: 'referencia' }
// actualiza solo esa fuente; sin body, corren todas. No se hace
// `await engine.refresh()` acá a propósito: una corrida real tarda
// 30-100+ segundos, y proxies/CDN suelen cortar conexiones HTTP largas
// antes de tiempo. Responde 202 de inmediato; el cliente consulta el
// resultado con GET /status.
router.post('/refresh', (req, res) => {
  if (engine.isRunning()) {
    return res.status(409).json({ ok: false, error: 'ALREADY_RUNNING' });
  }
  const { source } = req.body || {};
  if (source && !STORES[source]) {
    return res.status(400).json({ ok: false, error: 'UNKNOWN_SOURCE' });
  }
  engine.refresh(source ? [source] : undefined).catch((e) => {
    // Red de seguridad: engine.refresh() nunca debería rechazar.
    console.error('[routes/database] engine.refresh() rechazó sin capturar:', e);
  });
  res.status(202).json({ ok: true, started: true });
});

// GET /api/database/status — estado de todas las fuentes + runningKeys
// (null si no hay corrida en curso, o el array de fuentes que trae la
// corrida activa) para saber qué tarjeta mostrar en progreso.
router.get('/status', (_req, res) => {
  const sources = {};
  for (const key in STORES) sources[key] = STORES[key].getMeta();
  res.json({ ok: true, running: engine.isRunning(), runningKeys: engine.getRunningKeys(), sources });
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
