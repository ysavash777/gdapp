/* ============================================================
   Reset diario de Vencimientos — lo validado es un estado del día:
   todos los días a las 00:00 hora Argentina se borran todas las filas
   de vencimiento_validaciones (store/vencimientos.store.js#resetValidations).
   Mismo patrón que refresh-scheduler.js (tick por minuto, Intl para
   zona horaria fija) pero sin ventana horaria ni reintento — si falla,
   lo validado de ayer sigue visible un rato más, no es urgente.
   ============================================================ */

const store = require('../store/vencimientos.store');

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const TICK_MS = 60 * 1000;

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

function localNow() {
  const found = {};
  for (const p of parts.formatToParts(new Date())) found[p.type] = p.value;
  // Intl puede devolver "24" para la medianoche en vez de "0" según el runtime.
  const hour = Number(found.hour) % 24;
  return { dateKey: `${found.year}-${found.month}-${found.day}`, hour, minute: Number(found.minute) };
}

let lastRunKey = null; // dateKey del último reset — evita disparar dos veces el mismo minuto en punto

function tick() {
  const now = localNow();
  if (now.hour !== 0 || now.minute !== 0) return;
  if (now.dateKey === lastRunKey) return; // ya reseteado hoy
  lastRunKey = now.dateKey;

  console.log('[vencimiento-reset-scheduler] Reseteando validaciones del día...');
  store.resetValidations()
    .then(() => console.log('[vencimiento-reset-scheduler] Validaciones reseteadas.'))
    .catch((e) => console.error('[vencimiento-reset-scheduler] resetValidations() falló:', e.message));
}

function start() {
  setInterval(tick, TICK_MS);
  console.log(`[vencimiento-reset-scheduler] Activo: reset de validaciones todos los días a las 00:00 (${TIMEZONE}).`);
}

module.exports = { start };
