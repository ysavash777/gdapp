/* ============================================================
   App · Notificaciones — productos vencidos.

   A propósito simple: sin toast flotante, solo la campana del header
   con un badge rojo. Ya no es un listado por SKU/ubicación con
   seguimiento de "visto" por ítem — es un único aviso "Existen N
   artículos vencidos" que se dispara como máximo una vez por día
   (por dispositivo, en localStorage) mientras haya al menos un
   vencido pendiente. Si no hay ninguno, no se muestra nada — ni
   badge ni aviso — y se olvida la fecha guardada, para que el día
   que vuelva a haber vencidos el aviso se dispare de nuevo aunque
   sea el mismo día.

   Solo "vencido" (ya pasó la fecha) — "próximo a vencer" no dispara
   esto, es un aviso para lo que ya hay que sacar YA, no un recordatorio
   de lo que viene.
   ============================================================ */

import { list } from './modules/vencimientos/store.js';

const ALERT_KEY = 'gd.vencidos.alertDate.v1';

// Fecha LOCAL en formato YYYY-MM-DD (no UTC: toISOString corriría el
// día para cualquiera al este/oeste del meridiano de Greenwich cerca
// de medianoche) — el locale 'en-CA' es el truco estándar para que
// toLocaleDateString devuelva ese formato sin armarlo a mano.
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

// { count, shouldAlert } — count es cuántos vencidos pendientes hay
// AHORA; shouldAlert indica si corresponde prender el badge (todavía
// no se avisó hoy Y hay al menos uno). Sin vencidos, se limpia la
// fecha guardada para no dejar "gastado" el aviso de un día que ya
// no aplica.
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

// Se llama al abrir la campana: apaga el badge por el resto del día,
// sin importar si el conteo sigue cambiando — el aviso ya cumplió su
// propósito de avisar una vez.
export function markAlertSeen() {
  setAlertedDate(todayKey());
}

export function notifMessageHTML(count) {
  if (!count) return `<p class="notif-empty">No tenés notificaciones</p>`;
  return `
    <button type="button" class="notif-item">
      <span class="notif-item-desc">Existen ${count} artículo${count === 1 ? '' : 's'} vencido${count === 1 ? '' : 's'}</span>
    </button>
  `;
}
