/* ============================================================
   Scheduler del refresh automático de bases (Copernico WMS).
   Lunes a sábado, 6:00-22:00 hora Argentina, una corrida por hora en
   punto; si falla, un único reintento a los 15 min (temporizador
   independiente, no retrasa la próxima corrida en punto).

   Solo Referencia se refresca automáticamente (baja el egress hacia
   Supabase, que sube todas las filas en cada corrida). Coordenadas y
   Variables siguen disponibles a mano desde el desk.

   Zona horaria fija vía Intl (no la del proceso, que en Render suele
   ser UTC) para que 6-22 sea siempre hora Argentina.
   ============================================================ */

const engine = require('./inventory-engine');

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const START_HOUR = 6;
const END_HOUR = 22;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const TICK_MS = 60 * 1000;

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

function localNow() {
  const found = {};
  for (const p of parts.formatToParts(new Date())) found[p.type] = p.value;
  // Intl puede devolver "24" para la medianoche en vez de "0" según el runtime.
  const hour = Number(found.hour) % 24;
  return { weekday: found.weekday, hour, minute: Number(found.minute) };
}

const ACTIVE_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

function isScheduledHour({ weekday, hour, minute }) {
  return ACTIVE_DAYS.has(weekday) && minute === 0 && hour >= START_HOUR && hour <= END_HOUR;
}

let lastRunKey = null; // "Mon-6" etc. — evita disparar dos veces el mismo minuto en punto
let retryTimer = null;

const AUTO_SOURCE_KEYS = ['referencia'];

function runRefresh(label) {
  console.log(`[refresh-scheduler] Disparando actualización automática (${label})...`);
  engine.refresh(AUTO_SOURCE_KEYS)
    .then((result) => {
      if (result.ok) {
        console.log(`[refresh-scheduler] (${label}) completada.`);
        return;
      }
      console.error(`[refresh-scheduler] (${label}) falló: ${result.error || 'error desconocido'} — reintento en 15 min.`);
      scheduleRetry();
    })
    .catch((e) => {
      // Red de seguridad: engine.refresh() ya atrapa sus propios errores.
      console.error(`[refresh-scheduler] (${label}) rechazó sin capturar:`, e);
      scheduleRetry();
    });
}

function scheduleRetry() {
  // Un solo reintento pendiente a la vez: si ya hay uno programado
  // (ej. dos fuentes fallaron en corridas separadas muy seguidas), no
  // se apilan reintentos extra.
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    runRefresh('reintento +15min');
  }, RETRY_DELAY_MS);
}

function tick() {
  const now = localNow();
  if (!isScheduledHour(now)) return;

  const key = `${now.weekday}-${now.hour}`;
  if (key === lastRunKey) return; // ya disparada esta hora en punto
  lastRunKey = key;
  runRefresh(`${now.weekday} ${String(now.hour).padStart(2, '0')}:00`);
}

function start() {
  setInterval(tick, TICK_MS);
  console.log(`[refresh-scheduler] Activo: lun-sáb ${START_HOUR}:00-${END_HOUR}:00 (${TIMEZONE}), cada 1 hora (solo ${AUTO_SOURCE_KEYS.join(', ')}), reintento a los 15 min si falla.`);
}

module.exports = { start };
