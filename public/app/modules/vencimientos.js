/* ============================================================
   Módulo App · Vencimientos
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Vencimientos';
export const description = 'Valida posiciones vencidas o próximas a vencer.';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block">${icon('calendarAlert', 20)} Registrar vencimiento</button>

      <div class="card">
        <div class="empty-state">
          <div class="es-icon">${icon('calendarAlert', 26)}</div>
          <h3>Sin vencimientos registrados</h3>
          <p>Las posiciones vencidas o próximas a vencer aparecerán aquí para su auditoría.</p>
        </div>
      </div>
    </div>
  `;
}
