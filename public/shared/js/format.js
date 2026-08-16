/* ============================================================
   GDapp · Utilidades de formato genéricas, compartidas por /app y
   /desk (fecha/hora, escape de HTML). Catálogos específicos de una
   sola herramienta (p. ej. las condiciones de Mapear) no van acá.
   ============================================================ */

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Sub-encabezado de fecha para listas agrupadas por día (ej. Mapear) —
// "Hoy"/"Ayer" para los dos casos más frecuentes, fecha larga en
// español para el resto (con año solo si no es el actual).
export function formatDateHeading(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  // toLocaleDateString con day+month 'long' da "05-agosto" (sin el
  // conector "de") en el motor de fechas de Chrome/es-AR — se arma a
  // mano para que quede "5 de agosto" en vez de eso.
  const month = d.toLocaleDateString('es-AR', { month: 'long' });
  const year = d.getFullYear() !== now.getFullYear() ? ` de ${d.getFullYear()}` : '';
  return `${d.getDate()} de ${month}${year}`;
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Primera letra en mayúscula para mostrar un nombre de usuario — solo
// visual, nunca toca el valor real (nunca usar esto para lo que se
// manda de vuelta al servidor, como el <input> de editar usuario, o
// se terminaría "corrigiendo" el username real sin que nadie lo pida).
export function capitalize(str) {
  const s = String(str || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
