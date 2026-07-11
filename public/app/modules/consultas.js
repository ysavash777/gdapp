/* ============================================================
   Módulo App · Consultas
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Consultas';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="searchbar">
      ${icon('search', 18)}
      <input type="search" placeholder="Buscar por dirección, nombre o referencia…" />
    </div>

    <div class="card">
      <div class="empty-state">
        <div class="es-icon">${icon('search', 26)}</div>
        <h3>Busca en las bases de datos</h3>
        <p>Escribe arriba para consultar registros. Los resultados aparecerán aquí.</p>
      </div>
    </div>
  `;
}
