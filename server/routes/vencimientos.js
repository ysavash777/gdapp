/* ============================================================
   API de Vencimientos — todo lo que venza dentro de la ventana de
   store/vencimientos.store.js (hoy 15 días, o ya vencido), cruzando
   Referencia con el estado de validación (Supabase) y la
   configuración de ubicaciones excluidas. Exige el permiso
   'vencimientos' (scope app — no tiene equivalente en desk todavía).
   ============================================================ */

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
  }
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

// DELETE /api/vencimientos/validate  { bodega, caja, ean } — revertir
router.delete('/validate', async (req, res) => {
  try {
    const { bodega, caja, ean } = req.body || {};
    if (!bodega || !caja || !ean) return res.status(400).json({ ok: false, error: 'MISSING_KEY' });
    await store.clearValidation(bodega, caja, ean);
    // El ítem revertido vuelve a "pendiente" con la última foto de
    // Referencia que haya (hasta 1h vieja, ver refresh-scheduler.js) —
    // sin esto, podría resucitar en la lista con datos que ya no
    // corresponden (motivo real por el que se pidió "siempre debemos
    // validar"). Dispara una corrida puntual de Referencia en segundo
    // plano para que la próxima consulta refleje el estado real de
    // Copernico lo antes posible, sin bloquear la respuesta de este
    // revert (una corrida real tarda decenas de segundos). Si ya hay
    // una corrida en curso, engine.refresh() se limita a devolver
    // ALREADY_RUNNING sin romper nada — el próximo ciclo programado
    // (o el botón manual) igual la pone al día.
    engine.refresh(['referencia']).catch((e) => {
      console.error('[routes/vencimientos] refresh de Referencia tras revertir falló:', e);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[routes/vencimientos] clearValidation falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// GET /api/vencimientos/export — XLSX con todo el estado actual
router.get('/export', async (_req, res) => {
  try {
    const { items } = await store.list();
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
