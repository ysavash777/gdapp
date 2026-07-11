/* ============================================================
   Módulo App · Consultar grupo
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Consultar grupo';
export const description = 'Busca un producto y descubre a qué grupo pertenece y dónde debe guardarse.';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="searchbar">
      ${icon('search', 18)}
      <input type="search" placeholder="Buscar producto por código o nombre…" />
    </div>

    <div class="card">
      <div class="empty-state">
        <div class="es-icon">${icon('search', 26)}</div>
        <h3>Encuentra su grupo y ubicación</h3>
        <p>Escribe arriba el producto y te decimos a qué grupo pertenece y dónde almacenarlo.</p>
      </div>
    </div>
  `;
}
