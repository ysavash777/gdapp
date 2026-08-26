// Módulo App · Consultar grupo. Sin listado: entra directo al escáner (scanner-view.js).

import { openScanner } from './scanner-view.js';

export const title = 'Consultar grupo';
export const description = 'Escaneá un producto y encontrá su grupo y ubicación al instante.';

export function render() {
  openScanner();
}
