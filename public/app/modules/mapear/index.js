// Módulo App · Mapear. Punto de entrada: listado (list-view.js) + editor (editor-view.js),
// datos en store.js, formato compartido en format.js.

import { renderList } from './list-view.js';
import { openEditor } from './editor-view.js';

export const title = 'Mapear';
export const description = 'Escanea productos y registra cantidad, condición y descripción por código.';

export function render(outlet) {
  const refresh = () => renderList(outlet, { onNew: (title) => openEditor({ title, onClose: refresh }) });
  refresh();
}
