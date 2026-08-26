// Catálogo de condición, compartido entre list-view.js y editor-view.js.
// Formato genérico reexportado desde /shared/js/format.js.

export { formatDateTime, formatDateHeading, formatTime, escapeHtml, capitalize } from '/shared/js/format.js';

// Condición del producto escaneado (dato por código, no estado del mapeo).
export const CONDITIONS = [
  { value: 'rotura', label: 'Rotura' },
  { value: 'unidades', label: 'Unidades' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'otro', label: 'Otro' },
];

export function conditionLabel(value) {
  return CONDITIONS.find((c) => c.value === value)?.label || null;
}
