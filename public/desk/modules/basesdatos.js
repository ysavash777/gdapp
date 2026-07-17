/* ============================================================
   Módulo Desk · Bases de datos
   Una tarjeta por fuente de datos. Hoy solo "Referencia" funciona
   (dispara/consulta el motor de server/services/inventory-engine.js);
   Variables, Coordenadas y Líneas picking son la misma tarjeta sin
   acción real todavía, para que la pantalla ya muestre la forma final.

   Nunca se muestran las filas traídas acá — solo la cantidad y el
   horario de actualización (el detalle de los datos vive del lado
   del servidor, listo para consultarse desde otro módulo el día que
   haga falta, sin que el navegador tenga que cargarlo).
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { apiFetch } from '/shared/js/api.js';
import { formatDateTime, escapeHtml } from '/shared/js/format.js';

const ERROR_MESSAGES = {
  LICENSE_LIMIT: 'No hay licencias disponibles en Copernico en este momento. Probá de nuevo más tarde.',
  ALREADY_LOGGED_IN: 'El usuario consultor ya tiene una sesión activa en otro dispositivo y no se pudo liberar automáticamente.',
  ALREADY_RUNNING: 'Ya hay una actualización en curso — esperá a que termine.',
  MISSING_CREDENTIALS: 'Faltan las credenciales del usuario consultor en el servidor.',
  INVALID_CREDENTIALS: 'Las credenciales del usuario consultor son inválidas.',
  LOGIN_FAILED: 'No se pudo iniciar sesión en Copernico.',
  FETCH_FAILED: 'Copernico no devolvió los datos de referencia.',
  NETWORK: 'No se pudo conectar con Copernico. Revisá la conexión.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  UNAUTHORIZED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

function errorMessage(err) {
  return ERROR_MESSAGES[err.message] || 'Ocurrió un error al actualizar la base de datos.';
}

// Íconos premium (nunca CSS dibujado) por estado — sin texto al lado:
// el color + la forma del ícono ya distinguen los tres casos.
const STATUS_ICON = {
  ok: { name: 'check', cls: 'is-ok', title: 'Actualizado y cargado' },
  error: { name: 'alertTriangle', cls: 'is-error', title: 'Error al actualizar' },
  empty: { name: 'inbox', cls: 'is-empty', title: 'Sin datos' },
};

const SOURCES = [
  { key: 'referencia', label: 'Referencia', icon: 'database', active: true },
  { key: 'variables', label: 'Variables', icon: 'layers', active: false },
  { key: 'coordenadas', label: 'Coordenadas', icon: 'pin', active: false },
  { key: 'lineas_picking', label: 'Líneas picking', icon: 'grid', active: false },
];

export const title = 'Bases de datos';

export function render(outlet) {
  const root = document.createElement('div');
  outlet.innerHTML = '';
  outlet.appendChild(root);
  mount(root);
}

async function mount(root) {
  const state = {
    referencia: { status: 'empty', lastUpdatedAt: null, rowCount: 0, refreshing: false, error: null },
  };

  drawShell();
  await loadStatus();

  async function loadStatus() {
    try {
      const data = await apiFetch('/api/database/status');
      state.referencia.status = data.meta.status;
      state.referencia.lastUpdatedAt = data.meta.lastUpdatedAt;
      state.referencia.rowCount = data.meta.rowCount;
    } catch {
      // Sin conexión al status: se queda con el último estado local
      // conocido (por defecto "Sin datos") en vez de romper la vista.
    }
    drawCards();
  }

  async function handleRefresh() {
    if (state.referencia.refreshing) return;
    state.referencia.refreshing = true;
    state.referencia.error = null;
    drawCards();
    try {
      const data = await apiFetch('/api/database/refresh', { method: 'POST' });
      state.referencia.status = data.meta.status;
      state.referencia.lastUpdatedAt = data.meta.lastUpdatedAt;
      state.referencia.rowCount = data.meta.rowCount;
    } catch (err) {
      state.referencia.status = 'error';
      state.referencia.error = err;
    }
    state.referencia.refreshing = false;
    drawCards();
  }

  function drawShell() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Bases de datos</h1>
          <p class="ph-sub muted">Fuentes de datos de Copernico WMS disponibles para la operación.</p>
        </div>
      </div>
      <div class="db-source-grid" id="sourceGrid"></div>
    `;
  }

  function sourceCardHTML(src) {
    if (!src.active) {
      return `
        <div class="card db-source-card" data-key="${src.key}">
          <div class="db-source-head">
            <div class="db-source-name">
              <div class="tc-icon-sm">${icon(src.icon, 18)}</div>
              <h3>${src.label}</h3>
            </div>
            <div class="db-status-icon is-empty" title="${STATUS_ICON.empty.title}">${icon(STATUS_ICON.empty.name, 16)}</div>
          </div>
          <button class="btn btn-ghost btn-block" data-action="stub">${icon('refresh', 16)} Actualizar</button>
        </div>
      `;
    }

    const s = state.referencia;
    const busy = s.refreshing;
    const st = STATUS_ICON[busy ? 'empty' : s.status] || STATUS_ICON.empty;
    const hasData = s.rowCount > 0;

    return `
      <div class="card db-source-card" data-key="${src.key}">
        <div class="db-source-head">
          <div class="db-source-name">
            <div class="tc-icon-sm">${icon(src.icon, 18)}</div>
            <h3>${src.label}</h3>
          </div>
          <div class="db-status-icon ${st.cls}" title="${busy ? 'Actualizando…' : st.title}">
            ${icon(busy ? 'refresh' : st.name, 16)}
          </div>
        </div>
        <div class="db-source-metrics">
          <div class="metric">
            <span class="num">${hasData ? s.rowCount.toLocaleString('es') : '—'}</span>
            <span class="lbl">Filas</span>
          </div>
          <div class="metric">
            <span class="num" style="font-size: var(--text-sm); font-weight: 600;">${hasData ? escapeHtml(formatDateTime(s.lastUpdatedAt)) : '—'}</span>
            <span class="lbl">Actualizado</span>
          </div>
        </div>
        ${s.error ? `<p class="form-error" style="margin:0;">${escapeHtml(errorMessage(s.error))}</p>` : ''}
        <button class="btn btn-primary btn-block" data-action="refresh" ${busy ? 'disabled' : ''}>
          ${icon('refresh', 16)} ${busy ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
    `;
  }

  function drawCards() {
    const grid = root.querySelector('#sourceGrid');
    if (!grid) return;
    grid.innerHTML = SOURCES.map(sourceCardHTML).join('');

    grid.querySelector('[data-key="referencia"] [data-action="refresh"]')
      ?.addEventListener('click', handleRefresh);

    grid.querySelectorAll('[data-action="stub"]').forEach((btn) => {
      btn.addEventListener('click', () => showToast('Esta fuente estará disponible próximamente.'));
    });
  }

  function showToast(text) {
    const old = document.getElementById('dbToast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'dbToast';
    toast.className = 'exit-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }
}
