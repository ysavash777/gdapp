/* ============================================================
   Módulo App · Mapear — editor de un mapeo (nuevo o ya existente).

   Un solo overlay a pantalla completa cumple los dos casos: crear un
   mapeo o reabrir uno ya hecho para seguir escaneando, corregir
   cantidad/motivo/descripción de un código, o borrarlo — el mapeo
   nunca queda "cerrado", siempre se puede volver a editar. La cámara
   queda activa todo el tiempo que el editor está abierto (no hay
   forma de apagarla a mitad de camino).

   Apenas se detecta un código (cámara o Enter en el ingreso manual)
   se abre una ventana flotante inferior pidiendo cantidad y motivo —
   la detección de la cámara se pausa mientras esa ventana está
   abierta, para no acumular códigos mientras el usuario responde.

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

function recordCardHTML(c) {
  const desc = c.description || GENERIC_DESCRIPTION;
  const reasonLabel = conditionLabel(c.condition) || 'Sin motivo';
  const reasonClass = c.condition ? `cond-${c.condition}` : 'is-empty';
  return `
    <button class="record-card" data-code-id="${c.id}">
      <div class="record-qty ${reasonClass} ${qtySizeClass(c.quantity)}">
        <span class="record-qty-num">${c.quantity}</span>
        <span class="record-qty-label">unidades</span>
      </div>
      <div class="record-info">
        <span class="record-desc ${descSizeClass(desc)}">${escapeHtml(desc)}</span>
        <span class="record-line2">
          <span class="record-reason-inline ${reasonClass}">${reasonLabel}</span>
          <span class="record-code-text">${escapeHtml(c.code)}</span>
        </span>
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
        <button type="button" class="manual-toggle" id="manualToggle" title="Ingresar código manualmente">${icon('plus', 13)} Manual</button>
      </div>
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

  function renderCodes() {
    sheetHead.textContent = codes.length
      ? `${codes.length} Registro${codes.length === 1 ? '' : 's'}`
      : 'Sin registros todavía';
    codesEl.innerHTML = codes.slice().reverse().map(recordCardHTML).join('');
  }

  // El debounce por "mismo código" es solo para la cámara: mientras un
  // código sigue en cuadro, el loop de detección lo vuelve a leer cada
  // ciclo y no hay que reingresarlo. El ingreso manual es una acción
  // deliberada del usuario — siempre se registra, aunque sea el mismo
  // código que el último (queda marcado como repetido si corresponde).
  async function registerCode(rawValue, { debounce = false } = {}) {
    const now = Date.now();
    if (debounce && rawValue === lastCode && now - lastAt < SAME_CODE_DEBOUNCE_MS) return;
    lastCode = rawValue;
    lastAt = now;
    const updated = await store.addCode(mapeo.id, rawValue, actor());
    codes = updated.codes;
    renderCodes();
    if (navigator.vibrate) navigator.vibrate(35);
    openRegisterSheet(codes.at(-1), { isNew: true });
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

  function close() {
    if (closed) return;
    closed = true;
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

  // El ingreso manual queda oculto por defecto (se usa poco), pero a
  // un solo tap de distancia junto al contador de códigos — nunca
  // escondido del todo, porque a veces es la única vía posible.
  const manualForm = overlay.querySelector('#scanManual');
  overlay.querySelector('#manualToggle').addEventListener('click', () => {
    manualForm.hidden = !manualForm.hidden;
    if (!manualForm.hidden) overlay.querySelector('#scanManualInput').focus();
  });

  overlay.querySelector('#scanManual').addEventListener('submit', async (e) => {
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
          <button type="button" class="btn-icon" id="regClose" title="Cerrar">${icon('x', 18)}</button>
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
        <div class="reg-sheet-footer">
          <input type="number" min="1" value="${entry.quantity}" id="qtyInput" class="qty-input-sm" />
          <button type="button" class="btn btn-primary" id="regDone" disabled>Listo</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    let quantity = entry.quantity;
    let condition = entry.condition;
    const qtyInput = backdrop.querySelector('#qtyInput');
    const doneBtn = backdrop.querySelector('#regDone');
    doneBtn.disabled = !condition;

    async function commit(patch) {
      const updated = await store.updateCode(mapeo.id, entry.id, patch, actor());
      codes = updated.codes;
      renderCodes();
    }

    qtyInput.addEventListener('change', () => {
      quantity = Math.max(1, Number(qtyInput.value) || 1);
      qtyInput.value = quantity;
      commit({ quantity });
    });
    // No se permite registrar sin motivo: el botón de confirmar queda
    // deshabilitado hasta que se elija uno, y una vez elegido solo se
    // puede cambiar por otro (no volver a "sin motivo").
    backdrop.querySelectorAll('.cond-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        condition = pill.dataset.condition;
        backdrop.querySelectorAll('.cond-pill').forEach((p) => p.classList.toggle('is-selected', p.dataset.condition === condition));
        doneBtn.disabled = false;
        commit({ condition });
      });
    });

    function closeSheet() {
      backdrop.remove();
      detectionPaused = false;
      resumeCameraView();
    }

    // Un código recién detectado todavía no fue confirmado: cerrar con
    // la cruz equivale a no registrarlo. Uno ya existente, en cambio,
    // solo se está revisando — cerrar no borra nada.
    async function discardIfNew() {
      if (isNew) {
        const updated = await store.removeCode(mapeo.id, entry.id, actor());
        codes = updated.codes;
        renderCodes();
      }
      closeSheet();
    }
    backdrop.querySelector('#regClose').addEventListener('click', discardIfNew);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) discardIfNew();
    });
    backdrop.querySelector('#regDone').addEventListener('click', closeSheet);
  }

  renderCodes();
  startCamera();
}
