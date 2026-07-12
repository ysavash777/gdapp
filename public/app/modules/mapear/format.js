/* ============================================================
   Módulo App · Mapear — formato y catálogo de condición,
   compartidos entre list-view.js y editor-view.js.
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

// Condición del producto encontrado al escanear (rotura, conteo de
// unidades, vencimiento u otro motivo) — no es un estado del mapeo,
// es un dato por código.
export const CONDITIONS = [
  { value: 'rotura', label: 'Rotura' },
  { value: 'unidades', label: 'Unidades' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'otro', label: 'Otro' },
];

export function conditionLabel(value) {
  return CONDITIONS.find((c) => c.value === value)?.label || null;
}
