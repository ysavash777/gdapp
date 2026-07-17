/* ============================================================
   Módulo Desk · Bases de datos
   Un solo botón "Actualizar DB" para todas las fuentes — hoy solo
   dispara el motor de "Referencia" (server/services/inventory-engine.js)
   porque es la única configurada, pero el control es uno solo para
   toda la pantalla: cuando Variables/Coordenadas/Líneas picking tengan
   su propio motor, este mismo botón las va a disparar a todas.

   Cada tarjeta es solo una vidriera de estado (ícono, sin texto) —
   nunca tienen su propia acción. Tampoco se muestran las filas
   traídas acá, solo la cantidad y el horario (el detalle vive en el
   servidor, listo para consultarse desde otro módulo sin que el
   navegador tenga que cargarlo).
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
  TIMEOUT: 'Copernico no respondió a tiempo. Probá de nuevo en un momento.',
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

// Sin datos de progreso real (Copernico no informa avance, solo
// responde entero al final), así que el relleno se calibra contra la
// última corrida exitosa conocida — no es una barra "de mentira" que
// da vueltas para siempre, es una estimación que avanza una sola vez
// de 0 a ~92% y se completa de golpe cuando la corrida real termina
// (antes o después de lo estimado).
const DEFAULT_ESTIMATE_MS = 30_000;

async function mount(root) {
  const state = {
    refreshing: false,
    error: null,
    referencia: { status: 'empty', lastUpdatedAt: null, rowCount: 0, durationMs: null },
  };

  drawShell();
  await loadStatus();

  function applyMeta(meta) {
    state.referencia.status = meta.status;
    state.referencia.lastUpdatedAt = meta.lastUpdatedAt;
    state.referencia.rowCount = meta.rowCount;
    if (meta.durationMs) state.referencia.durationMs = meta.durationMs;
  }

  function startProgress() {
    const fill = root.querySelector('.db-refresh-btn-fill');
    if (!fill) return;
    const estimateMs = state.referencia.durationMs || DEFAULT_ESTIMATE_MS;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth; // fuerza reflow: sin esto, el navegador puede fusionar este cambio con el de abajo y saltar directo a 92%, sin animar
    fill.style.transition = `width ${estimateMs}ms linear`;
    fill.style.width = '92%';
  }

  function finishProgress() {
    const fill = root.querySelector('.db-refresh-btn-fill');
    if (!fill) return;
    fill.style.transition = 'width 250ms ease';
    fill.style.width = '100%';
    setTimeout(() => {
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }, 300);
  }

  async function loadStatus() {
    let running = false;
    try {
      const data = await apiFetch('/api/database/status');
      applyMeta(data.meta);
      running = data.running;
    } catch {
      // Sin conexión al status: se queda con el último estado local
      // conocido (por defecto "Sin datos") en vez de romper la vista.
    }
    drawCards();
    if (running) {
      // Alguien más (otra pestaña/persona) ya disparó una corrida —
      // el botón se muestra ocupado igual, en vez de dejar pensar que
      // se puede tocar de nuevo, y se refleja cuando esa corrida ajena
      // termine. Nunca dispara una corrida nueva por su cuenta.
      state.refreshing = true;
      drawButton();
      startProgress();
      await pollUntilDone();
    } else {
      drawButton();
    }
  }

  async function pollUntilDone() {
    while (root.isConnected) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!root.isConnected) return;
      try {
        const data = await apiFetch('/api/database/status');
        if (!data.running) { applyMeta(data.meta); break; }
      } catch {
        break;
      }
    }
    finishProgress();
    state.refreshing = false;
    drawButton();
    drawCards();
  }

  async function handleRefresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    state.error = null;
    drawButton();
    drawCards();
    startProgress();
    try {
      const data = await apiFetch('/api/database/refresh', { method: 'POST' });
      applyMeta(data.meta);
    } catch (err) {
      state.referencia.status = 'error';
      state.error = err;
    }
    finishProgress();
    state.refreshing = false;
    drawButton();
    drawCards();
  }

  function drawShell() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Bases de datos</h1>
          <p class="ph-sub muted">Fuentes de datos de Copernico WMS disponibles para la operación.</p>
        </div>
        <button class="btn btn-primary db-refresh-btn" id="btnRefresh">
          <span class="db-refresh-btn-tint"></span>
          <span class="db-refresh-btn-fill"></span>
          <span class="db-refresh-btn-content">${icon('refresh', 18)} Actualizar DB</span>
        </button>
      </div>
      <p class="form-error" id="refreshError" style="display:none;"></p>
      <div class="db-source-grid" id="sourceGrid"></div>
    `;
    root.querySelector('#btnRefresh').addEventListener('click', handleRefresh);
  }

  function drawButton() {
    const btn = root.querySelector('#btnRefresh');
    if (!btn) return;
    btn.disabled = state.refreshing;
    btn.classList.toggle('is-loading', state.refreshing);

    const errEl = root.querySelector('#refreshError');
    if (errEl) {
      errEl.textContent = state.error ? errorMessage(state.error) : '';
      errEl.style.display = state.error ? '' : 'none';
    }
  }

  function sourceCardHTML(src) {
    const s = src.active ? state.referencia : { status: 'empty', lastUpdatedAt: null, rowCount: 0 };
    const st = STATUS_ICON[s.status] || STATUS_ICON.empty;
    const hasData = s.rowCount > 0;

    return `
      <div class="card db-source-card" data-key="${src.key}">
        <div class="db-source-head">
          <div class="db-source-name">
            <div class="tc-icon-sm">${icon(src.icon, 18)}</div>
            <h3>${src.label}</h3>
          </div>
          <div class="db-status-icon ${st.cls}" title="${st.title}">${icon(st.name, 16)}</div>
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
      </div>
    `;
  }

  function drawCards() {
    const grid = root.querySelector('#sourceGrid');
    if (!grid) return;
    grid.innerHTML = SOURCES.map(sourceCardHTML).join('');
  }
}
