/* ============================================================
   Módulo Desk · Bases de datos
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Bases de datos';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Bases de datos</h1>
        <p class="ph-sub muted">Fuentes de datos disponibles para la operación.</p>
      </div>
      <button class="btn btn-primary">${icon('plus', 18)} Conectar base</button>
    </div>

    <div class="card">
      <div class="empty-state">
        <div class="es-icon">${icon('database', 26)}</div>
        <h3>Sin bases de datos conectadas</h3>
        <p>Aquí se listarán las bases de datos con su estado, registros y última sincronización.</p>
      </div>
    </div>
  `;
}
