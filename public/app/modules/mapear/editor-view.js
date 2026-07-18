/* ============================================================
   Módulo App · Mapear — editor de un mapeo (nuevo o ya existente).

   Un solo overlay a pantalla completa cumple los dos casos: crear un
   mapeo o reabrir uno ya hecho para seguir escaneando, corregir
   cantidad/motivo/descripción de un código, o borrarlo — el mapeo
   nunca queda "cerrado", siempre se puede volver a editar. La cámara
   queda activa todo el tiempo que el editor está abierto (no hay
   forma de apagarla a mitad de camino salvo el gesto de emergencia
   sobre el propio recuadro de la cámara).

   Apenas se detecta un código (cámara o Enter en el ingreso manual)
   se abre una ventana flotante inferior pidiendo motivo y sus datos
   propios — la detección de la cámara se pausa y se ve "apagada"
   mientras esa ventana está abierta, para no acumular códigos ni
   distraer mientras el usuario responde. Los saltos automáticos a
   cantidad (Vencido, responsable ya recordado en rotura) solo pasan
   al registrar un código nuevo — al reabrir uno existente para
   editarlo, nunca se mueve el foco solo.

   La cámara y la lectura del código (dos motores intercambiables:
   BarcodeDetector nativo en Android/Chrome, o ZXing por software en
   iOS Safari) corren sobre scanner/camera.js, compartido con
   Consultar grupo — este archivo no sabe cuál motor está activo, ni
   maneja el stream: solo escucha los códigos que le llegan por
   onCode.

   store.js ya guarda cada alta/edición/baja localmente y la manda a
   la base en segundo plano (ver store.js/sync-engine.js) — por eso
   addCode/updateCode/removeCode de acá nunca esperan la red: el
   `codes = updated.codes` de cada uno ya refleja el estado optimista
   local. store.subscribe() avisa cuando ese estado cambia por un
   evento de sincronización (confirmado, sin conexión) para redibujar
   solo el ícono de cada tarjeta, sin tocar nada más.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { escapeHtml, CONDITIONS, conditionLabel } from './format.js';
import { currentUser } from '/shared/js/session.js';
import { createCameraScanner } from '../../scanner/camera.js';

const GENERIC_DESCRIPTION = 'Producto sin descripción';

// Se recuerda entre registros (no entre sesiones) quién fue el último
// responsable de rotura marcado, para preseleccionarlo y agilizar el
// alta de la próxima rotura — ver motivo "rotura" en openRegisterSheet.
let lastRoturaResponsible = null;

function actor() {
  return currentUser()?.username || null;
}

// La caja de "Unidades" tiene ancho fijo (ver .record-qty en app.css):
// de 1 a 5 cifras entran siempre achicando la fuente, nunca el ancho.
function qtySizeClass(quantity) {
  const len = String(quantity).length;
  if (len <= 2) return '';
  if (len === 3) return 'is-md';
  if (len === 4) return 'is-sm';
  return 'is-xs';
}

// La descripción tiene una franja de alto fijo para 2 líneas (ver
// .record-desc): si el texto es largo, se achica la fuente para que
// esas 2 líneas le entren completo en vez de cortarlo.
function descSizeClass(text) {
  if (text.length <= 46) return '';
  if (text.length <= 80) return 'is-md';
  return 'is-sm';
}

// Rotura se colorea por responsable (IDL/Rappi) porque puede ser
// cualquiera de los dos. Vencido siempre es IDL, así que no tiene
// sentido colorearlo por responsable — queda con su propio color de
// motivo (lila), igual que Unidades y Otro.
function motivoColorClass(c) {
  if (c.condition === 'rotura') {
    return c.roturaResponsible ? `resp-${c.roturaResponsible}` : 'is-empty';
  }
  return c.condition ? `cond-${c.condition}` : 'is-empty';
}

// Círculo girando = todavía local, camino a la base; tilde = ya
// confirmado; reloj = sin conexión, esperando para reintentar (ver
// store.js). Siempre en gris — es información de respaldo del
// registro, no un dato propio del producto.
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

export async function openEditor({ mapeoId, title, onClose }) {
  const isNew = !mapeoId;
  const mapeo = isNew ? await store.create(actor(), title) : await store.get(mapeoId);
  if (!mapeo) return onClose();

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

  // El primer "volver" del dispositivo cierra el editor (vuelve al
  // listado), no sale de la herramienta — misma guarda de historial
  // que el resto de los overlays de esta app.
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

  // Un código puede pasar de "enviando" a "guardado" (o "sin
  // conexión") mucho después de que se lo agregó, en segundo plano —
  // esta suscripción es lo único que se entera de eso mientras el
  // editor sigue abierto, para redibujar solo el ícono de estado.
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

  // El ingreso manual es una acción deliberada del usuario — siempre
  // se registra, aunque sea el mismo código que el último (a
  // diferencia de la cámara, que debounce internamente en
  // scanner/camera.js mientras un código sigue en cuadro).
  async function registerCode(rawValue) {
    // Si quedó una búsqueda abierta, no debe tapar ni confundirse con
    // la ventana de registro que está por abrirse.
    closeSearch();
    const updated = await store.addCode(mapeo.id, rawValue, actor());
    codes = updated.codes;
    renderCodes();
    if (navigator.vibrate) navigator.vibrate(35);
    openRegisterSheet(codes.at(-1).clientId, { isNew: true });
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox, torchBtn, hintEl,
    onCode: (code) => registerCode(code),
  });

  // La ventana flotante de registro vive fuera de `overlay` (en
  // document.body, para poder tapar toda la pantalla) — si el editor
  // se cierra mientras está abierta, hay que sacarla a mano o queda
  // huérfana en el DOM.
  let activeSheetBackdrop = null;
  let activeSheetDiscard = null;
  // Si el sheet de registro está abierto cuando el motor de sync
  // termina de completar descripción y EAN (ver más abajo, la
  // búsqueda contra Referencia recién resuelve del lado del servidor,
  // no en el momento de escanear), esto redibuja solo esas dos líneas
  // sin tocar nada más del sheet.
  let activeSheetRefreshLookup = null;

  function onDocClick(e) {
    if (!filterMenu.hidden && !e.target.closest('#filterToggle') && !e.target.closest('#filterMenu')) {
      filterMenu.hidden = true;
    }
  }
  document.addEventListener('click', onDocClick);

  function close() {
    if (closed) return;
    closed = true;
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

  // Filtro por motivo: menú chico anclado al ícono, cierra al elegir
  // una opción o al tocar fuera.
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

  // Búsqueda en vivo por cualquier dato del registro. Igual que el
  // ingreso manual, queda oculta por defecto para no ensuciar la
  // pantalla — y ambas se excluyen entre sí para no amontonarse.
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

  // El ingreso manual queda oculto por defecto (se usa poco), pero a
  // un solo tap de distancia junto al contador de códigos — nunca
  // escondido del todo, porque a veces es la única vía posible.
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

  // Tocar un registro reabre la misma ventana flotante para corregir
  // su cantidad o motivo.
  codesEl.addEventListener('click', (e) => {
    const card = e.target.closest('.record-card');
    if (!card) return;
    // El id puede ser numérico (ya confirmado en la base) o un id
    // local temporal en forma de texto (recién escaneado, todavía sin
    // enviar) — nunca forzar a Number(), un id local nunca lo es.
    const entry = codes.find((c) => String(c.clientId) === card.dataset.codeId);
    if (entry) openRegisterSheet(entry.clientId, { isNew: false });
  });

  function openRegisterSheet(clientId, { isNew }) {
    // `entry` es solo la foto inicial para armar el HTML del sheet —
    // toda escritura de acá en más pasa por currentEntry(), que
    // siempre relee el id real y vigente desde `codes`. El id de un
    // código recién escaneado empieza siendo temporal y el motor de
    // sincronización lo reemplaza por el real apenas confirma el alta
    // (puede pasar en menos de un segundo con buena conexión) — si
    // esta función siguiera usando el `entry` de este momento, un
    // commit() posterior apuntaría a un id que ya no existe y la
    // edición se perdería en silencio.
    let entry = codes.find((c) => c.clientId === clientId);
    if (!entry) return;
    function currentEntry() {
      return codes.find((c) => c.clientId === clientId) || entry;
    }

    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

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
          <p class="cq-desc-value">${escapeHtml(entry.description || GENERIC_DESCRIPTION)}</p>
        </div>
        <div class="reg-info-grid">
          <div class="reg-info-cell">
            <span class="reg-info-label">EAN</span>
            <span class="reg-info-value" data-field="ean">${entry.ean ? escapeHtml(entry.ean) : '-'}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Referencia</span>
            <span class="reg-info-value">${escapeHtml(entry.code)}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Grupo</span>
            <span class="reg-info-value">-</span>
          </div>
        </div>
        <div class="condition-pills">
          ${CONDITIONS.map((cond) => `<button type="button" class="cond-pill cond-${cond.value} ${entry.condition === cond.value ? 'is-selected' : ''}" data-condition="${cond.value}">${cond.label}</button>`).join('')}
        </div>
        <div class="reg-extra" id="regExtra"></div>
        <div class="reg-sheet-footer">
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

    // La descripción llega recién cuando el motor de sync confirma el
    // alta (la búsqueda contra Referencia corre del lado del
    // servidor, no en el momento de escanear) — si para entonces este
    // sheet sigue abierto, hay que actualizar el texto ya puesto en
    // vez de dejarlo en "Producto sin descripción" para siempre.
    activeSheetRefreshLookup = () => {
      const fresh = currentEntry();
      const descEl = backdrop.querySelector('.cq-desc-value');
      if (descEl) descEl.textContent = fresh.description || GENERIC_DESCRIPTION;
      const eanEl = backdrop.querySelector('[data-field="ean"]');
      if (eanEl) eanEl.textContent = fresh.ean || '-';
    };

    let quantity = entry.quantity;
    let condition = entry.condition;
    const extraEl = backdrop.querySelector('#regExtra');
    const qtyInput = backdrop.querySelector('#qtyInput');
    const doneBtn = backdrop.querySelector('#regDone');
    doneBtn.disabled = !condition;
    // Al editar un registro existente se precarga la cantidad que ya
    // tenía (si no, "Listo" sin tocar el campo la pisaría con 1). Al
    // registrar uno nuevo queda vacío a propósito: Enter sin escribir
    // nada equivale a 1.
    qtyInput.value = isNew ? '' : entry.quantity;

    async function commit(patch) {
      const updated = await store.updateCode(mapeo.id, currentEntry().id, patch, actor());
      codes = updated.codes;
    }

    // La cantidad se confirma recién al cerrar el flujo (botón "Listo"
    // o Enter, que equivale a tocarlo) — nunca antes, así los dos
    // caminos quedan idénticos y ninguno pisa lo que se escribió.
    async function finishQuantity() {
      quantity = Math.max(1, Number(qtyInput.value) || 1);
      qtyInput.value = quantity;
      await commit({ quantity });
    }
    qtyInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!doneBtn.disabled) doneBtn.click();
    });

    // El campo de vencimiento vive fijo en el footer (junto a Cantidad,
    // no dentro de #regExtra) — solo se muestra/oculta y se completa
    // según el motivo, nunca se recrea, así no pierde los listeners.
    // Son 3 inputs reales (DD, MM, AA) separados por "/", cada uno con
    // su propio foco — visualmente comparten un mismo box negro (ver
    // .reg-date-group en app.css) para verse como un campo continuo.
    const fieldsGrid = backdrop.querySelector('#regFieldsGrid');
    const vtoFieldCell = backdrop.querySelector('#vtoFieldCell');
    const ddInput = backdrop.querySelector('#dateDd');
    const mmInput = backdrop.querySelector('#dateMm');
    const aaInput = backdrop.querySelector('#dateAa');

    function commitDate() {
      const parts = [ddInput.value, mmInput.value, aaInput.value];
      commit({ expiryDate: parts.some(Boolean) ? parts.map((p) => p || '--').join('/') : null });
    }
    // Nunca 00 ni fuera de rango: si se excede, se borra el campo en
    // vez de forzarlo al tope (no autocompletar con 1 o 31).
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

    // Cada motivo pide datos distintos: fecha opcional (unidades, en
    // el footer junto a Cantidad), responsable (rotura y vencido) o
    // texto libre (otro) debajo de los botones. Los saltos automáticos
    // de foco (sin que el usuario presione Enter) solo ocurren al
    // registrar un código nuevo — al editar uno existente no se mueve
    // el foco.
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
        let responsible = entry.roturaResponsible || lastRoturaResponsible || null;
        const pills = [...extraEl.querySelectorAll('.rotura-pill')];
        function paint() {
          pills.forEach((p) => p.classList.toggle('is-selected', p.dataset.resp === responsible));
        }
        pills.forEach((btn) => {
          btn.addEventListener('click', () => {
            responsible = btn.dataset.resp;
            lastRoturaResponsible = responsible;
            paint();
            commit({ roturaResponsible: responsible });
            if (isNew) qtyInput.focus();
          });
        });
        if (responsible) {
          // Ya había (o se recuerda) un responsable: no hace falta
          // esperar el toque, se agiliza yendo directo a cantidad —
          // pero solo al registrar, nunca al editar uno existente.
          paint();
          commit({ roturaResponsible: responsible });
          if (isNew) qtyInput.focus();
        }
      } else if (condition === 'vencido') {
        // Vencido no pide nada: siempre queda atribuido a IDL.
        extraEl.innerHTML = '';
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
    }

    // No se permite registrar sin motivo: el botón de confirmar queda
    // deshabilitado hasta que se elija uno, y una vez elegido solo se
    // puede cambiar por otro (no volver a "sin motivo").
    backdrop.querySelectorAll('.cond-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        condition = pill.dataset.condition;
        backdrop.querySelectorAll('.cond-pill').forEach((p) => p.classList.toggle('is-selected', p.dataset.condition === condition));
        doneBtn.disabled = false;
        commit({ condition });
        renderExtra();
      });
    });
    renderExtra();

    // El editor completo puede cerrarse (botón/gesto de volver)
    // mientras esta ventana sigue abierta — se registra acá para que
    // `close()` pueda sacarla del DOM y descartar el registro
    // pendiente sin quedar huérfana.
    activeSheetBackdrop = backdrop;
    activeSheetDiscard = isNew ? discardEntry : null;

    function cleanupSheet() {
      backdrop.remove();
      scanner.setPaused(false);
      scanner.resumeView();
      activeSheetBackdrop = null;
      activeSheetDiscard = null;
      activeSheetRefreshLookup = null;
    }

    // El registro recién tocado (nuevo o editado) sube al tope de la
    // lista y se resalta con una animación breve al reaparecer —
    // los que no cambiaron quedan donde estaban.
    function closeSheet() {
      cleanupSheet();
      flashId = clientId;
      renderCodes();
    }

    // "Listo" (o Enter, que lo dispara) es el único camino que confirma
    // la cantidad escrita — cerrar con la cruz nunca la guarda.
    async function confirmAndClose() {
      await finishQuantity();
      closeSheet();
    }

    async function discardEntry() {
      const updated = await store.removeCode(mapeo.id, currentEntry().id, actor());
      codes = updated.codes;
      renderCodes();
    }

    // Un código recién detectado todavía no fue confirmado: cerrar con
    // la cruz equivale a no registrarlo. Uno ya existente, en cambio,
    // solo se está revisando — cerrar no borra nada (para eso está el
    // tacho, que solo aparece en el modo de edición) ni confirma la
    // cantidad (para eso está "Listo").
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
    backdrop.querySelector('#regDone').addEventListener('click', confirmAndClose);

    const deleteBtn = backdrop.querySelector('#regDelete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        await discardEntry();
        cleanupSheet();
      });
    }
  }

  renderCodes();
  scanner.start();
}
