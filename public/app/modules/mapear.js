/* ============================================================
   Módulo App · Mapear
   (Estructura UI — pendiente de funcionalidad)
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export const title = 'Mapear';

export function render(outlet) {
  outlet.innerHTML = `
    <div class="action-hero">
      <div class="stat-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="stat"><div class="st-value">—</div><div class="st-label">Mapeadas hoy</div></div>
        <div class="stat"><div class="st-value">—</div><div class="st-label">Total semana</div></div>
      </div>

      <button class="btn btn-primary btn-block">${icon('pin', 20)} Nuevo mapeo</button>

      <div class="card">
        <div class="empty-state">
          <div class="es-icon">${icon('pin', 26)}</div>
          <h3>Sin mapeos recientes</h3>
          <p>Los mapeos que registres aparecerán aquí con su dirección y estado.</p>
        </div>
      </div>
    </div>
  `;
}
