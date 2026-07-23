/* ============================================================
   Módulo App · Consultar grupo
   Punto de entrada: a diferencia de Mapear, esta herramienta no tiene
   listado — es un escáner de cámara de solo lectura (ver
   scanner-view.js). Entrar a la herramienta abre la cámara directo.
   ============================================================ */

import { openScanner } from './scanner-view.js';

export const title = 'Consultar grupo';
export const description = 'Escaneá un producto y encontrá su grupo y ubicación al instante.';

export function render() {
  openScanner();
}
