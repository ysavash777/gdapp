/* ============================================================
   Módulo App · Mapear — catálogo de condición, compartido entre
   list-view.js y editor-view.js. El formato genérico (fecha/hora,
   escape de HTML) vive en /shared/js/format.js y se reexporta acá
   para no tener que tocar los imports existentes.
   ============================================================ */

export { formatDateTime, formatTime, escapeHtml } from '/shared/js/format.js';

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
