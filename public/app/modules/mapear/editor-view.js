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

   Detección nativa vía BarcodeDetector (Chrome/Android/Edge). Donde
   no está disponible (p. ej. iOS Safari) se avisa de inmediato y el
   ingreso manual queda como única vía para agregar un código.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { escapeHtml, CONDITIONS, conditionLabel } from './format.js';
import { currentUser } from '/shared/js/session.js';

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
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

// Rotura y Vencido se colorean por responsable (IDL/Rappi), no por
// motivo — Unidades y Otro siguen su propio color de motivo.
function motivoColorClass(c) {
  if (c.condition === 'rotura' || c.condition === 'vencido') {
    return c.roturaResponsible ? `resp-${c.roturaResponsible}` : 'is-empty';
  }
  return c.condition ? `cond-${c.condition}` : 'is-empty';
}

function recordCardHTML(c, flashId) {
  const desc = c.description || GENERIC_DESCRIPTION;
  const reasonLabel = conditionLabel(c.condition) || 'Sin motivo';
  const colorClass = motivoColorClass(c);

  let secondaryBadge = '';
  if (c.condition === 'unidades' && c.expiryDate) {
    secondaryBadge = `<span class="record-fecha-badge">Vto ${escapeHtml(c.expiryDate)}</span>`;
  } else if ((c.condition === 'rotura' || c.condition === 'vencido') && c.roturaResponsible) {
    secondaryBadge = `<span class="record-resp-badge resp-${c.roturaResponsible}">${c.roturaResponsible === 'rappi' ? 'Rappi' : 'IDL'}</span>`;
  } else if (c.condition === 'otro' && c.customReason) {
    secondaryBadge = `<span class="record-comment-badge">${escapeHtml(c.customReason)}</span>`;
  }

  return `
    <button class="record-card ${c.id === flashId ? 'is-touched' : ''}" data-code-id="${c.id}">
      <div class="record-qty ${colorClass} ${qtySizeClass(c.quantity)}">
        <span class="record-qty-num">${c.quantity}</span>
        <span class="record-qty-label">unidades</span>
      </div>
      <div class="record-info">
        <span class="record-desc ${descSizeClass(desc)}">${escapeHtml(desc)}</span>
        <span class="record-code-line">${escapeHtml(c.code)}</span>
        <div class="record-badges">
          <span class="record-reason-inline ${colorClass}">${reasonLabel}</span>
          ${secondaryBadge}
        </div>
      </div>
      <div class="record-edit-hint" title="Tocar para modificar">${icon('moreVertical', 14)}</div>
    </button>
  `;
}

