/* ============================================================
   Módulo App · Vencimientos — listado.

   Un solo orden posible (ubicación A-Z, para el recorrido físico del
   depósito — lo trae así el servidor) y TRES modos, todos sobre la
   misma lista ya cargada (nunca pedidos separados al servidor):
     "Sugerido"   — modo por DEFECTO y primero en el toggle: UNA sola
                    posición pendiente a la vez, con navegación
                    anterior/siguiente — para cuando lo que hace falta
                    no es revisar todo, sino que alguien sepa YA a
                    dónde ir sin tener que elegir de una lista.
     "Pendiente"  — todo lo que falta validar, en lista.
     "Validado"   — lo ya resuelto, para revisar/revertir.
   La urgencia (color/número de días) sigue visible en cada tarjeta,
   pero no reordena nada — pedido explícito.

   Sin buscador por ahora (se sacó uno anterior por no responder a la
   lógica de filtro real que hace falta — pendiente de definir).
   ============================================================ */

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml, formatDateTime, capitalize } from '/shared/js/format.js';
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

// El contenedor de la ubicación (modo Sugerido) tiene que medir
// siempre lo mismo, sin importar el largo del código — nunca al
// revés (achicar el texto, nunca estirar la caja): mismo criterio que
// qtySizeClass()/chipSizeClass() en otras herramientas de la app.
function ubicacionSizeClass(text) {
  const len = String(text || '').length;
  if (len <= 8) return '';
  if (len <= 11) return 'is-md';
  if (len <= 14) return 'is-sm';
  return 'is-xs';
}

function subChipsHTML(item) {
  const um = item.unidadmedida ? ` ${item.unidadmedida}` : '';
  return `
    <span class="venc-card-sub-item">${iconSolid('caja', 13)} ${escapeHtml(item.caja || '-')}</span>
    <span class="venc-card-sub-item">${iconSolid('archivo', 13)} ${formatQty(item.saldo)}${escapeHtml(um)}</span>
    <span class="venc-card-sub-item">${iconSolid('calendario', 13)} ${escapeHtml(item.fv || '-')}</span>
  `;
}

// Jerarquía de lectura pedida explícitamente: 1) ubicación (a dónde
// dirigirse — la línea más grande y oscura de la tarjeta, primera,
// SIN ícono), 2) descripción del producto, 3) caja/cantidad/
// vencimiento como apoyo menor, cada uno con su ícono sólido. Estos 3
// datos SIEMPRE completos (nunca cortados con "…") — en pantallas
// angostas pasan a una segunda línea en vez de truncarse (ver
// .venc-card-sub, flex-wrap). La "vida útil" (círculo de días) va a
// la IZQUIERDA, centrada en las dos direcciones y en toda la altura
// del contenedor.
function itemCardHTML(item) {
  const desc = item.descripcion || 'Producto sin descripción';
  return `
    <button class="venc-card ${item.validated ? 'is-validated' : ''}" data-key="${escapeHtml(item.key)}">
      <div class="venc-card-days is-${item.severity}">${daysLabel(item.days)}</div>
      <div class="venc-card-main">
        <span class="venc-card-ubicacion">${escapeHtml(item.ubicacion || '-')}</span>
        <span class="venc-card-desc">${escapeHtml(desc)}</span>
        <span class="venc-card-sub">${subChipsHTML(item)}</span>
      </div>
      ${item.validated
        ? `<div class="venc-card-check" title="Validado">${icon('check', 16)}</div>`
        : `<div class="venc-card-arrow">${icon('chevronRight', 16)}</div>`}
    </button>
  `;
}

// "Vida útil": para lo que ya hay que sacar de la góndola (vencido, o
// vence en <=4 días — mismo corte que RETIRAR_DAYS del servidor) es
// una instrucción directa, no un dato — "Retirar de ubicación", nunca
// solo el número de días. Para lo que todavía tiene margen, un aviso
// más informativo y menos alarmante.
function urgencyBannerHTML(item) {
  if (item.isRetirar) {
    return `<div class="venc-suggest-urgency is-${item.severity}">${icon('alertTriangle', 16)} Retirar de ubicación</div>`;
  }
  return `<div class="venc-suggest-urgency is-${item.severity}">${icon('calendarAlert', 16)} Vence en ${item.days} día${item.days === 1 ? '' : 's'}</div>`;
}

