/* ============================================================
   Módulo App · Vencimientos — listado.

   Dos formas de ver la MISMA lista (nunca dos listas separadas):
   "Urgencia" (días a vencer ascendente, agrupado en sub-encabezados
   Vencido/Retirar/Próximo — para saber qué apagar primero) y
   "Ubicación" (A-Z, sin agrupar — para caminar el depósito en orden,
   sin ida y vuelta). El toggle vive en el propio header, no en un
   menú: es la acción principal de la pantalla.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { escapeHtml, formatDateTime } from '/shared/js/format.js';
import * as store from './store.js';
import { openValidation } from './validation-view.js';

const SEVERITY_LABEL = { vencido: 'Vencido', retirar: 'Retirar (≤4 días)', proximo: 'Próximo a vencer' };
const MOTIVO_LABEL = { ok: 'OK', vencido: 'Vencido', faltante: 'Faltante', otro: 'Otro' };

let outletRef = null;
let refreshRef = null;

function daysLabel(days) {
  if (days < 0) return `Vencido hace ${Math.abs(days)}d`;
  if (days === 0) return 'Hoy';
  return `${days}d`;
}

function itemCardHTML(item) {
  const desc = item.descripcion || 'Producto sin descripción';
  const um = item.unidadmedida ? ` ${item.unidadmedida}` : '';
  return `
    <button class="venc-card ${item.validated ? 'is-validated' : ''}" data-key="${escapeHtml(item.key)}">
      <div class="venc-card-days is-${item.severity}">${daysLabel(item.days)}</div>
      <div class="venc-card-info">
        <span class="venc-card-desc">${escapeHtml(desc)}</span>
        <div class="venc-card-meta">
          <span>${icon('pin', 12)} ${escapeHtml(item.ubicacion || '-')}</span>
          <span>${icon('package', 12)} ${item.caja || '-'} · ${item.saldo ?? '-'}${um}</span>
        </div>
      </div>
      ${item.validated
        ? `<div class="venc-card-check" title="Validado">${icon('check', 16)}</div>`
        : `<div class="venc-card-arrow">${icon('chevronRight', 16)}</div>`}
    </button>
  `;
}

function groupByUrgencia(items) {
  const parts = [];
  let lastSeverity = null;
  for (const item of items) {
    if (item.severity !== lastSeverity) {
      parts.push(`<div class="venc-group-heading">${SEVERITY_LABEL[item.severity]}</div>`);
      lastSeverity = item.severity;
    }
    parts.push(itemCardHTML(item));
  }
  return parts.join('');
}

export async function renderList(outlet) {
  outletRef = outlet;
  refreshRef = () => renderList(outlet);

  const state = { sortBy: 'urgencia', items: [], loading: true, error: null };

  outlet.innerHTML = `
    <div class="action-hero">
      <div class="venc-toolbar">
        <div class="venc-sort-toggle" id="vencSortToggle">
          <button type="button" class="is-active" data-sort="urgencia">Urgencia</button>
          <button type="button" data-sort="ubicacion">Ubicación</button>
        </div>
        <div class="venc-toolbar-actions">
          <button type="button" class="btn-icon" id="vencSettingsBtn" title="Ubicaciones excluidas">${icon('settings', 18)}</button>
          <a class="btn-icon" id="vencExportBtn" href="/api/vencimientos/export" title="Descargar XLSX">${icon('download', 18)}</a>
        </div>
      </div>
      <p class="venc-progress" id="vencProgress"></p>
      <div id="vencListWrap">
        <div class="mapeo-list cq-fade-in">
          ${[1, 2, 3].map(() => `
            <div class="venc-card">
              <div class="cq-skeleton" style="width:48px;height:32px;border-radius:var(--r-md);flex-shrink:0;"></div>
              <div class="venc-card-info">
                <span class="cq-skeleton" style="width:70%;height:14px;margin-bottom:6px;"></span>
                <span class="cq-skeleton" style="width:45%;height:11px;"></span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  outlet.querySelectorAll('#vencSortToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.sort === state.sortBy) return;
      state.sortBy = btn.dataset.sort;
      outlet.querySelectorAll('#vencSortToggle button').forEach((b) => b.classList.toggle('is-active', b === btn));
      load();
    });
  });
  outlet.querySelector('#vencSettingsBtn').addEventListener('click', openSettingsModal);

  async function load() {
    if (!outlet.isConnected) return;
    state.loading = true;
    state.error = null;
    try {
      const data = await store.list(state.sortBy);
      state.items = data.items;
    } catch (err) {
      state.error = err;
      state.items = [];
    }
    state.loading = false;
    if (outlet.isConnected) draw();
  }

  function draw() {
    const wrap = outlet.querySelector('#vencListWrap');
    const progressEl = outlet.querySelector('#vencProgress');
    if (!wrap) return;

    if (state.error) {
      progressEl.textContent = '';
      wrap.innerHTML = `
        <div class="card cq-fade-in">
          <div class="empty-state">
            <div class="es-icon">${icon('alertTriangle', 26)}</div>
            <h3>No se pudo cargar</h3>
            <p>Revisá tu conexión e intentá de nuevo.</p>
            <button type="button" class="btn btn-ghost" id="vencRetryBtn" style="margin-top:var(--sp-3);">${icon('refresh', 16)} Reintentar</button>
          </div>
        </div>
      `;
      wrap.querySelector('#vencRetryBtn').addEventListener('click', load);
      return;
    }

    if (!state.items.length) {
      progressEl.textContent = '';
      wrap.innerHTML = `
        <div class="card cq-fade-in">
          <div class="empty-state">
            <div class="es-icon">${icon('calendarAlert', 26)}</div>
            <h3>Sin vencimientos próximos</h3>
            <p>No hay productos por vencer dentro de la ventana configurada.</p>
          </div>
        </div>
      `;
      return;
    }

    const validatedCount = state.items.filter((i) => i.validated).length;
    progressEl.textContent = `${validatedCount} de ${state.items.length} validados`;

    wrap.innerHTML = `<div class="mapeo-list venc-list cq-fade-in">${
      state.sortBy === 'urgencia' ? groupByUrgencia(state.items) : state.items.map(itemCardHTML).join('')
    }</div>`;

    wrap.querySelectorAll('.venc-card').forEach((card) => {
      const item = state.items.find((i) => i.key === card.dataset.key);
      if (!item) return;
      card.addEventListener('click', () => {
        if (item.validated) openValidatedDetail(item);
        else openValidation(item, { onDone: load });
      });
    });
  }

  function openValidatedDetail(item) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="modal-head">
          <h3>${MOTIVO_LABEL[item.motivo] || item.motivo}</h3>
          <button class="btn-icon" data-close>${icon('x', 18)}</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:var(--sp-2);">${escapeHtml(item.descripcion || 'Producto sin descripción')}</p>
          ${item.motivoDetalle ? `<p class="muted small" style="margin-bottom:var(--sp-2);">${escapeHtml(item.motivoDetalle)}</p>` : ''}
          <p class="muted small">Validado por <strong>${escapeHtml(item.validatedBy || '-')}</strong> · ${escapeHtml(formatDateTime(item.validatedAt))}</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Cerrar</button>
          <button type="button" class="btn btn-danger" id="vencRevertBtn">Revertir</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    overlay.querySelector('#vencRevertBtn').addEventListener('click', async () => {
      await store.clearValidation(item);
      close();
      load();
    });
  }

  async function openSettingsModal() {
    let current = [];
    try {
      current = await store.getSettings();
    } catch {
      current = [];
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="modal-head">
          <h3>Ubicaciones excluidas</h3>
          <button class="btn-icon" data-close>${icon('x', 18)}</button>
        </div>
        <form id="vencSettingsForm">
          <div class="modal-body">
            <p class="muted small" style="margin-bottom:var(--sp-3);">
              Los productos en ubicaciones que EMPIECEN con cualquiera de estos textos
              no aparecen en el listado (no distingue mayúsculas/minúsculas).
              Separá cada una con una coma.
            </p>
            <div class="field">
              <label for="vencExcludedInput">Prefijos excluidos</label>
              <input type="text" id="vencExcludedInput" value="${escapeHtml(current.join(', '))}" placeholder="RECUPERO, DIFERENCIAS, Z, BIN" autocomplete="off" />
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelector('#vencSettingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = overlay.querySelector('#vencExcludedInput').value;
      const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
      await store.updateSettings(list);
      close();
      load();
    });
  }

  await load();
}
