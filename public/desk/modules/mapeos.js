/* ============================================================
   Módulo Desk · Mapeos
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Mapeos';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Mapeos</h1>
        <p class="ph-sub muted">Consulta y administración de mapeos registrados.</p>
      </div>
      <div class="row">
        <button class="btn btn-ghost">${icon('filter', 18)} Filtrar</button>
        <button class="btn btn-primary">${icon('plus', 18)} Nuevo mapeo</button>
      </div>
    </div>

    <div class="card">
      <div class="empty-state">
        <div class="es-icon">${icon('map', 26)}</div>
        <h3>Sin mapeos todavía</h3>
        <p>Cuando el módulo esté conectado, aquí aparecerá el listado de mapeos con búsqueda y filtros.</p>
      </div>
    </div>
  `;
}
