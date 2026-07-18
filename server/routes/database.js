/* ============================================================
   API del módulo "Bases de datos" (desk): dispara y consulta el
   estado del motor de actualización (Copernico WMS). Exige sesión
   con el permiso 'basesdatos' — mismo criterio que el resto de los
   módulos protegidos por permiso, no por rol fijo.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const engine = require('../services/inventory-engine');
const inventoryStore = require('../store/inventory.store');
const coordenadasStore = require('../store/coordenadas.store');
const variablesStore = require('../store/variables.store');

// Un solo lugar donde mapear "nombre de fuente" -> su store. Agregar
// una fuente nueva es sumar una entrada acá (y en inventory-engine.js).
const STORES = {
  referencia: inventoryStore,
  coordenadas: coordenadasStore,
  variables: variablesStore,
};

router.use(requirePermission('basesdatos'));

// POST /api/database/refresh — dispara una corrida del motor (todas
// las fuentes configuradas, un solo login) y responde de inmediato,
// sin esperar a que termine. Nunca se llama a sí misma ni se
// reprograma: sigue siendo este POST el único disparador.
//
// A propósito no se hace `await engine.refresh()` acá: una corrida
// real tarda 30-100+ segundos (depende de Copernico, no de nosotros),
// y mantener una sola conexión HTTP abierta todo ese tiempo no tiene
// ninguna ventaja — el navegador de todos modos tiene que consultar
// GET /status para enterarse del resultado final (por si la corrida
// la disparó otra pestaña). Isolar el "arranca" del "esperar el
// resultado" evita depender de que esa conexión particular sobreviva
// el tiempo completo (proxies/CDN suelen cortar conexiones largas
// antes de tiempo) y libera al navegador de tener un fetch pendiente
// gigante todo ese rato.
router.post('/refresh', (_req, res) => {
  if (engine.isRunning()) {
    return res.status(409).json({ ok: false, error: 'ALREADY_RUNNING' });
  }
  engine.refresh().catch((e) => {
    // engine.refresh() ya atrapa sus propios errores y siempre resuelve
    // (nunca rechaza) — este catch es solo una red de seguridad por si
    // eso cambiara algún día, para que nunca quede un rechazo silencioso.
    console.error('[routes/database] engine.refresh() rechazó sin capturar:', e);
  });
  res.status(202).json({ ok: true, started: true });
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
