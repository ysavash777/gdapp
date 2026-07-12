/* ============================================================
   Módulo App · Mapear
   Punto de entrada: listado de mapeos + acceso al escáner de cámara
   para registrar uno nuevo. Cada pantalla vive en su propio archivo:
     store.js         datos (hoy en memoria, misma forma que una
                       futura API — ver el comentario ahí)
     list-view.js      listado + detalle de solo lectura de un mapeo
     scanner-view.js    escáner de cámara para un mapeo nuevo
     format.js          fecha/hora e ítem de código, compartidos
                        entre list-view y scanner-view
   ============================================================ */

import { renderList } from './list-view.js';
import { openScanner } from './scanner-view.js';

export const title = 'Mapear';
export const description = 'Escanea códigos de barra de forma masiva y genera el mapeo de la posición.';

export function render(outlet) {
  const refresh = () => renderList(outlet, { onNew: () => openScanner({ onClose: refresh }) });
  refresh();
}