export async function renderList(outlet) {
  outletRef = outlet;

  const state = { view: 'sugerido', suggestedIndex: 0, items: [], loading: true, error: null };

  outlet.innerHTML = `
    <div class="action-hero">
      <div class="venc-header">
        <div class="venc-toolbar">
          <div class="venc-sort-toggle" id="vencViewToggle">
            <button type="button" class="is-active" data-view="sugerido">Sugerido</button>
            <button type="button" data-view="pendiente">Pendiente</button>
            <button type="button" data-view="validado">Validado</button>
          </div>
          <div class="venc-toolbar-actions">
            <button type="button" class="btn-icon" id="vencSettingsBtn" title="Ubicaciones excluidas">${icon('settings', 18)}</button>
            <a class="btn-icon" id="vencExportBtn" href="/api/vencimientos/export" title="Descargar XLSX">${icon('download', 18)}</a>
          </div>
        </div>
      </div>
      <div id="vencListWrap">
        <div class="gd-spinner-wrap"><div class="gd-spinner"></div></div>
      </div>
    </div>
  `;

  outlet.querySelectorAll('#vencViewToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === state.view) return;
      state.view = btn.dataset.view;
      // suggestedIndex NO se resetea acá: cambiar de modo y volver a
      // "Sugerido" debe mantener la misma posición donde se había
      // quedado — drawSuggested() ya lo clampea solo si la cola
      // pendiente cambió de tamaño (por ejemplo, se validó algo).
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

  function pendingQueue() {
    return state.items.filter((i) => !i.validated);
  }

  function visibleItems() {
    return state.items.filter((i) => (state.view === 'validado' ? i.validated : !i.validated));
  }

  function draw() {
    const wrap = outlet.querySelector('#vencListWrap');
    if (!wrap) return;

    if (state.error) {
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

    if (state.view === 'sugerido') {
      drawSuggested(wrap);
      return;
    }

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

  // "Sugerido": una sola posición pendiente a la vez, en el mismo
  // orden alfabético que el resto — pensado para que el operario sepa
  // YA a dónde ir, sin tener que leer y elegir de una lista. Las
  // flechas van a los costados de la ubicación (es la acción de
  // moverse ENTRE ubicaciones, tiene que estar pegada a ese dato, no
  // en una barra aparte). Validar esa posición la saca de la cola y
  // la siguiente ocupa su lugar solo (mismo índice, cola más corta) —
  // sin eso, tendría que buscar manualmente por dónde seguía.
  function drawSuggested(wrap) {
    const queue = pendingQueue();
    if (!queue.length) {
      wrap.innerHTML = `
        <div class="card cq-fade-in">
          <div class="empty-state">
            <div class="es-icon">${icon('check', 26)}</div>
            <h3>¡Todo validado!</h3>
            <p>No queda ninguna posición pendiente en la ventana configurada.</p>
          </div>
        </div>
      `;
      return;
    }

    state.suggestedIndex = Math.min(Math.max(state.suggestedIndex, 0), queue.length - 1);
    const item = queue[state.suggestedIndex];
    const isFirst = state.suggestedIndex === 0;
    const isLast = state.suggestedIndex === queue.length - 1;

    wrap.innerHTML = `
      <div class="venc-suggest cq-fade-in">
        <div class="venc-suggest-card">
          <span class="venc-suggest-label">Ubicación</span>
          <div class="venc-suggest-locrow">
            <button type="button" class="venc-suggest-arrow" id="vencSuggestPrev" title="Anterior" ${isFirst ? 'disabled' : ''}>${icon('chevronLeft', 22)}</button>
            <div class="venc-suggest-ubicacion ${ubicacionSizeClass(item.ubicacion)}">${escapeHtml(item.ubicacion || '-')}</div>
            <button type="button" class="venc-suggest-arrow" id="vencSuggestNext" title="Siguiente" ${isLast ? 'disabled' : ''}>${icon('chevronRight', 22)}</button>
          </div>
          <hr class="venc-suggest-divider" />
          <p class="venc-suggest-desc">${escapeHtml(item.descripcion || 'Producto sin descripción')}</p>
          <div class="venc-card-sub venc-suggest-sub">${subChipsHTML(item)}</div>
        </div>
        ${urgencyBannerHTML(item)}
        <button type="button" class="btn btn-primary btn-block venc-suggest-cta" id="vencSuggestValidate">Validar esta posición</button>
      </div>
    `;

    wrap.querySelector('#vencSuggestPrev').addEventListener('click', () => {
      if (isFirst) return;
      state.suggestedIndex -= 1;
      draw();
    });
    wrap.querySelector('#vencSuggestNext').addEventListener('click', () => {
      if (isLast) return;
      state.suggestedIndex += 1;
      draw();
    });
    wrap.querySelector('#vencSuggestValidate').addEventListener('click', () => {
      openValidation(item, { onDone: load });
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
          <p class="muted small">Validado por <strong>${escapeHtml(capitalize(item.validatedBy || '-'))}</strong> · ${escapeHtml(formatDateTime(item.validatedAt))}</p>
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
