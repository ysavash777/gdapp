/* ============================================================
   Módulo App · Vacíos
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Vacíos';
export const description = 'Posiciones donde el sistema y lo físico no coinciden en el pallet.';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block">${icon('package', 20)} Revisar posición</button>

      <div class="card">
        <div class="empty-state">
          <div class="es-icon">${icon('package', 26)}</div>
          <h3>Sin diferencias registradas</h3>
          <p>Posiciones donde el sistema informa un pallet que no está, o al revés, quedarán aquí.</p>
        </div>
      </div>
    </div>
  `;
}
