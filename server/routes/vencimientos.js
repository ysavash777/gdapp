// API de Vencimientos — todo lo que venza dentro de la ventana de
// store/vencimientos.store.js (15 días, o ya vencido), cruzando
// Referencia con el estado de validación (Supabase) y las ubicaciones
// excluidas. Requiere el permiso 'vencimientos'.

const express = require('express');
const router = express.Router();
const store = require('../store/vencimientos.store');
const engine = require('../services/inventory-engine');
const { requirePermission } = require('../middleware/auth');
const { buildWorkbook } = require('../services/vencimiento-export');

router.use(requirePermission('vencimientos'));

function actorOf(req) {
  return req.user.username;
}

// GET /api/vencimientos — siempre ordenado por ubicación; el filtro
// Pendiente/Validado lo aplica el cliente sobre esta misma lista.
router.get('/', async (_req, res) => {
  try {
    const data = await store.list();
    res.json({ ok: true, ...data });
  } catch (e) {
    console.error('[routes/vencimientos] list falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    return;
  }
  // Dispara una corrida de Referencia en segundo plano cada vez que se
  // entra a Vencimientos (sin esperarla: tarda decenas de segundos) —
  // así una ubicación que cambió hace poco en Copernico no se queda
  // pegada hasta el próximo tick del scheduler (hasta 1h de desfase).
  // Esta respuesta ya salió con los datos de ANTES de esta corrida —
  // el que entra ahora puede seguir viendo lo viejo por unos segundos,
  // pero la próxima vez que abra o recargue la lista ya sale al día. Si
  // ya hay una corrida en curso, engine.refresh() devuelve
  // ALREADY_RUNNING sin romper nada (nunca se pisan dos corridas).
  engine.refresh(['referencia']).catch((e) => {
    console.error('[routes/vencimientos] refresh de Referencia al listar falló:', e);
  });
});

// GET /api/vencimientos/settings
router.get('/settings', async (_req, res) => {
  try {
    const settings = await store.getSettings();
    res.json({ ok: true, ...settings });
  } catch (e) {
    console.error('[routes/vencimientos] getSettings falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// PUT /api/vencimientos/settings  { excludedLocations: string[] }
router.put('/settings', async (req, res) => {
  try {
    const { excludedLocations } = req.body || {};
    if (!Array.isArray(excludedLocations)) {
      return res.status(400).json({ ok: false, error: 'INVALID_BODY' });
    }
    const result = await store.updateSettings(excludedLocations, actorOf(req));
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[routes/vencimientos] updateSettings falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// POST /api/vencimientos/validate
// { bodega, caja, ean, referencia, ubicacion, descripcion, fv, motivo,
//   motivoDetalle, fotoBase64 } — fotoBase64 (data URL) es obligatoria
// cuando motivo === 'faltante' (ver store.validateItem).
router.post('/validate', async (req, res) => {
  try {
    await store.validateItem({ ...req.body, actor: actorOf(req) });
    res.json({ ok: true });
  } catch (e) {
    if (e.message === 'MISSING_KEY' || e.message === 'INVALID_MOTIVO' || e.message === 'PHOTO_REQUIRED' || e.message === 'INVALID_PHOTO') {
      return res.status(400).json({ ok: false, error: e.message });
    }
    console.error('[routes/vencimientos] validateItem falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// PATCH /api/vencimientos/validate  { bodega, caja, ean, motivoDetalle }
// — edita SOLO la observación de un ítem ya validado (ver "Validado"
// en list-view.js), sin tocar motivo/foto/nada más.
router.patch('/validate', async (req, res) => {
  try {
    const { bodega, caja, ean, motivoDetalle } = req.body || {};
    if (!bodega || !caja || !ean) return res.status(400).json({ ok: false, error: 'MISSING_KEY' });
    await store.updateMotivoDetalle(bodega, caja, ean, motivoDetalle);
    res.json({ ok: true });
  } catch (e) {
    console.error('[routes/vencimientos] updateMotivoDetalle falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// DELETE /api/vencimientos/validate  { bodega, caja, ean } — revertir
router.delete('/validate', async (req, res) => {
  try {
    const { bodega, caja, ean } = req.body || {};
    if (!bodega || !caja || !ean) return res.status(400).json({ ok: false, error: 'MISSING_KEY' });
    await store.clearValidation(bodega, caja, ean);
    // Dispara una corrida de Referencia en segundo plano (sin esperar,
    // tarda decenas de segundos) para que el ítem revertido no quede
    // con datos viejos hasta el próximo refresh programado. Si ya hay
    // una corrida en curso, engine.refresh() devuelve ALREADY_RUNNING
    // sin romper nada.
    engine.refresh(['referencia']).catch((e) => {
      console.error('[routes/vencimientos] refresh de Referencia tras revertir falló:', e);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[routes/vencimientos] clearValidation falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/vencimientos/export — XLSX con el estado actual. Usa
// listForExport() (no list()): lo validado sale directo de
// vencimiento_validaciones, ver esa función en el store.
router.get('/export', async (_req, res) => {
  try {
    const items = await store.listForExport();
    const workbook = buildWorkbook(items);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="vencimientos.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[routes/vencimientos] export falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
