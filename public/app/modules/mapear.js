/* ============================================================
   Módulo App · Mapear
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Mapear';
export const description = 'Escanea productos y genera el detalle de los que están fuera de sistema.';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block">${icon('scan', 20)} Escanear producto</button>

      <div class="card">
        <div class="empty-state">
          <div class="es-icon">${icon('scan', 26)}</div>
          <h3>Sin escaneos recientes</h3>
          <p>Los productos fuera de sistema que escanees quedarán listados aquí.</p>
        </div>
      </div>
    </div>
  `;
}
