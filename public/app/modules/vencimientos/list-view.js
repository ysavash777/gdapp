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

   Buscar/Configurar/Descargar viven agrupados en un único menú "más
   opciones" (ver moreMenuHTML() en renderList) en vez de 3 botones
   sueltos — con los 3 en la cabecera, en pantallas angostas
   deformaban el toggle Sugerido/Pendiente/Validado. Buscar filtra en
   vivo sobre ubicación/descripción/caja/referencia/sector/pedprov/
   factura, solo disponible en Pendiente/Validado (en Sugerido se ve
   una sola posición, no una lista para filtrar).
   ============================================================ */

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml, formatDateTime, capitalize } from '/shared/js/format.js';
import * as store from './store.js';
import { mountSuggestedFlow } from './validation-view.js';
import { showToast } from '/shared/js/toast.js';

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

// Mismo criterio que urgencyBannerHTML() en validation-view.js (el
// contenedor de Observación) — el detalle de "Validado" repite ese
// mismo aviso, pedido explícito ("debe contener lo mismo").
function urgencyBannerHTML(it) {
  if (it.isRetirar) {
    return `<div class="venc-suggest-urgency is-${it.severity}">${icon('alertTriangle', 16)} Retirar de ubicación</div>`;
  }
  return `<div class="venc-suggest-urgency is-${it.severity}">${icon('calendarAlert', 16)} Vence en ${it.days} día${it.days === 1 ? '' : 's'}</div>`;
}

// Ídem fitProdDescription() en validation-view.js — el detalle de
// "Validado" usa el mismo texto de 2 líneas + achique adaptativo.
const DETAIL_DESC_MIN_FONT_PX = 11;
function fitDetailDescription(el) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollHeight > el.clientHeight + 1 && size > DETAIL_DESC_MIN_FONT_PX) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

// Foto de evidencia a pantalla completa (ver .venc-detail-photo-thumb)
// — un único overlay creado al vuelo y descartado al cerrar, nunca
// vive de antemano en el DOM.
function openPhotoLightbox(url) {
  const box = document.createElement('div');
  box.className = 'venc-photo-lightbox';
  box.innerHTML = `
    <button type="button" class="btn-icon venc-photo-lightbox-close" title="Cerrar">${icon('x', 22)}</button>
    <img src="${escapeHtml(url)}" alt="Foto de la posición" />
  `;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  box.querySelector('.venc-photo-lightbox-close').addEventListener('click', close);
}

function subChipsHTML(item) {
  const um = item.unidadmedida ? ` ${item.unidadmedida}` : '';
  return `
    <span class="venc-card-sub-item">${iconSolid('caja', 13)} ${escapeHtml(item.caja || '-')}</span>
    <span class="venc-card-sub-item">${iconSolid('archivo', 13)} ${formatQty(item.saldo)}${escapeHtml(um)}</span>
    <span class="venc-card-sub-item">${iconSolid('calendario', 13)} ${escapeHtml(item.fv || '-')}</span>
  `;
}

// Última línea de una tarjeta ya validada: caja/saldo/vencimiento ya
// no aportan nada nuevo acá (son del PRODUCTO, no de la validación en
// sí) — lo que sí importa revisar de un vistazo es la observación que
// se dejó. Cortada con elipsis, nunca en 2 líneas (a diferencia de la
// fila de arriba): es solo un adelanto, el detalle completo se ve al
// tocar la tarjeta.
function commentRowHTML(item) {
  const text = item.motivoDetalle || MOTIVO_LABEL[item.motivo] || '-';
  return `
    <span class="venc-card-comment">${iconSolid('commentSolid', 13)}<span class="venc-card-comment-text">${escapeHtml(text)}</span></span>
  `;
}

