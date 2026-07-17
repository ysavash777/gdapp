/* ============================================================
   Módulo App · Consultar grupo
   Punto de entrada: a diferencia de Mapear, esta herramienta no tiene
   listado — es un escáner de cámara de solo lectura (ver
   scanner-view.js). Entrar a la herramienta abre la cámara directo.
   ============================================================ */

import { openScanner } from './scanner-view.js';

export const title = 'Consultar grupo';
export const description = 'Busca un producto y descubre a qué grupo pertenece y dónde debe guardarse.';

export function render() {
  openScanner();
}
