// Módulo Vencimientos — punto de entrada. Orquesta list-view.js
// (listado + toggle + settings + export) y validation-view.js (escaneo + motivo).

import { renderList } from './list-view.js';

export const title = 'Vencimientos';
export const description = 'Valida posiciones vencidas o próximas a vencer.';

export function render(outlet) {
  renderList(outlet);
}
