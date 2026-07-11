/* ============================================================
   Módulo App · Vacíos
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Vacíos';
export const description = 'Registra viviendas o unidades vacías';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block">${icon('inbox', 20)} Registrar vacío</button>

      <div class="card">
        <div class="empty-state">
          <div class="es-icon">${icon('inbox', 26)}</div>
          <h3>Sin vacíos registrados</h3>
          <p>Las viviendas o unidades vacías que marques quedarán listadas aquí.</p>
        </div>
      </div>
    </div>
  `;
}
