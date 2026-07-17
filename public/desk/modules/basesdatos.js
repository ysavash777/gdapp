/* ============================================================
   Módulo Desk · Bases de datos
   Dispara y muestra el estado del motor de actualización de
   referencia (Copernico WMS) — ver server/services/inventory-engine.js
   para la orquestación real (login/consultar/logout con lock de una
   sola corrida). Este archivo solo llama a /api/database/* y pinta
   el resultado; nunca vuelve a llamarse a sí mismo automáticamente.

   La tabla de resultados pagina en el servidor (GET /api/database/rows)
   — el navegador nunca carga las ~12.000 filas de una sola vez, solo
   la página visible.
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

function prettifyColumn(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const title = 'Bases de datos';

export function render(outlet) {
  const root = document.createElement('div');
  outlet.innerHTML = '';
  outlet.appendChild(root);
  mount(root);
}

async function mount(root) {
  const state = {
    meta: { lastUpdatedAt: null, rowCount: 0, bodega: null, columns: [] },
    running: false,
    refreshing: false,
    refreshError: null,
    rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1,
    q: '', sortBy: null, sortDir: 1,
    tableLoading: false, tableError: null,
  };
  let searchDebounce = null;

  drawShell();
  await loadStatus();
  if (state.meta.rowCount > 0) await loadRows();

  async function loadStatus() {
    try {
      const data = await apiFetch('/api/database/status');
      state.meta = data.meta;
      state.running = data.running;
    } catch {
      // El status es informativo — si falla, seguimos mostrando el
      // último estado conocido en vez de romper la pantalla.
    }
    drawSummary();
  }

  async function loadRows() {
    state.tableLoading = true;
    drawTable();
    try {
      const params = new URLSearchParams({
        q: state.q, page: state.page, pageSize: state.pageSize,
        ...(state.sortBy ? { sortBy: state.sortBy, sortDir: state.sortDir === -1 ? 'desc' : 'asc' } : {}),
      });
      const data = await apiFetch(`/api/database/rows?${params}`);
      state.rows = data.items;
      state.total = data.total;
      state.page = data.page;
      state.totalPages = data.totalPages;
      state.tableError = null;
    } catch (err) {
      state.rows = [];
      state.tableError = err;
    }
    state.tableLoading = false;
    drawTable();
  }

  async function handleRefresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    state.refreshError = null;
    drawSummary();
    try {
      const data = await apiFetch('/api/database/refresh', { method: 'POST' });
      state.meta = data.meta;
      state.page = 1;
      await loadRows();
    } catch (err) {
      state.refreshError = err;
    }
    state.refreshing = false;
    drawSummary();
  }

  function drawShell() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Bases de datos</h1>
          <p class="ph-sub muted">Referencia de Copernico WMS — actualizala manualmente cuando la necesites al día.</p>
        </div>
        <button class="btn btn-primary" id="btnRefresh">${icon('refresh', 18)} Actualizar DB</button>
      </div>

      <div class="card" id="summaryCard"></div>

      <div class="card" style="margin-top: var(--sp-4);">
        <div class="searchbar" style="max-width: 340px;">
          ${icon('search', 18)}
          <input type="search" id="searchInput" placeholder="Buscar en cualquier columna…" />
        </div>
        <div id="tableWrap" style="margin-top: var(--sp-4); overflow-x: auto;"></div>
        <div id="paginationWrap" class="row" style="justify-content: flex-end; margin-top: var(--sp-3); display:none;"></div>
      </div>
    `;

    root.querySelector('#btnRefresh').addEventListener('click', handleRefresh);
    root.querySelector('#searchInput').addEventListener('input', (e) => {
      state.q = e.target.value;
      state.page = 1;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(loadRows, 300);
    });
  }

  function drawSummary() {
    const card = root.querySelector('#summaryCard');
    if (!card) return;

    const btn = root.querySelector('#btnRefresh');
    const busy = state.refreshing || state.running;
    btn.disabled = busy;
    btn.innerHTML = busy
      ? `${icon('refresh', 18)} Actualizando…`
      : `${icon('refresh', 18)} Actualizar DB`;

    const hasData = state.meta.rowCount > 0;
    card.innerHTML = `
      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: var(--sp-3);">
        <div class="row" style="gap: var(--sp-5); flex-wrap: wrap;">
          <div>
            <p class="small muted" style="margin: 0 0 2px;">Última actualización</p>
            <p style="margin:0; font-weight: 650;">${hasData ? escapeHtml(formatDateTime(state.meta.lastUpdatedAt)) : 'Nunca'}</p>
          </div>
          <div>
            <p class="small muted" style="margin: 0 0 2px;">Filas traídas</p>
            <p style="margin:0; font-weight: 650;">${hasData ? state.meta.rowCount.toLocaleString('es') : '—'}</p>
          </div>
          <div>
            <p class="small muted" style="margin: 0 0 2px;">Bodega</p>
            <p style="margin:0; font-weight: 650;">${hasData ? escapeHtml(String(state.meta.bodega)) : '—'}</p>
          </div>
        </div>
        <span class="badge ${busy ? 'badge-warn' : hasData ? 'badge-ok' : 'badge-neutral'}">
          ${busy ? 'Actualizando' : hasData ? 'Al día' : 'Sin datos'}
        </span>
      </div>
      ${state.refreshError ? `<p class="form-error" style="margin: var(--sp-3) 0 0;">${escapeHtml(errorMessage(state.refreshError))}</p>` : ''}
    `;
  }

  function drawTable() {
    const wrap = root.querySelector('#tableWrap');
    const pagWrap = root.querySelector('#paginationWrap');
    if (!wrap) return;

    if (state.tableLoading) {
      wrap.innerHTML = `<div class="empty-state"><p>Cargando…</p></div>`;
      pagWrap.style.display = 'none';
      return;
    }

    if (state.tableError) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${icon('database', 26)}</div>
          <h3>No se pudo cargar</h3>
          <p>${escapeHtml(errorMessage(state.tableError))}</p>
        </div>`;
      pagWrap.style.display = 'none';
      return;
    }

    if (!state.rows.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${icon('database', 26)}</div>
          <h3>Sin datos todavía</h3>
          <p>${state.q ? 'No hay resultados para esa búsqueda.' : 'Tocá "Actualizar DB" para traer la referencia de Copernico.'}</p>
        </div>`;
      pagWrap.style.display = 'none';
      return;
    }

    const columns = state.meta.columns.length ? state.meta.columns : Object.keys(state.rows[0]).filter((k) => k !== '_row_id');

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>${columns.map((c) => `
            <th data-col="${c}" style="cursor:pointer; white-space:nowrap;">
              ${escapeHtml(prettifyColumn(c))}${state.sortBy === c ? (state.sortDir === 1 ? ' ↑' : ' ↓') : ''}
            </th>`).join('')}</tr>
        </thead>
        <tbody>
          ${state.rows.map((r) => `
            <tr>${columns.map((c) => `<td style="white-space:nowrap;">${r[c] != null ? escapeHtml(String(r[c])) : '—'}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('th[data-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (state.sortBy === col) state.sortDir *= -1;
        else { state.sortBy = col; state.sortDir = 1; }
        state.page = 1;
        loadRows();
      });
    });

    pagWrap.style.display = 'flex';
    pagWrap.innerHTML = `
      <span class="small muted" style="margin-right: var(--sp-3);">
        ${state.total.toLocaleString('es')} resultado${state.total === 1 ? '' : 's'} · página ${state.page} de ${state.totalPages}
      </span>
      <button class="btn-icon" id="pagPrev" title="Anterior" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', 18)}</button>
      <button class="btn-icon" id="pagNext" title="Siguiente" ${state.page >= state.totalPages ? 'disabled' : ''}>${icon('chevronRight', 18)}</button>
    `;
    pagWrap.querySelector('#pagPrev').addEventListener('click', () => { state.page -= 1; loadRows(); });
    pagWrap.querySelector('#pagNext').addEventListener('click', () => { state.page += 1; loadRows(); });
  }
}
