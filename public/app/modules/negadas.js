/* ============================================================
   Módulo App · Negadas
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Negadas';
export const description = 'Posiciones rechazadas por los pickers, listas para auditar.';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block">${icon('ban', 20)} Registrar negada</button>

      <div class="card">
        <div class="empty-state">
          <div class="es-icon">${icon('ban', 26)}</div>
          <h3>Sin negadas registradas</h3>
          <p>Las posiciones rechazadas por los pickers aparecerán aquí para su auditoría.</p>
        </div>
      </div>
    </div>
  `;
}
