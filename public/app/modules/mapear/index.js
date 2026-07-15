/* ============================================================
   Módulo App · Mapear
   Punto de entrada: listado de mapeos + acceso al editor (cámara +
   edición de contenido). Cada pantalla vive en su propio archivo:
     store.js         datos (hoy en memoria, misma forma que una
                       futura API — ver el comentario ahí)
     list-view.js      listado + menú de opciones (renombrar,
                       descargar, eliminar) de cada mapeo
     editor-view.js     escáner de cámara + edición de un mapeo,
                       nuevo o existente — nunca queda "cerrado"
     format.js          fecha/hora, catálogo de condición e ítem de
                       código, compartidos entre list-view y editor-view
   ============================================================ */

import { renderList } from './list-view.js';
import { openEditor } from './editor-view.js';

export const title = 'Mapear';
export const description = 'Escanea productos y registra cantidad, condición y descripción por código.';

export function render(outlet) {
  const refresh = () => renderList(outlet, { onNew: (title) => openEditor({ title, onClose: refresh }) });
  refresh();
}
