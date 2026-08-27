// Módulo Programación remota — punto de entrada. Ver list-view.js para el
// flujo completo (escanear -> elegir ubicación -> armar lista -> programar).

import { renderHome } from './list-view.js';

export const title = 'Programación remota';
export const description = 'Programá conteos sin importar a la distancia a la que te encuentres.';

export function render(outlet) {
  renderHome(outlet);
}