// caja/cantidad/vencimiento tienen que entrar SIEMPRE en una sola
// línea (pedido explícito) — antes, cuando no entraban, cada uno se
// cortaba con elipsis y en pantallas angostas el dato quedaba
// ilegible. Acá, después de pintar, se mide cada fila real (no hay
// forma de saber de antemano si un texto entra: depende del ancho de
// pantalla Y del largo de esos 3 valores puntuales) y si algún dato
// no entra a su tamaño normal, toda la fila pasa a fuente más chica
// — un solo escalón ("levemente"), la elipsis de CSS queda como red
// de seguridad para el caso extremo en que ni así entre.
//
// Tolerancia de 6px (no 0/1px): un desborde mínimo todavía tiene
// margen para resolverse con la elipsis sin perder información real
// (recorta como mucho el último carácter) — activar el achique ahí
// era innecesario y se notaba más el cambio de tamaño que lo que
// evitaba.
const OVERFLOW_TOLERANCE_PX = 6;
function fitSubRows(container) {
  const tight = [];
  container.querySelectorAll('.venc-card-sub').forEach((row) => {
    const overflowing = Array.from(row.querySelectorAll('.venc-card-sub-item'))
      .some((item) => item.scrollWidth > item.clientWidth + OVERFLOW_TOLERANCE_PX);
    if (overflowing) tight.push(row);
  });
  tight.forEach((row) => row.classList.add('is-tight'));
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
    <button class="venc-card" data-key="${escapeHtml(item.key)}">
      <div class="venc-card-days is-${item.severity}">${daysLabel(item.days)}</div>
      <div class="venc-card-main">
        <span class="venc-card-ubicacion">${escapeHtml(item.ubicacion || '-')}</span>
        <span class="venc-card-desc">${escapeHtml(desc)}</span>
        <span class="venc-card-sub">${item.validated ? commentRowHTML(item) : subChipsHTML(item)}</span>
      </div>
      ${item.validated
        ? `<div class="venc-card-check" title="Validado">${icon('check', 16)}</div>`
        : `<div class="venc-card-arrow">${icon('chevronRight', 16)}</div>`}
    </button>
  `;
}

// Mismo acordeón que la ficha real de Sugerido (ver validation-view.js
// #renderValidationFlow) pero con esqueleto en vez de dato real — se
// muestra mientras store.list() contesta, así el contenedor entero
// (nav de ubicación + Caja + Producto) está siempre ahí, nunca una
// pantalla en blanco con spinner. "Sugerido" es la vista por defecto,
// así que es lo único que hace falta para el primer pintado.
function suggestedSkeletonHTML() {
  return `
    <div class="venc-suggest-inline">
      <div class="venc-acc-item venc-loc-nav">
        <button type="button" class="venc-loc-arrow" disabled>${icon('chevronLeft', 20)}</button>
        <div class="venc-loc-info">
          <span class="venc-loc-caption">Ubicación sugerida:</span>
          <strong class="venc-loc-ubicacion"><span class="cq-skeleton" style="width:64px;"></span></strong>
          <span class="venc-loc-caja">${iconSolid('caja', 13)}<span class="cq-skeleton" style="width:32px;"></span></span>
        </div>
        <button type="button" class="venc-loc-arrow" disabled>${icon('chevronRight', 20)}</button>
      </div>
      <div class="venc-acc-item" data-state="pending">
        <div class="venc-acc-head">
          <span class="venc-acc-avatar">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title">Confirmar ubicación</strong>
            <span class="venc-acc-head-sub">Escanea la etiqueta</span>
          </span>
        </div>
      </div>
      <div class="venc-acc-item" data-state="locked">
        <div class="venc-acc-head">
          <span class="venc-acc-avatar">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title"><span class="cq-skeleton" style="width:90%;"></span></strong>
            <span class="venc-acc-head-sub"><span class="cq-skeleton" style="width:70px;"></span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

export async function renderList(outlet) {
  outletRef = outlet;

  const state = { view: 'sugerido', suggestedIndex: 0, items: [], loading: true, error: null, query: '' };
  // Ficha de validación montada (cámara ya activa) mientras el modo
  // "Sugerido" está a la vista — se crea una sola vez al entrar (no en
  // cada draw()) y se destruye al salir de la pestaña, para no
  // relanzar la cámara sin necesidad. Ver drawSuggested().
  let suggestedFlow = null;

  outlet.innerHTML = `
    <div class="action-hero">
      <div class="venc-header">
        <div class="venc-toolbar">
          <div class="venc-sort-toggle" id="vencViewToggle">
            <button type="button" class="is-active" data-view="sugerido">Sugerido</button>
            <button type="button" data-view="pendiente">Pendiente<span class="venc-toggle-count" id="vencPendienteCount"></span></button>
            <button type="button" data-view="validado">Validado<span class="venc-toggle-count" id="vencValidadoCount"></span></button>
          </div>
          <div class="venc-more-wrap">
            <button type="button" class="btn-icon" id="vencMoreBtn" title="Más opciones">${iconSolid('lista', 18)}</button>
            <div class="mapeo-menu" id="vencMoreMenu" hidden></div>
          </div>
        </div>
        <div class="searchbar" id="vencSearchBar" hidden>
          ${icon('search', 18)}
          <input type="search" id="vencSearchInput" placeholder="Buscar..." autocomplete="off" />
          <button type="button" class="searchbar-clear" id="vencSearchClear" title="Limpiar búsqueda" aria-label="Limpiar búsqueda" hidden>${icon('x', 14)}</button>
        </div>
      </div>
      <div id="vencListWrap">${suggestedSkeletonHTML()}</div>
    </div>
  `;

  const moreBtn = outlet.querySelector('#vencMoreBtn');
  const moreMenu = outlet.querySelector('#vencMoreMenu');
  const searchBar = outlet.querySelector('#vencSearchBar');
  const searchInput = outlet.querySelector('#vencSearchInput');
  const searchClear = outlet.querySelector('#vencSearchClear');

  // Buscar/Configurar/Descargar viven juntos en un único menú (antes
  // eran 3 botones sueltos en la cabecera — con el de buscar sumado,
  // ya no entraban junto al toggle Sugerido/Pendiente/Validado sin
  // deformarlo en pantallas angostas). "Buscar" solo tiene sentido en
  // Pendiente/Validado (listas reales para filtrar) — en Sugerido se
  // ve una sola posición a la vez, así que ni aparece en el menú; se
  // arma de nuevo cada vez que se abre para reflejar el modo actual.
  function moreMenuHTML() {
    const canSearch = state.view !== 'sugerido';
    return `
      ${canSearch ? `<button type="button" class="user-menu-item" data-action="search">${icon('search', 16)} Buscar</button>` : ''}
      <button type="button" class="user-menu-item" data-action="settings">${icon('settings', 16)} Ubicaciones excluidas</button>
      <button type="button" class="user-menu-item" data-action="download">${icon('download', 16)} Descargar detalle</button>
    `;
  }

  function closeMoreMenu() {
    moreMenu.hidden = true;
  }

  function downloadExport() {
    const a = document.createElement('a');
    a.href = '/api/vencimientos/export';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function applyQuery() {
    const q = searchInput.value.trim().toLowerCase();
    state.query = q;
    searchClear.hidden = !q;
    draw();
  }

  function openSearchBar() {
    searchBar.hidden = false;
    searchInput.focus();
  }

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = moreMenu.hidden;
    if (opening) moreMenu.innerHTML = moreMenuHTML();
    moreMenu.hidden = !opening;
  });
  moreMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    closeMoreMenu();
    if (btn.dataset.action === 'search') openSearchBar();
    else if (btn.dataset.action === 'settings') openSettingsModal();
    else if (btn.dataset.action === 'download') downloadExport();
  });

  searchInput.addEventListener('input', applyQuery);
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    applyQuery();
    searchInput.focus();
  });
  // En desuso (se cierra sin haber escrito nada) se oculta solo — mismo
  // criterio que el buscador de Mapear.
  searchInput.addEventListener('blur', () => {
    if (searchInput.value.trim()) return;
    searchBar.hidden = true;
  });

  outlet.querySelectorAll('#vencViewToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === state.view) return;
      // Salir de Sugerido apaga la cámara de la ficha montada — nunca
      // debe seguir corriendo en segundo plano en otra pestaña.
      if (state.view === 'sugerido' && suggestedFlow) {
        suggestedFlow.destroy();
        suggestedFlow = null;
      }
      state.view = btn.dataset.view;
      // suggestedIndex NO se resetea acá: cambiar de modo y volver a
      // "Sugerido" debe mantener la misma posición donde se había
      // quedado — drawSuggested() arranca la ficha en ese índice.
      outlet.querySelectorAll('#vencViewToggle button').forEach((b) => b.classList.toggle('is-active', b === btn));
      // Sugerido no tiene buscador — si estaba abierto, se cierra.
      if (state.view === 'sugerido') searchBar.hidden = true;
      draw();
    });
  });

  // Tocar un ítem en "Pendiente" ya no abre nada aparte — salta a
  // Sugerido parado justo en esa posición (mismo criterio que elegir
  // "Sugerido" a mano, ver arriba). suggestedFlow ya está destruida a
  // esta altura (se sale de Sugerido apenas se cambia de pestaña), así
  // que drawSuggested() la monta de nuevo desde cero en el índice que
  // se fija acá — pero se destruye explícito antes por las dudas, para
  // no depender de en qué pestaña se estaba antes de llegar a Pendiente.
  function goToSugerido(item) {
    if (suggestedFlow) { suggestedFlow.destroy(); suggestedFlow = null; }
    const queue = pendingQueue();
    const idx = queue.findIndex((i) => i.key === item.key);
    state.suggestedIndex = idx === -1 ? 0 : idx;
    state.view = 'sugerido';
    outlet.querySelectorAll('#vencViewToggle button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'sugerido'));
    searchBar.hidden = true;
    draw();
  }

  // Separado de load(): la ficha de Sugerido necesita releer el
  // listado después de validar un ítem SIN pasar por draw() (eso
  // remontaría toda la pestaña y reiniciaría la cámara) — ver
  // drawSuggested()/onValidated más abajo.
  async function fetchItems() {
    try {
      const data = await store.list();
      state.items = data.items;
      state.error = null;
    } catch (err) {
      state.error = err;
      state.items = [];
    }
  }

  async function load() {
    if (!outlet.isConnected) return;
    state.loading = true;
    await fetchItems();
    state.loading = false;
    if (outlet.isConnected) draw();
  }

  function pendingQueue() {
    return state.items.filter((i) => !i.validated);
  }

  function matchesQuery(item) {
    if (!state.query) return true;
    const haystack = [item.ubicacion, item.descripcion, item.caja, item.referencia, item.sector, item.pedprov, item.factura]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(state.query);
  }

  function visibleItems() {
    return state.items
      .filter((i) => (state.view === 'validado' ? i.validated : !i.validated))
      .filter(matchesQuery);
  }

  // Cuenta al lado de cada toggle — se recalcula sola en cada draw(),
  // nunca pide nada aparte: ya tiene state.items en memoria.
  function updateCounts() {
    const pendEl = outlet.querySelector('#vencPendienteCount');
    const validEl = outlet.querySelector('#vencValidadoCount');
    if (pendEl) pendEl.textContent = state.loading ? '' : ` (${pendingQueue().length})`;
    if (validEl) validEl.textContent = state.loading ? '' : ` (${state.items.filter((i) => i.validated).length})`;
  }

  function draw() {
    updateCounts();
    const wrap = outlet.querySelector('#vencListWrap');
    if (!wrap) return;

    // Un error de red al recargar (p. ej. tras guardar Configurar)
    // reemplaza el contenido de wrap por la tarjeta de error de abajo
    // — sin esto, la ficha de Sugerido quedaba con la cámara corriendo
    // detrás de ese cartel, desconectada del DOM visible.
    if (state.error && suggestedFlow) { suggestedFlow.destroy(); suggestedFlow = null; }

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
      const hasQuery = !!state.query;
      wrap.innerHTML = `
        <div class="card cq-fade-in">
          <div class="empty-state">
            <div class="es-icon">${icon(hasQuery ? 'search' : 'calendarAlert', 26)}</div>
            <h3>${hasQuery ? 'Sin resultados' : (state.view === 'validado' ? 'Nada validado todavía' : '¡Todo al día!')}</h3>
            <p>${hasQuery ? 'Ningún ítem coincide con la búsqueda.' : (state.view === 'validado' ? 'Los ítems que valides van a aparecer acá.' : 'No hay productos pendientes de validar en la ventana configurada.')}</p>
          </div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `<div class="mapeo-list venc-list cq-fade-in">${items.map(itemCardHTML).join('')}</div>`;
    fitSubRows(wrap);

    wrap.querySelectorAll('.venc-card').forEach((card) => {
      const item = state.items.find((i) => i.key === card.dataset.key);
      if (!item) return;
      card.addEventListener('click', () => {
        if (item.validated) openValidatedDetail(item);
        else goToSugerido(item);
      });
    });
  }

  // "Sugerido": ya no es una tarjeta de resumen con un botón "Validar"
  // que abre una pantalla aparte — ese paso era innecesario, la ficha
  // de validación entera (selector de ubicación + acordeón Caja/
  // Producto/Observación) vive ACÁ directamente, montada una sola vez
  // mientras esta pestaña está a la vista (mountSuggestedFlow, ver
  // validation-view.js). Confirmar un ítem no cierra nada: la propia
  // ficha relee la cola (onValidated) y pasa sola a la siguiente
  // posición pendiente, sin volver a montar la cámara.
  function renderSuggestedEmpty(wrap) {
    wrap.innerHTML = `
      <div class="card cq-fade-in">
        <div class="empty-state">
          <div class="es-icon">${icon('check', 26)}</div>
          <h3>¡Todo validado!</h3>
          <p>No queda ninguna posición pendiente en la ventana configurada.</p>
        </div>
      </div>
    `;
  }

  function drawSuggested(wrap) {
    const queue = pendingQueue();
    if (!queue.length) {
      if (suggestedFlow) { suggestedFlow.destroy(); suggestedFlow = null; }
      renderSuggestedEmpty(wrap);
      return;
    }
    if (suggestedFlow) {
      // Ya montada: no se recrea nada (evita relanzar la cámara) — si
      // la cola cambió por otro motivo (p. ej. se excluyó una
      // ubicación desde Configurar), la ficha se entera sola y sigue
      // en el mismo ítem si sigue vigente, o avanza si no.
      suggestedFlow.refresh(queue);
      return;
    }

    state.suggestedIndex = Math.min(Math.max(state.suggestedIndex, 0), queue.length - 1);
    wrap.innerHTML = '';
    suggestedFlow = mountSuggestedFlow(wrap, queue[state.suggestedIndex], {
      pendingItems: queue,
      onIndexChange: (idx) => { state.suggestedIndex = idx; },
      // Optimista: el ítem ya se sabe validado ACÁ, sin pedirle nada
      // al servidor — evita el refetch completo de la lista por cada
      // validación (era el cuello de botella real: dos viajes de red
      // seguidos antes de poder avanzar). El guardado real sigue
      // corriendo en segundo plano (ver finishValidation); si falla,
      // onValidateError reincorpora el ítem acá mismo.
      onValidated: (validatedItem) => {
        const target = state.items.find((i) => i.key === validatedItem.key);
        if (target) target.validated = true;
        updateCounts();
        return pendingQueue();
      },
      onValidateError: (failedItem) => {
        const target = state.items.find((i) => i.key === failedItem.key);
        if (target) target.validated = false;
        updateCounts();
        suggestedFlow?.refresh(pendingQueue());
      },
      onEmpty: () => {
        suggestedFlow = null;
        renderSuggestedEmpty(wrap);
      },
    });
  }

  // Mismo contenido que el contenedor de Observación (validation-view.js
  // #renderCommentInfo): avatar + descripción, grilla Saldo/Pedprov/
  // Vencimiento, aviso de acción, foto (si hay) y la observación en sí
  // — con la diferencia de que acá el texto ya llega completo (lo que
  // se haya escrito, o "Faltante" si ese fue el motivo) y se puede
  // editar sin rehacer nada: "Guardar" solo pisa la observación
  // (PATCH /api/vencimientos/validate, ver store.js#updateObservacion),
  // nunca vuelve a tocar motivo/foto/Caja/Producto.
  function openValidatedDetail(item) {
    const um = item.unidadmedida ? ` ${item.unidadmedida}` : '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="modal-head">
          <h3>Detalle</h3>
          <button class="btn-icon" data-close>${icon('x', 18)}</button>
        </div>
        <div class="modal-body">
          <div class="venc-comment-head" style="margin-bottom:var(--sp-3);">
            <span class="venc-acc-avatar" style="background:var(--ok); color:#fff;">${icon('check', 18)}</span>
            <p class="venc-comment-desc" id="vencDetailDesc">${escapeHtml(item.descripcion || 'Producto sin descripción')}</p>
          </div>
          <div class="reg-info-grid venc-review-grid" style="margin-bottom:var(--sp-3);">
            <div class="reg-info-cell">
              <span class="reg-info-label">Saldo</span>
              <span class="reg-info-value">${escapeHtml(formatQty(item.saldo))}${escapeHtml(um)}</span>
            </div>
            <div class="reg-info-cell">
              <span class="reg-info-label">Pedprov</span>
              <span class="reg-info-value">${escapeHtml(item.pedprov || '-')}</span>
            </div>
            <div class="reg-info-cell">
              <span class="reg-info-label">Vencimiento</span>
              <span class="reg-info-value">${escapeHtml(item.fv || '-')}</span>
            </div>
          </div>
          <div style="margin-bottom:var(--sp-3);">${urgencyBannerHTML(item)}</div>
          ${item.fotoUrl ? `<img src="${escapeHtml(item.fotoUrl)}" alt="Foto de la posición" class="venc-detail-photo-thumb" id="vencDetailPhoto" />` : ''}
          <textarea class="venc-acc-comment-input" id="vencDetailObs" rows="3" maxlength="200" placeholder="Añadir observación">${escapeHtml(item.motivoDetalle || '')}</textarea>
          <p class="muted small" style="margin-top:var(--sp-2);">Validado por <strong>${escapeHtml(capitalize(item.validatedBy || '-'))}</strong> · ${escapeHtml(formatDateTime(item.validatedAt))}</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Cerrar</button>
          <button type="button" class="btn btn-danger" id="vencRevertBtn">Revertir</button>
          <button type="button" class="btn btn-primary" id="vencSaveObsBtn" disabled>Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    fitDetailDescription(overlay.querySelector('#vencDetailDesc'));

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

    const photoEl = overlay.querySelector('#vencDetailPhoto');
    if (photoEl) photoEl.addEventListener('click', () => openPhotoLightbox(item.fotoUrl));

    // Optimista: cierra y actualiza la lista YA (nada más queda por
    // esperar del lado del cliente, ya sabemos que revirtió) — el
    // DELETE real corre en segundo plano. Si de verdad falla, se
    // vuelve a marcar validado y se avisa, en vez de dejar la UI
    // mintiendo que revirtió cuando el servidor no lo confirmó.
    overlay.querySelector('#vencRevertBtn').addEventListener('click', () => {
      close();
      const target = state.items.find((i) => i.key === item.key);
      if (target) target.validated = false;
      draw();
      store.clearValidation(item).catch(() => {
        const t = state.items.find((i) => i.key === item.key);
        if (t) t.validated = true;
        draw();
        showToast('No se pudo revertir. Probá de nuevo.', { variant: 'warn' });
      });
    });

    // La observación sigue siendo obligatoria (mismo criterio que al
    // validar) — "Guardar" queda deshabilitado con el campo vacío o
    // sin cambios reales.
    const obsInput = overlay.querySelector('#vencDetailObs');
    const saveBtn = overlay.querySelector('#vencSaveObsBtn');
    const original = item.motivoDetalle || '';
    obsInput.addEventListener('input', () => {
      const texto = obsInput.value.trim();
      saveBtn.disabled = !texto || texto === original;
    });
    saveBtn.addEventListener('click', () => {
      const texto = obsInput.value.trim();
      if (!texto || texto === original) return;
      close();
      const target = state.items.find((i) => i.key === item.key);
      const previous = target?.motivoDetalle;
      if (target) target.motivoDetalle = texto;
      draw();
      store.updateObservacion(item, texto).catch(() => {
        const t = state.items.find((i) => i.key === item.key);
        if (t) t.motivoDetalle = previous;
        draw();
        showToast('No se pudo guardar la observación. Probá de nuevo.', { variant: 'warn' });
      });
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

// Cierra el menú "más opciones" al tocar fuera de él — mismo patrón
// que el menú de opciones de cada mapeo (ver mapear/list-view.js): un
// solo listener a nivel documento, agregado una vez al cargar el
// módulo (no por cada render), que lee outletRef dinámicamente.
document.addEventListener('click', (e) => {
  if (!outletRef) return;
  if (e.target.closest('.venc-more-wrap')) return;
  const menu = outletRef.querySelector('#vencMoreMenu');
  if (menu) menu.hidden = true;
});
