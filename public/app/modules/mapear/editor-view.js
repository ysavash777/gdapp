// Módulo App · Mapear — editor de un mapeo (nuevo o existente), overlay a
// pantalla completa: escanear, corregir o borrar códigos; nunca queda "cerrado".
// Cámara/lectura corren sobre scanner/camera.js (compartido con Consultar grupo).
// store.js guarda cada alta/edición/baja localmente y sincroniza en segundo
// plano (sync-engine.js): addCode/updateCode/removeCode nunca esperan la red,
// y store.subscribe() avisa cuando cambia el estado de sync para redibujar el ícono.

import { icon, iconSolid } from '/shared/js/icons.js';
import { apiFetch } from '/shared/js/api.js';
import * as store from './store.js';
import { escapeHtml, CONDITIONS, conditionLabel } from './format.js';
import { currentUser } from '/shared/js/session.js';
import { existsLocal, hasData } from '/shared/js/product-catalog.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';

const GENERIC_DESCRIPTION = 'Producto sin descripción';

// Último responsable de rotura marcado (entre registros, no entre sesiones),
// para preseleccionarlo en el próximo alta — ver openRegisterSheet.
let lastRoturaResponsible = null;

function actor() {
  return currentUser()?.username || null;
}

// Mismo criterio que formatQty() en vencimientos/list-view.js.
function formatStockQty(qty) {
  return Number(qty).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// Ancho fijo (.record-qty); de 1 a 5 cifras entran achicando la fuente.
function qtySizeClass(quantity) {
  const len = String(quantity).length;
  if (len <= 2) return '';
  if (len === 3) return 'is-md';
  if (len === 4) return 'is-sm';
  return 'is-xs';
}

// Franja de 2 líneas de alto fijo (.record-desc); texto largo achica la fuente.
function descSizeClass(text) {
  if (text.length <= 46) return '';
  if (text.length <= 80) return 'is-md';
  return 'is-sm';
}

// Mismo criterio de "dato extra" que el consolidado del XLSX
// (server/services/mapeo-export.js): agrupa registros iguales código+motivo+dato.
function extraKeyOf(c) {
  if (c.condition === 'rotura' || c.condition === 'vencido') return c.roturaResponsible || '';
  if (c.condition === 'unidades') return c.expiryDate || '';
  if (c.condition === 'otro') return c.customReason || '';
  return '';
}

// Rotura se colorea por responsable (IDL/Rappi); Vencido siempre es IDL,
// así que usa su propio color de motivo, igual que Unidades y Otro.
function motivoColorClass(c) {
  if (c.condition === 'rotura') {
    return c.roturaResponsible ? `resp-${c.roturaResponsible}` : 'is-empty';
  }
  return c.condition ? `cond-${c.condition}` : 'is-empty';
}

// Círculo girando = local, camino a la base; tilde = confirmado; reloj = sin conexión.
function syncIconHTML(status) {
  if (status === 'offline') {
    return `<span class="sync-status-icon" title="Sin conexión — pendiente de enviar">${icon('clock', 13)}</span>`;
  }
  if (status === 'synced') {
    return `<span class="sync-status-icon" title="Guardado en la base">${icon('check', 13)}</span>`;
  }
  return `<span class="sync-status-icon is-spinning" title="Enviando a la base…">${icon('refresh', 13)}</span>`;
}

function recordCardHTML(c, flashId) {
  const desc = c.description || GENERIC_DESCRIPTION;
  const reasonLabel = conditionLabel(c.condition) || 'Sin motivo';
  const colorClass = motivoColorClass(c);

  let secondaryBadge = '';
  if (c.condition === 'unidades' && c.expiryDate) {
    secondaryBadge = `<span class="record-fecha-badge">Vto ${escapeHtml(c.expiryDate)}</span>`;
  } else if (c.condition === 'rotura' && c.roturaResponsible) {
    secondaryBadge = `<span class="record-resp-badge resp-${c.roturaResponsible}">${c.roturaResponsible === 'rappi' ? 'Rappi' : 'IDL'}</span>`;
  } else if (c.condition === 'vencido') {
    secondaryBadge = `<span class="record-resp-badge cond-vencido">IDL</span>`;
  } else if (c.condition === 'otro' && c.customReason) {
    secondaryBadge = `<span class="record-comment-badge" title="${escapeHtml(c.customReason)}"><span class="record-comment-text">${escapeHtml(c.customReason)}</span></span>`;
  }

  return `
    <button class="record-card ${colorClass} ${c.clientId === flashId ? 'is-touched' : ''}" data-code-id="${c.clientId}">
      <div class="record-qty ${colorClass} ${qtySizeClass(c.quantity)}">
        <span class="record-qty-num">${c.quantity}</span>
        <span class="record-qty-label">unidades</span>
      </div>
      <div class="record-info">
        <span class="record-desc ${descSizeClass(desc)}">${escapeHtml(desc)}</span>
        <span class="record-code-line">${escapeHtml(c.code)}</span>
        <div class="record-badges">
          ${syncIconHTML(c.syncStatus)}
          <span class="record-reason-inline ${colorClass}">${reasonLabel}</span>
          ${secondaryBadge}
        </div>
      </div>
      <div class="record-edit-hint" title="Tocar para modificar">${icon('moreVertical', 14)}</div>
    </button>
  `;
}

// Confirmación antes de borrar un registro (#regDelete) — misma pareja
// de clases .modal-overlay/.modal.compact-modal que usa list-view.js
// para "Eliminar mapeo", pero sin formulario: acá no hay campos, solo
// confirmar o cancelar.
function confirmDeleteModal(onConfirm, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  // .modal-overlay es z-index:50 — menos que .reg-sheet-backdrop (70),
  // que es justo lo que hay abierto detrás cuando se llama a esto (la
  // ficha de "Editar registro"). Sin esto, el modal quedaba invisible
  // y sin poder tocarse detrás de la ficha.
  overlay.style.zIndex = '80';
  overlay.innerHTML = `
    <div class="modal compact-modal">
      <div class="modal-head">
        <h3>Eliminar registro</h3>
        <button class="btn-icon" data-close>${icon('x', 18)}</button>
      </div>
      <div class="modal-body">
        <p>¿Estás seguro? Esta acción no se puede deshacer.</p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="button" class="btn btn-danger" id="confirmDeleteBtn">Eliminar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // onClose corre SIEMPRE que el modal se cierra, cancelado o
  // confirmado — el llamador lo usa para soltar su propia referencia
  // (activeConfirmModal) sin duplicar esa lógica en cada camino.
  const close = () => { overlay.remove(); onClose?.(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
  overlay.querySelector('#confirmDeleteBtn').addEventListener('click', () => {
    close();
    onConfirm();
  });
  return { overlay, close };
}

// Un doble tap en "abrir mapeo" (o en "Crear mapeo") antes de que la
// primera llamada termine de resolver store.get()/create() disparaba
// DOS sesiones de editor en paralelo — cada una con su propia cámara
// y su propio `registering`/`activeSheetBackdrop` (esos sí ya estaban
// protegidos contra reentrancia, pero cada sesión es independiente
// entre sí). Resultado real reportado: escanear un producto abría 2+
// hojas de "Producto encontrado" encimadas, cada una de una sesión
// distinta agregando el código por su cuenta. Este guard es a nivel
// módulo porque el problema es ENTRE sesiones, no dentro de una sola.
let editorOpen = false;

export async function openEditor({ mapeoId, title, onClose }) {
  if (editorOpen) return;
  editorOpen = true;
  const isNew = !mapeoId;
  const mapeo = isNew ? await store.create(actor(), title) : await store.get(mapeoId);
  if (!mapeo) {
    editorOpen = false;
    return onClose();
  }

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-back" id="editorClose" title="Volver">${icon('arrowLeft', 20)}</button>
      <div class="scan-title" id="editorTitle">${escapeHtml(mapeo.title)}</div>
      <div class="scan-header-actions">
        <button class="btn-icon scan-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 20)}</button>
      </div>
    </div>
    <div class="scan-camera" id="scanCamera" title="Tocar para apagar/prender la cámara">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-line"></div>
      <p class="scan-hint" id="scanHint" hidden></p>
      <div class="scan-camera-gradient"></div>
    </div>
    <div class="scan-sheet">
      <div class="scan-sheet-head">
        <span id="scanSheetHead">Sin códigos todavía</span>
        <div class="scan-sheet-tools">
          <div class="sheet-tool-wrap">
            <button type="button" class="btn-icon" id="filterToggle" title="Filtrar por motivo">${icon('filter', 15)}</button>
            <div class="mapeo-menu filter-menu" id="filterMenu" hidden>
              <button type="button" class="user-menu-item" data-filter="">Todos</button>
              ${CONDITIONS.map((c) => `<button type="button" class="user-menu-item" data-filter="${c.value}">${c.label}</button>`).join('')}
            </div>
          </div>
          <button type="button" class="btn-icon" id="searchToggle" title="Buscar en los registros">${icon('search', 15)}</button>
          <button type="button" class="manual-toggle" id="manualToggle" title="Ingresar código manualmente">${icon('plus', 13)} Manual</button>
        </div>
      </div>
      <form class="scan-manual" id="scanSearch" hidden>
        <input type="text" id="scanSearchInput" placeholder="Buscar por código, descripción, motivo…" autocomplete="off" />
      </form>
      <form class="scan-manual" id="scanManual" hidden>
        <input type="text" inputmode="numeric" placeholder="Ingresar código manualmente" id="scanManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Agregar">${icon('plus', 18)}</button>
      </form>
      <div class="record-list" id="scanCodes"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // El primer "volver" del dispositivo cierra el editor, no la herramienta.
  history.pushState({ mapearEditor: true }, '', location.href);
  let closedByPop = false;
  window.addEventListener('popstate', onPopState);
  function onPopState() {
    closedByPop = true;
    close();
  }

  const cameraBox = overlay.querySelector('#scanCamera');
  const videoEl = overlay.querySelector('#scanVideo');
  const sheetHead = overlay.querySelector('#scanSheetHead');
  const codesEl = overlay.querySelector('#scanCodes');
  const hintEl = overlay.querySelector('#scanHint');
  const torchBtn = overlay.querySelector('#scanTorch');
  const filterToggle = overlay.querySelector('#filterToggle');
  const filterMenu = overlay.querySelector('#filterMenu');
  const searchToggle = overlay.querySelector('#searchToggle');
  const searchForm = overlay.querySelector('#scanSearch');
  const searchInput = overlay.querySelector('#scanSearchInput');
  const manualForm = overlay.querySelector('#scanManual');
  const manualToggle = overlay.querySelector('#manualToggle');

  let codes = mapeo.codes;
  let closed = false;
  let activeFilter = '';
  let searchQuery = '';
  let flashId = null;
  // Sin este guard, dos lecturas casi simultáneas del mismo código (la cámara
  // sigue detectando unos ms antes de que scanner.setPaused(true) surta efecto)
  // creaban dos registros y dos ventanas encimadas.
  let registering = false;

  // Se entera cuando un código pasa de "enviando" a "guardado"/"sin conexión"
  // en segundo plano, para redibujar solo el ícono de estado.
  const unsubscribeSync = store.subscribe(mapeo.id, (freshCodes) => {
    codes = freshCodes;
    renderCodes();
    if (activeSheetRefreshLookup) activeSheetRefreshLookup();
  });

  function visibleCodes() {
    return codes
      .filter((c) => !activeFilter || c.condition === activeFilter)
      .filter((c) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const haystack = [c.code, c.description, conditionLabel(c.condition), c.customReason, c.roturaResponsible, c.expiryDate]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice()
      .sort((a, b) => new Date(b.touchedAt) - new Date(a.touchedAt));
  }

  function renderCodes() {
    sheetHead.innerHTML = codes.length
      ? `<span class="sheet-count-badge">${codes.length}</span> Registro${codes.length === 1 ? '' : 's'}`
      : 'Sin registros todavía';
    codesEl.innerHTML = visibleCodes().map((c) => recordCardHTML(c, flashId)).join('');
    flashId = null;
  }

  function closeSearch() {
    if (searchForm.hidden) return;
    searchForm.hidden = true;
    searchToggle.classList.remove('is-active');
    searchQuery = '';
    searchInput.value = '';
    renderCodes();
  }

  // El ingreso manual siempre registra, aunque repita el último código
  // (la cámara sí debounce internamente en scanner/camera.js).
  async function registerCode(rawValue) {
    if (registering || activeSheetBackdrop) return; // reentrancia: registro/ventana en curso
    registering = true;

    // Igual que en Consultar grupo (scanner-view.js): valida contra el
    // catálogo local antes de abrir la ventana; se salta si el catálogo
    // local todavía está vacío (sin red desde el primer uso).
    if (hasData() && !existsLocal(rawValue)) {
      showToast(`Código no encontrado: ${rawValue}`, { variant: 'warn' });
      registering = false;
      return;
    }
    closeSearch();
    const updated = await store.addCode(mapeo.id, rawValue, actor());
    codes = updated.codes;
    renderCodes();
    if (navigator.vibrate) navigator.vibrate(35);
    openRegisterSheet(codes.at(-1).clientId, { isNew: true });
    // `registering` vuelve a false recién cuando cleanupSheet cierra la ventana.
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox, torchBtn, hintEl,
    onCode: (code) => registerCode(code),
  });

  // Vive en document.body (para tapar toda la pantalla); si el editor se
  // cierra mientras está abierta, hay que sacarla a mano o queda huérfana.
  let activeSheetBackdrop = null;
  let activeSheetDiscard = null;
  // Redibuja solo descripción/EAN si el sheet sigue abierto cuando el
  // servidor resuelve la búsqueda contra Referencia.
  let activeSheetRefreshLookup = null;
  // El modal de confirmar borrado (confirmDeleteModal) también vive en
  // document.body, por encima del reg-sheet — mismo motivo que arriba:
  // si el editor se cierra (volver atrás) mientras está abierto, hay
  // que cerrarlo a mano o queda huérfano, tapando la pantalla y
  // operando sobre un editor ya destruido si se llega a confirmar.
  let activeConfirmModal = null;

  function onDocClick(e) {
    if (!filterMenu.hidden && !e.target.closest('#filterToggle') && !e.target.closest('#filterMenu')) {
      filterMenu.hidden = true;
    }
  }
  document.addEventListener('click', onDocClick);

  function close() {
    if (closed) return;
    closed = true;
    editorOpen = false;
    if (activeConfirmModal) {
      activeConfirmModal.close();
      activeConfirmModal = null;
    }
    if (activeSheetBackdrop) {
      activeSheetBackdrop.remove();
      if (activeSheetDiscard) activeSheetDiscard();
    }
    unsubscribeSync();
    document.removeEventListener('click', onDocClick);
    scanner.destroy();
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
    onClose();
  }

  overlay.querySelector('#editorClose').addEventListener('click', close);

  filterToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    filterMenu.hidden = !filterMenu.hidden;
  });
  filterMenu.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      filterMenu.hidden = true;
      filterToggle.classList.toggle('is-active', !!activeFilter);
      renderCodes();
    });
  });

  // Búsqueda y manual se excluyen entre sí (no amontonarse).
  searchToggle.addEventListener('click', () => {
    if (!searchForm.hidden) {
      closeSearch();
      return;
    }
    manualForm.hidden = true;
    searchForm.hidden = false;
    searchToggle.classList.add('is-active');
    searchInput.focus();
  });
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderCodes();
  });

  manualToggle.addEventListener('click', () => {
    closeSearch();
    manualForm.hidden = !manualForm.hidden;
    if (!manualForm.hidden) overlay.querySelector('#scanManualInput').focus();
  });

  manualForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = overlay.querySelector('#scanManualInput');
    const value = input.value.trim();
    if (!value) return;
    await registerCode(value);
    input.value = '';
    manualForm.hidden = true;
  });

  codesEl.addEventListener('click', (e) => {
    const card = e.target.closest('.record-card');
    if (!card) return;
    // clientId puede ser numérico (confirmado) o un id local temporal en
    // texto (recién escaneado) — nunca forzar a Number().
    const entry = codes.find((c) => String(c.clientId) === card.dataset.codeId);
    if (entry) openRegisterSheet(entry.clientId, { isNew: false });
  });

  function openRegisterSheet(clientId, { isNew }) {
    // `entry` es solo la foto inicial para el HTML; toda escritura pasa por
    // currentEntry(), que relee el id vigente desde `codes`. El id de un
    // código recién escaneado es temporal y el motor de sync lo reemplaza
    // por el real al confirmar — si se siguiera usando `entry`, un commit()
    // posterior apuntaría a un id inexistente y la edición se perdería.
    let entry = codes.find((c) => c.clientId === clientId);
    if (!entry) return;
    function currentEntry() {
      return codes.find((c) => c.clientId === clientId) || entry;
    }

    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    // Skeleton mientras el sync no terminó de intentar el alta, en vez de
    // declarar "sin descripción" antes de tiempo.
    const pendingLookup = entry.syncStatus === 'syncing' && !entry.description;

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title">${isNew ? 'Producto encontrado' : 'Editar registro'}</span>
          <div class="reg-sheet-head-actions">
            ${!isNew ? `<button type="button" class="btn-icon" id="regDelete" title="Eliminar registro">${icon('trash', 18)}</button>` : ''}
            <button type="button" class="btn-icon" id="regClose" title="Cerrar">${icon('x', 18)}</button>
          </div>
        </div>
        <div class="cq-desc">
          <span class="cq-desc-label">Descripción</span>
          <p class="cq-desc-value">${pendingLookup ? `<span class="cq-skeleton" style="width:80%;"></span>` : escapeHtml(entry.description || GENERIC_DESCRIPTION)}</p>
        </div>
        <div class="reg-info-grid">
          <div class="reg-info-cell">
            <span class="reg-info-label">EAN</span>
            <span class="reg-info-value" data-field="ean">${pendingLookup ? `<span class="cq-skeleton" style="width:36px;"></span>` : entry.ean ? escapeHtml(entry.ean) : '-'}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Referencia</span>
            <span class="reg-info-value">${escapeHtml(entry.code)}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Grupo</span>
            <span class="reg-info-value" data-field="grupo">${pendingLookup ? `<span class="cq-skeleton" style="width:36px;"></span>` : entry.grupo && entry.grupo !== 'SIN GRUPO' ? escapeHtml(entry.grupo) : '-'}</span>
          </div>
        </div>
        <div class="condition-pills">
          ${CONDITIONS.map((cond) => `<button type="button" class="cond-pill cond-${cond.value} ${entry.condition === cond.value ? 'is-selected' : ''}" data-condition="${cond.value}">${cond.label}</button>`).join('')}
        </div>
        <div class="reg-extra" id="regExtra"></div>
        <div class="reg-sheet-footer">
          <div class="reg-stock-alerts" id="regStockAlerts"></div>
          <div class="reg-fields-grid" id="regFieldsGrid">
            <div class="reg-field-cell" id="vtoFieldCell" hidden>
              <span class="reg-field-label">Vencimiento</span>
              <div class="reg-date-group">
                <input type="text" inputmode="numeric" maxlength="2" class="reg-date-seg" id="dateDd" autocomplete="off" />
                <span class="reg-date-sep">/</span>
                <input type="text" inputmode="numeric" maxlength="2" class="reg-date-seg" id="dateMm" autocomplete="off" />
                <span class="reg-date-sep">/</span>
                <input type="text" inputmode="numeric" maxlength="2" class="reg-date-seg" id="dateAa" autocomplete="off" />
              </div>
            </div>
            <div class="reg-field-cell">
              <span class="reg-field-label">Cantidad</span>
              <input type="number" min="1" placeholder="1" id="qtyInput" class="reg-field-input" />
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-block" id="regDone" disabled>Listo</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    // La descripción llega cuando el sync confirma el alta (la búsqueda
    // contra Referencia corre en el servidor); actualiza el texto si el sheet sigue abierto.
    activeSheetRefreshLookup = () => {
      const fresh = currentEntry();
      const descEl = backdrop.querySelector('.cq-desc-value');
      if (descEl) {
        descEl.textContent = fresh.description || GENERIC_DESCRIPTION;
        descEl.classList.add('cq-fade-in');
      }
      const eanEl = backdrop.querySelector('[data-field="ean"]');
      if (eanEl) {
        eanEl.textContent = fresh.ean || '-';
        eanEl.classList.add('cq-fade-in');
      }
      const grupoEl = backdrop.querySelector('[data-field="grupo"]');
      if (grupoEl) {
        grupoEl.textContent = fresh.grupo && fresh.grupo !== 'SIN GRUPO' ? fresh.grupo : '-';
        grupoEl.classList.add('cq-fade-in');
      }
    };

    let quantity = entry.quantity;
    let condition = entry.condition;
    let roturaResponsible = entry.roturaResponsible || null;
    const extraEl = backdrop.querySelector('#regExtra');
    const qtyInput = backdrop.querySelector('#qtyInput');
    const doneBtn = backdrop.querySelector('#regDone');

    // Aviso de stock (Recupero/Diferencias), dato secundario: silencioso ante
    // error/sin conexión, y no pinta nada si el sheet ya se cerró.
    const stockAlertsEl = backdrop.querySelector('#regStockAlerts');
    apiFetch(`/api/mapeos/stock-alerts?code=${encodeURIComponent(entry.code)}`)
      .then((res) => {
        if (!backdrop.isConnected) return;
        stockAlertsEl.innerHTML = (res.alerts || []).map((a) => `
          <div class="reg-stock-alert">${iconSolid('alertTriangleSolid', 18)}<span>${formatStockQty(a.qty)} ${escapeHtml(a.unit)} en ${escapeHtml(a.ubicacion)}</span></div>
        `).join('');
      })
      .catch(() => {});

    // Rotura exige además el responsable — sin este chequeo, elegir "Rotura"
    // ya habilitaba "Listo" antes de elegir responsable (bug real: filas sin responsable).
    function updateDoneState() {
      const ready = condition === 'rotura' ? !!roturaResponsible : !!condition;
      doneBtn.disabled = !ready;
    }
    // Precarga la cantidad al editar (si no, "Listo" sin tocar el campo la
    // pisaría con 1); vacío al registrar nuevo, Enter sin escribir equivale a 1.
    qtyInput.value = isNew ? '' : entry.quantity;

    async function commit(patch) {
      const updated = await store.updateCode(mapeo.id, currentEntry().id, patch, actor());
      codes = updated.codes;
    }

    // La cantidad se confirma solo al cerrar (botón "Listo" o Enter,
    // equivalente); ver confirmAndClose.
    qtyInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!doneBtn.disabled) doneBtn.click();
    });

    // Campo de vencimiento fijo en el footer, solo se muestra/oculta según el
    // motivo (nunca se recrea, para no perder listeners). 3 inputs (DD/MM/AA)
    // que visualmente comparten un box (.reg-date-group en app.css).
    const fieldsGrid = backdrop.querySelector('#regFieldsGrid');
    const vtoFieldCell = backdrop.querySelector('#vtoFieldCell');
    const ddInput = backdrop.querySelector('#dateDd');
    const mmInput = backdrop.querySelector('#dateMm');
    const aaInput = backdrop.querySelector('#dateAa');

    function commitDate() {
      const parts = [ddInput.value, mmInput.value, aaInput.value];
      commit({ expiryDate: parts.some(Boolean) ? parts.map((p) => p || '--').join('/') : null });
    }
    // Fuera de rango borra el campo en vez de forzar al tope.
    function clampSegment(input, max) {
      input.value = input.value.replace(/\D/g, '').slice(0, 2);
      const num = Number(input.value);
      if (input.value && (num < 1 || num > max)) input.value = '';
    }
    ddInput.addEventListener('input', () => {
      clampSegment(ddInput, 31);
      commitDate();
      if (ddInput.value.length === 2) mmInput.focus();
    });
    mmInput.addEventListener('input', () => {
      clampSegment(mmInput, 12);
      commitDate();
      if (mmInput.value.length === 2) aaInput.focus();
    });
    aaInput.addEventListener('input', () => {
      aaInput.value = aaInput.value.replace(/\D/g, '').slice(0, 2);
      commitDate();
      if (aaInput.value.length === 2) qtyInput.focus();
    });
    ddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mmInput.focus(); } });
    mmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aaInput.focus(); } });
    aaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qtyInput.focus(); } });

    // Cada motivo pide datos distintos; los saltos automáticos de foco
    // solo ocurren al registrar un código nuevo, nunca al editar uno existente.
    function renderExtra() {
      vtoFieldCell.hidden = condition !== 'unidades';
      fieldsGrid.classList.toggle('has-vto', condition === 'unidades');
      if (condition === 'unidades') {
        const [dd, mm, aa] = (entry.expiryDate || '').split('/');
        ddInput.value = dd && dd !== '--' ? dd : '';
        mmInput.value = mm && mm !== '--' ? mm : '';
        aaInput.value = aa && aa !== '--' ? aa : '';
        if (isNew) ddInput.focus();
      } else if (condition === 'rotura') {
        extraEl.innerHTML = `
          <div class="rotura-options">
            <button type="button" class="rotura-pill" data-resp="idl">IDL</button>
            <button type="button" class="rotura-pill" data-resp="rappi">Rappi</button>
          </div>
        `;
        roturaResponsible = entry.roturaResponsible || lastRoturaResponsible || null;
        const pills = [...extraEl.querySelectorAll('.rotura-pill')];
        function paint() {
          pills.forEach((p) => p.classList.toggle('is-selected', p.dataset.resp === roturaResponsible));
        }
        pills.forEach((btn) => {
          btn.addEventListener('click', () => {
            roturaResponsible = btn.dataset.resp;
            lastRoturaResponsible = roturaResponsible;
            paint();
            commit({ roturaResponsible });
            updateDoneState();
            if (isNew) qtyInput.focus();
          });
        });
        if (roturaResponsible) {
          // Ya había/se recuerda responsable: salta directo a cantidad, solo al registrar.
          paint();
          commit({ roturaResponsible });
          if (isNew) qtyInput.focus();
        }
      } else if (condition === 'vencido') {
        // Vencido no pide nada: siempre queda atribuido a IDL.
        extraEl.innerHTML = '';
        roturaResponsible = 'idl';
        if (entry.roturaResponsible !== 'idl') commit({ roturaResponsible: 'idl' });
        if (isNew) qtyInput.focus();
      } else if (condition === 'otro') {
        extraEl.innerHTML = `
          <input type="text" id="otroInput" class="otro-input" maxlength="30" placeholder="Especificar motivo" />
        `;
        const otroInput = extraEl.querySelector('#otroInput');
        otroInput.value = entry.customReason || '';
        otroInput.addEventListener('change', () => commit({ customReason: otroInput.value.trim() }));
        otroInput.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit({ customReason: otroInput.value.trim() });
          qtyInput.focus();
        });
        if (isNew) otroInput.focus();
      } else {
        extraEl.innerHTML = '';
      }
      updateDoneState();
    }

    backdrop.querySelectorAll('.cond-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        condition = pill.dataset.condition;
        backdrop.querySelectorAll('.cond-pill').forEach((p) => p.classList.toggle('is-selected', p.dataset.condition === condition));
        commit({ condition });
        renderExtra();
      });
    });
    renderExtra();

    // Registrado acá para que close() del editor pueda sacar esta ventana
    // del DOM y descartar el registro pendiente si se cierra mientras está abierta.
    activeSheetBackdrop = backdrop;
    activeSheetDiscard = isNew ? discardEntry : null;

    function cleanupSheet() {
      backdrop.remove();
      scanner.setPaused(false);
      scanner.resumeView();
      activeSheetBackdrop = null;
      activeSheetDiscard = null;
      activeSheetRefreshLookup = null;
      registering = false;
    }

    // Resalta el registro tocado al reaparecer; si se consolidó con otro
    // (ver confirmAndClose), resalta ESE en vez del propio.
    function closeSheet(highlightClientId = clientId) {
      cleanupSheet();
      flashId = highlightClientId;
      renderCodes();
    }

    // Busca otro registro del mismo mapeo con código+motivo+dato extra iguales
    // (mismo registro repetido); si existe, confirmar debe sumarse a ese.
    function findConsolidationTarget() {
      const current = currentEntry();
      if (!current.condition) return null;
      const key = extraKeyOf(current);
      return codes.find((c) => (
        c.clientId !== current.clientId && c.code === current.code && c.condition === current.condition && extraKeyOf(c) === key
      )) || null;
    }

    // Si hay un duplicado consolidable, la cantidad se suma ahí y este
    // registro se descarta; subir el consolidado al tope es efecto de
    // updateCode() tocando touchedAt (visibleCodes() ordena por eso).
    async function confirmAndClose() {
      quantity = Math.max(1, Number(qtyInput.value) || 1);
      qtyInput.value = quantity;

      const target = findConsolidationTarget();
      if (target) {
        const updated1 = await store.updateCode(mapeo.id, target.id, { quantity: target.quantity + quantity }, actor());
        codes = updated1.codes;
        const updated2 = await store.removeCode(mapeo.id, currentEntry().id, actor());
        codes = updated2.codes;
        closeSheet(target.clientId);
      } else {
        await commit({ quantity });
        closeSheet();
      }
    }

    async function discardEntry() {
      const updated = await store.removeCode(mapeo.id, currentEntry().id, actor());
      codes = updated.codes;
      renderCodes();
    }

    // Nuevo: cerrar con la cruz descarta. Existente: cerrar solo revisa,
    // no borra (tacho) ni confirma cantidad (Listo).
    async function discardIfNew() {
      if (isNew) {
        await discardEntry();
        cleanupSheet();
      } else {
        closeSheet();
      }
    }
    backdrop.querySelector('#regClose').addEventListener('click', discardIfNew);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) discardIfNew();
    });
    // iOS/Safari: con el teclado numérico de #qtyInput todavía abierto,
    // el primer tap sobre un botón "position: fixed" apilado (acá:
    // .scan-overlay + .reg-sheet-backdrop) puede no disparar `click` —
    // bug conocido de WebKit al reposicionar fixed mientras el teclado
    // se anima. Sacar el foco ANTES (en pointerdown, no en click) deja
    // que el teclado empiece a cerrarse a tiempo para que el tap sí
    // registre. Inofensivo en Android/desktop (blur() sin teclado no
    // hace nada visible).
    doneBtn.addEventListener('pointerdown', () => qtyInput.blur());
    doneBtn.addEventListener('click', confirmAndClose);

    const deleteBtn = backdrop.querySelector('#regDelete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        activeConfirmModal = confirmDeleteModal(
          async () => {
            await discardEntry();
            cleanupSheet();
          },
          () => { activeConfirmModal = null; },
        );
      });
    }
  }

  renderCodes();
  scanner.start();
}
