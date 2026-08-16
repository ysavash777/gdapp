/* ============================================================
   App · Notificaciones — productos vencidos.

   A propósito simple: sin toast flotante, solo la campana del header
   con un badge rojo con la cantidad de vencidos que todavía NO se
   vieron. "Visto" se recuerda en localStorage (por dispositivo, no
   por usuario ni compartido — no hace falta más que eso para no
   molestar dos veces con lo mismo): abrir la campana marca como
   vistos todos los vencidos que se muestran en ese momento, así el
   badge vuelve a 0 y solo vuelve a sumar cuando aparezca un vencido
   NUEVO (o uno ya visto que se validó y volvió a aparecer, caso raro
   pero cubierto). Cada chequeo poda del localStorage cualquier id que
   ya no sea un vencido pendiente vigente, para no acumular basura.

   Solo "vencido" (ya pasó la fecha) — "próximo a vencer" no dispara
   esto, es un aviso para lo que ya hay que sacar YA, no un recordatorio
   de lo que viene.
   ============================================================ */

import { escapeHtml } from '/shared/js/format.js';
import { list } from './modules/vencimientos/store.js';

const SEEN_KEY = 'gd.vencidos.seen.v1';

function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
  } catch (e) {
    // localStorage lleno o deshabilitado: en el peor caso se repite el
    // aviso una vez de más — no vale la pena romper nada por esto.
    console.error('[notifications] No se pudo guardar el estado de vistos:', e.message);
  }
}

// { vencidos, unseenCount } — vencidos son los PENDIENTES con
// severity 'vencido' (ya pasaron), nunca "próximo a vencer".
export async function checkVencidos() {
  const { items } = await list();
  const vencidos = items.filter((i) => i.severity === 'vencido' && !i.validated);

  const seen = loadSeen();
  const currentKeys = new Set(vencidos.map((i) => i.key));
  const pruned = new Set([...seen].filter((k) => currentKeys.has(k)));
  if (pruned.size !== seen.size) saveSeen(pruned);

  const unseenCount = vencidos.filter((i) => !pruned.has(i.key)).length;
  return { vencidos, unseenCount };
}

export function markAllSeen(vencidos) {
  saveSeen(new Set(vencidos.map((i) => i.key)));
}

// Agrupado por ubicación: antes había una fila por SKU vencido, así
// que una misma ubicación con varios productos vencidos aparecía
// repetida una vez por cada uno — más ruidoso que útil para saber
// dónde ir primero. Una fila por ubicación con la cantidad es lo que
// de verdad hace falta decidir hacia dónde moverse.
export function notifListHTML(vencidos) {
  if (!vencidos.length) return `<p class="notif-empty">No tenés notificaciones</p>`;

  const porUbicacion = new Map();
  for (const item of vencidos) {
    const ubicacion = item.ubicacion || 'Sin ubicación';
    if (!porUbicacion.has(ubicacion)) porUbicacion.set(ubicacion, 0);
    porUbicacion.set(ubicacion, porUbicacion.get(ubicacion) + 1);
  }

  return [...porUbicacion.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ubicacion, count]) => `
      <button type="button" class="notif-item" data-ubicacion="${escapeHtml(ubicacion)}">
        <span class="notif-item-title">${escapeHtml(ubicacion)}</span>
        <span class="notif-item-desc">${count} vencido${count === 1 ? '' : 's'}</span>
      </button>
    `).join('');
}
