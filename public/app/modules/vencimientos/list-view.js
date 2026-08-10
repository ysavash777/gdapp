/* ============================================================
   Módulo App · Vencimientos — listado.

   Un solo orden posible (ubicación A-Z, para el recorrido físico del
   depósito — lo trae así el servidor) y un FILTRO por estado:
   "Pendiente" (todo lo que falta validar) o "Validado" (lo ya
   resuelto, para revisar/revertir). No hay más un modo "Urgencia": la
   urgencia sigue visible en cada tarjeta (el color/número de días),
   pero ya no reordena la lista — pedido explícito.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { escapeHtml, formatDateTime } from '/shared/js/format.js';
import * as store from './store.js';
import { openValidation } from './validation-view.js';

const MOTIVO_LABEL = { ok: 'OK', faltante: 'Faltante', otro: 'Otro' };

let outletRef = null;

// Sin la frase "Vencido hace"/"Vence en" — el signo del número ya lo
// dice todo (negativo, 0, positivo).
function daysLabel(days) {
  return days === 0 ? 'Hoy' : `${days}d`;
}

// Copernico puede mandar el saldo con ceros de relleno ("144.0000") —
// ya llega limpio como Number desde el servidor (ver
// server/store/vencimientos.store.js); esto solo evita más de 2
// decimales si alguna vez hay una fracción real.
function formatQty(saldo) {
  if (saldo == null) return '-';
  return saldo.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// Jerarquía de lectura pedida explícitamente: 1) ubicación (a dónde
// dirigirse — la línea más grande y oscura de la tarjeta, primera),
// 2) descripción del producto, 3) caja/cantidad como apoyo menor. La
// fecha de vencimiento NO va acá (ya la resume el color/número de
// días, que es lo único temporal que hace falta para decidir qué
// atender primero) — aparece completa recién en la pantalla de
// validación, donde sí hace falta para confirmar el ítem exacto.
function itemCardHTML(item) {
  const desc = item.descripcion || 'Producto sin descripción';
  const um = item.unidadmedida ? ` ${item.unidadmedida}` : '';
  return `
    <button class="venc-card ${item.validated ? 'is-validated' : ''}" data-key="${escapeHtml(item.key)}">
      <div class="venc-card-main">
        <div class="venc-card-top">
          <span class="venc-card-ubicacion">${icon('pin', 15)} ${escapeHtml(item.ubicacion || '-')}</span>
          <span class="venc-card-days is-${item.severity}">${daysLabel(item.days)}</span>
        </div>
        <span class="venc-card-desc">${escapeHtml(desc)}</span>
        <span class="venc-card-sub">Caja ${escapeHtml(item.caja || '-')} · ${formatQty(item.saldo)}${escapeHtml(um)}</span>
      </div>
      ${item.validated
        ? `<div class="venc-card-check" title="Validado">${icon('check', 16)}</div>`
        : `<div class="venc-card-arrow">${icon('chevronRight', 16)}</div>`}
    </button>
  `;
}

export async function renderList(outlet) {
  outletRef = outlet;

  const state = { view: 'pendiente', items: [], loading: true, error: null };

  outlet.innerHTML = `
    <div class="action-hero">
      <div class="venc-toolbar">
        <div class="venc-sort-toggle" id="vencViewToggle">
          <button type="button" class="is-active" data-view="pendiente">Pendiente</button>
          <button type="button" data-view="validado">Validado</button>
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

  outlet.querySelectorAll('#vencViewToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === state.view) return;
      state.view = btn.dataset.view;
      outlet.querySelectorAll('#vencViewToggle button').forEach((b) => b.classList.toggle('is-active', b === btn));
      draw();
    });
  });
  outlet.querySelector('#vencSettingsBtn').addEventListener('click', openSettingsModal);

  async function load() {
    if (!outlet.isConnected) return;
    state.loading = true;
    state.error = null;
    try {
      const data = await store.list();
      state.items = data.items;
    } catch (err) {
      state.error = err;
      state.items = [];
    }
    state.loading = false;
    if (outlet.isConnected) draw();
  }

  function visibleItems() {
    return state.items.filter((i) => (state.view === 'validado' ? i.validated : !i.validated));
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

    const validatedCount = state.items.filter((i) => i.validated).length;
    progressEl.textContent = state.items.length ? `${validatedCount} de ${state.items.length} validados` : '';

    const items = visibleItems();
    if (!items.length) {
      wrap.innerHTML = `
        <div class="card cq-fade-in">
          <div class="empty-state">
            <div class="es-icon">${icon('calendarAlert', 26)}</div>
            <h3>${state.view === 'validado' ? 'Nada validado todavía' : '¡Todo al día!'}</h3>
            <p>${state.view === 'validado' ? 'Los ítems que valides van a aparecer acá.' : 'No hay productos pendientes de validar en la ventana configurada.'}</p>
          </div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `<div class="mapeo-list venc-list cq-fade-in">${items.map(itemCardHTML).join('')}</div>`;

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
          ${item.fotoUrl ? `<img src="${escapeHtml(item.fotoUrl)}" alt="Foto de la posición" class="venc-detail-photo" />` : ''}
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
