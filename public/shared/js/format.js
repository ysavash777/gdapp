/* ============================================================
   GDapp · Utilidades de formato genéricas, compartidas por /app y
   /desk (fecha/hora, escape de HTML). Catálogos específicos de una
   sola herramienta (p. ej. las condiciones de Mapear) no van acá.
   ============================================================ */

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