export async function openEditor({ mapeoId, onClose }) {
  const isNew = !mapeoId;
  const mapeo = isNew ? await store.create(actor()) : await store.get(mapeoId);
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
  let stream = null;
  let track = null;
  let torchOn = false;
  let cameraOn = false;
  let detector = null;
  let detectTimer = null;
  let lastCode = null;
  let lastAt = 0;
  let detectionPaused = false;
  let closed = false;
  let activeFilter = '';
  let searchQuery = '';
  let flashId = null;

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
      .sort((a, b) => b.touchedAt - a.touchedAt);
  }

  function renderCodes() {
    sheetHead.textContent = codes.length
      ? `${codes.length} Registro${codes.length === 1 ? '' : 's'}`
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

  // El debounce por "mismo código" es solo para la cámara: mientras un
  // código sigue en cuadro, el loop de detección lo vuelve a leer cada
  // ciclo y no hay que reingresarlo. El ingreso manual es una acción
  // deliberada del usuario — siempre se registra, aunque sea el mismo
  // código que el último.
  async function registerCode(rawValue, { debounce = false } = {}) {
    const now = Date.now();
    if (debounce && rawValue === lastCode && now - lastAt < SAME_CODE_DEBOUNCE_MS) return;
    lastCode = rawValue;
    lastAt = now;
    // Si quedó una búsqueda abierta, no debe tapar ni confundirse con
    // la ventana de registro que está por abrirse.
    closeSearch();
    const updated = await store.addCode(mapeo.id, rawValue, actor());
    codes = updated.codes;
    renderCodes();
    if (navigator.vibrate) navigator.vibrate(35);
    openRegisterSheet(codes.find((c) => c.id === updated.codes.at(-1).id), { isNew: true });
  }

  function showHint(text) {
    hintEl.textContent = text;
    hintEl.hidden = false;
  }

  async function startCamera() {
    hintEl.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      showHint('No se pudo acceder a la cámara. Usá el ingreso manual.');
      return;
    }
    if (closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    cameraOn = true;

    videoEl.srcObject = stream;
    track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    torchBtn.hidden = !caps.torch;

    if ('BarcodeDetector' in window) {
      try {
        detector = new window.BarcodeDetector({ formats: FORMATS });
      } catch {
        detector = null;
      }
    }
    if (!detector) {
      showHint('Este dispositivo no soporta lectura automática. Usá el ingreso manual.');
      return;
    }

    detectTimer = setInterval(async () => {
      if (closed || detectionPaused || videoEl.readyState < 2) return;
      try {
        const detected = await detector.detect(videoEl);
        if (detected.length) await registerCode(detected[0].rawValue, { debounce: true });
      } catch {
        /* frame no decodificable, se reintenta en el próximo ciclo */
      }
    }, DETECT_INTERVAL_MS);
  }

  function stopCamera() {
    cameraOn = false;
    clearInterval(detectTimer);
    detectTimer = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    track = null;
  }

  // Tocar el recuadro de la cámara la apaga/prende por completo — un
  // escape a mano para resolver bugs de cámara sin reiniciar la app,
  // sin exponer un botón dedicado para algo que no se usa seguido.
  cameraBox.addEventListener('click', () => {
    if (cameraOn) {
      stopCamera();
      showHint('Cámara apagada. Tocá para reactivarla.');
    } else {
      startCamera();
    }
  });

  // Mientras la ventana de registro está abierta, la cámara se ve
  // "apagada" (video congelado, sin barra) para no distraer — sin
  // soltar el stream, así se reanuda al instante al cerrarla.
  function pauseCameraView() {
    videoEl.pause();
    cameraBox.classList.add('is-paused');
  }
  function resumeCameraView() {
    cameraBox.classList.remove('is-paused');
    if (cameraOn) videoEl.play().catch(() => {});
  }

  // La ventana flotante de registro vive fuera de `overlay` (en
  // document.body, para poder tapar toda la pantalla) — si el editor
  // se cierra mientras está abierta, hay que sacarla a mano o queda
  // huérfana en el DOM.
  let activeSheetBackdrop = null;
  let activeSheetDiscard = null;

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
    document.removeEventListener('click', onDocClick);
    stopCamera();
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
    onClose();
  }

  overlay.querySelector('#editorClose').addEventListener('click', close);

  async function setTorch(on) {
    if (!track || torchOn === on) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      torchOn = on;
      torchBtn.classList.toggle('is-active', torchOn);
    } catch {
      /* el navegador anunció soporte pero no lo aplicó */
    }
  }

  torchBtn.addEventListener('click', () => setTorch(!torchOn));

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
    const entry = codes.find((c) => c.id === Number(card.dataset.codeId));
    if (entry) openRegisterSheet(entry, { isNew: false });
  });

  function openRegisterSheet(entry, { isNew }) {
    detectionPaused = true;
    setTorch(false);
    pauseCameraView();

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
        <div class="reg-info-grid">
          <div class="reg-info-cell">
            <span class="reg-info-label">EAN</span>
            <span class="reg-info-value">-</span>
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
          <span class="qty-label">Cantidad</span>
          <input type="number" min="1" placeholder="1" id="qtyInput" class="qty-input-sm" />
          <button type="button" class="btn btn-primary is-compact" id="regDone" disabled>Listo</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    let quantity = entry.quantity;
    let condition = entry.condition;
    const extraEl = backdrop.querySelector('#regExtra');
    const qtyInput = backdrop.querySelector('#qtyInput');
    const doneBtn = backdrop.querySelector('#regDone');
    doneBtn.disabled = !condition;

    async function commit(patch) {
      const updated = await store.updateCode(mapeo.id, entry.id, patch, actor());
      codes = updated.codes;
    }

    function finishQuantity() {
      quantity = Math.max(1, Number(qtyInput.value) || 1);
      qtyInput.value = quantity;
      commit({ quantity });
    }
    qtyInput.addEventListener('change', finishQuantity);
    // Enter cierra el flujo completo (equivale a tocar "Listo") — es el
    // último salto de la cadena DD → MM → AA/responsable/texto → cantidad.
    qtyInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      finishQuantity();
      if (!doneBtn.disabled) doneBtn.click();
    });

    // Cada motivo pide datos distintos, renderizados debajo de los
    // botones: fecha opcional (unidades), responsable (rotura y
    // vencido) o texto libre (otro). Los saltos automáticos de foco
    // (sin que el usuario presione Enter) solo ocurren al registrar
    // un código nuevo — al editar uno existente no se mueve el foco.
    function renderExtra() {
      if (condition === 'unidades') {
        extraEl.innerHTML = `
          <div class="date-field">
            <span class="date-label">Fecha vto</span>
            <div class="date-segments">
              <input type="text" inputmode="numeric" maxlength="2" placeholder="DD" class="date-seg" id="dateDd" />
              <span class="date-sep">/</span>
              <input type="text" inputmode="numeric" maxlength="2" placeholder="MM" class="date-seg" id="dateMm" />
              <span class="date-sep">/</span>
              <input type="text" inputmode="numeric" maxlength="2" placeholder="AA" class="date-seg" id="dateAa" />
            </div>
            <button type="button" class="btn-icon date-calendar-btn" id="dateCalendarBtn" title="Elegir con calendario">${icon('calendar', 18)}</button>
            <input type="date" class="date-native" id="dateNative" hidden />
          </div>
        `;
        const [dd, mm, aa] = (entry.expiryDate || '').split('/');
        const ddInput = extraEl.querySelector('#dateDd');
        const mmInput = extraEl.querySelector('#dateMm');
        const aaInput = extraEl.querySelector('#dateAa');
        const nativeInput = extraEl.querySelector('#dateNative');
        ddInput.value = dd && dd !== '--' ? dd : '';
        mmInput.value = mm && mm !== '--' ? mm : '';
        aaInput.value = aa && aa !== '--' ? aa : '';

        function commitDate() {
          const parts = [ddInput.value, mmInput.value, aaInput.value];
          commit({ expiryDate: parts.some(Boolean) ? parts.map((p) => p || '--').join('/') : null });
        }
        // Nunca 00 ni fuera de rango: si se excede, se borra el campo
        // en vez de forzarlo al tope (no autocompletar con 1 o 31).
        function clampSegment(input, max) {
          input.value = input.value.replace(/\D/g, '').slice(0, 2);
          const num = Number(input.value);
          if (input.value && (num < 1 || num > max)) input.value = '';
        }
        ddInput.addEventListener('input', () => { clampSegment(ddInput, 31); commitDate(); });
        mmInput.addEventListener('input', () => { clampSegment(mmInput, 12); commitDate(); });
        aaInput.addEventListener('input', () => {
          aaInput.value = aaInput.value.replace(/\D/g, '').slice(0, 2);
          commitDate();
        });
        ddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mmInput.focus(); } });
        mmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aaInput.focus(); } });
        aaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qtyInput.focus(); } });

        extraEl.querySelector('#dateCalendarBtn').addEventListener('click', () => {
          if (nativeInput.showPicker) nativeInput.showPicker();
          else nativeInput.click();
        });
        nativeInput.addEventListener('change', () => {
          const [yyyy, mo, da] = nativeInput.value.split('-');
          if (!yyyy) return;
          ddInput.value = da;
          mmInput.value = mo;
          aaInput.value = yyyy.slice(2);
          commitDate();
        });

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
          <input type="text" id="otroInput" class="otro-input" maxlength="30" placeholder="Especificar motivo (máx. 30 caracteres)" />
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
      detectionPaused = false;
      resumeCameraView();
      activeSheetBackdrop = null;
      activeSheetDiscard = null;
    }

    // El registro recién tocado (nuevo o editado) sube al tope de la
    // lista y se resalta con una animación breve al reaparecer —
    // los que no cambiaron quedan donde estaban.
    function closeSheet() {
      cleanupSheet();
      flashId = entry.id;
      renderCodes();
    }

    async function discardEntry() {
      const updated = await store.removeCode(mapeo.id, entry.id, actor());
      codes = updated.codes;
      renderCodes();
    }

    // Un código recién detectado todavía no fue confirmado: cerrar con
    // la cruz equivale a no registrarlo. Uno ya existente, en cambio,
    // solo se está revisando — cerrar no borra nada (para eso está el
    // tacho, que solo aparece en el modo de edición).
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
    backdrop.querySelector('#regDone').addEventListener('click', closeSheet);

    const deleteBtn = backdrop.querySelector('#regDelete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        await discardEntry();
        cleanupSheet();
      });
    }
  }

  renderCodes();
  startCamera();
}
