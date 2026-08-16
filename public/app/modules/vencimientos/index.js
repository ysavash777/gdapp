/* ============================================================
   Módulo App · Vencimientos — punto de entrada.
   Solo orquesta list-view.js (listado + toggle de orden + settings +
   export) y validation-view.js (escaneo en 2 pasos + motivo).
   ============================================================ */

import { renderList } from './list-view.js';

export const title = 'Vencimientos';

export function render(outlet) {
  renderList(outlet);
}
