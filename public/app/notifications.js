// Notificaciones de productos vencidos: un único aviso "Existen N artículos
// vencidos" (badge en la campana), como máximo una vez por día por dispositivo.
// Solo cuenta "vencido" (fecha ya pasada), no "próximo a vencer".

import { list } from './modules/vencimientos/store.js';
import { icon } from '/shared/js/icons.js';

const ALERT_KEY = 'gd.vencidos.alertDate.v1';

// Fecha LOCAL YYYY-MM-DD (no toISOString: corre el día cerca de medianoche
// según el huso). 'en-CA' es el truco estándar para ese formato.
function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

function getAlertedDate() {
  try {
    return localStorage.getItem(ALERT_KEY);
  } catch {
    return null;
  }
}

function setAlertedDate(day) {
  try {
    if (day) localStorage.setItem(ALERT_KEY, day);
    else localStorage.removeItem(ALERT_KEY);
  } catch (e) {
    console.error('[notifications] No se pudo guardar la fecha del aviso:', e.message);
  }
}

// shouldAlert: no se avisó hoy y hay al menos un vencido. Sin vencidos,
// limpia la fecha guardada para que el aviso vuelva a dispararse el
// mismo día si reaparece un vencido.
export async function checkVencidos() {
  const { items } = await list();
  const count = items.filter((i) => i.severity === 'vencido' && !i.validated).length;

  if (count === 0) {
    setAlertedDate(null);
    return { count: 0, shouldAlert: false };
  }

  const shouldAlert = getAlertedDate() !== todayKey();
  return { count, shouldAlert };
}

// Al abrir la campana: apaga el badge por el resto del día.
export function markAlertSeen() {
  setAlertedDate(todayKey());
}

export function notifMessageHTML(count) {
  if (!count) return `<p class="notif-empty">No tenés notificaciones</p>`;
  return `
    <button type="button" class="notif-item">
      <span class="notif-item-avatar" data-key="vencimientos">${icon('calendarAlert', 16)}</span>
      <span class="notif-item-desc">Existen ${count} artículo${count === 1 ? '' : 's'} vencido${count === 1 ? '' : 's'}</span>
    </button>
  `;
}
