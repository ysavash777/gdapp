/* ============================================================
   Módulo App · Mapear — editor de un mapeo (nuevo o ya existente).

   Un solo overlay a pantalla completa cumple los dos casos: crear un
   mapeo (la cámara arranca sola) o reabrir uno ya hecho para seguir
   escaneando, corregir cantidad/condición/descripción de un código, o
   borrarlo — el mapeo nunca queda "cerrado", siempre se puede volver
   a editar.

   Detección nativa vía BarcodeDetector (Chrome/Android/Edge). Donde
   no está disponible (p. ej. iOS Safari) se avisa de inmediato y el
   ingreso manual queda como única vía para agregar un código.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { formatTime, escapeHtml, CONDITIONS, conditionLabel } from './format.js';

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

function withDuplicateFlags(codes) {
  const counts = new Map();
  codes.forEach((c) => counts.set(c.code, (counts.get(c.code) || 0) + 1));
  return codes.map((c) => ({ ...c, duplicate: counts.get(c.code) > 1 }));
}

function codeRowHTML(c) {
  return `
    <li class="scan-code ${c.duplicate ? 'is-duplicate' : ''}" data-code-id="${c.id}">
      <span class="sc-icon">${icon('check', 14)}</span>
      <span class="sc-code">${escapeHtml(c.code)}</span>
      ${c.quantity > 1 ? `<span class="sc-qty">×${c.quantity}</span>` : ''}
      ${c.condition ? `<span class="sc-flag sc-flag-cond">${conditionLabel(c.condition)}</span>` : ''}
      ${c.duplicate ? '<span class="sc-flag sc-flag-dup">Repetido</span>' : ''}
      <span class="sc-time">${formatTime(c.scannedAt)}</span>
    </li>
  `;
}

export async function openEditor({ mapeoId, onClose }) {
  const isNew = !mapeoId;
  const mapeo = isNew ? await store.create() : await store.get(mapeoId);
  if (!mapeo) return onClose();

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-close" id="editorClose" title="Cerrar">${icon('x', 20)}</button>
      <div class="scan-title" id="editorTitle">${escapeHtml(mapeo.title)}</div>
      <div class="scan-header-actions">
        <button class="btn-icon scan-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 20)}</button>
        <button class="btn-icon scan-toggle" id="scanToggle" title="Escanear">${icon('camera', 20)}</button>
      </div>
    </div>
    <div class="scan-camera" id="scanCamera" hidden>
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-reticle"></div>
      <p class="scan-hint" id="scanHint">Apuntá al código de barras</p>
    </div>
    <div class="scan-sheet">
      <div class="scan-sheet-head" id="scanSheetHead">Sin códigos todavía</div>
      <ul class="scan-codes" id="scanCodes"></ul>
      <form class="scan-manual" id="scanManual">
        <input type="text" inputmode="numeric" placeholder="Ingresar código manualmente" id="scanManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Agregar">${icon('plus', 18)}</button>
      </form>
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
  const toggleBtn = overlay.querySelector('#scanToggle');

  let codes = mapeo.codes;
  let stream = null;
  let track = null;
  let torchOn = false;
  let detector = null;
  let detectTimer = null;
  let lastCode = null;
  let lastAt = 0;
  let cameraOn = false;
  let closed = false;

  function renderCodes() {
    sheetHead.textContent = codes.length
      ? `${codes.length} código${codes.length === 1 ? '' : 's'} registrado${codes.length === 1 ? '' : 's'}`
      : 'Sin códigos todavía';
    codesEl.innerHTML = withDuplicateFlags(codes).slice().reverse().map(codeRowHTML).join('');
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
    const updated = await store.addCode(mapeo.id, rawValue);
    codes = updated.codes;
    renderCodes();
    if (navigator.vibrate) navigator.vibrate(35);
  }

  async function startCamera() {
    cameraBox.hidden = false;
    cameraOn = true;
    toggleBtn.classList.add('is-active');
    toggleBtn.title = 'Detener cámara';
    hintEl.textContent = 'Apuntá al código de barras';

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      hintEl.textContent = 'No se pudo acceder a la cámara. Usá el ingreso manual.';
      return;
    }
    if (closed || !cameraOn) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

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
      hintEl.textContent = 'Este dispositivo no soporta lectura automática. Usá el ingreso manual.';
      return;
    }

    detectTimer = setInterval(async () => {
      if (closed || !cameraOn || videoEl.readyState < 2) return;
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
    torchBtn.hidden = true;
    cameraBox.hidden = true;
    toggleBtn.classList.remove('is-active');
    toggleBtn.title = 'Escanear';
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

  toggleBtn.addEventListener('click', () => {
    if (cameraOn) stopCamera();
    else startCamera();
  });

  torchBtn.addEventListener('click', async () => {
    if (!track) return;
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      torchBtn.classList.toggle('is-active', torchOn);
    } catch {
      torchOn = !torchOn; // el navegador anunció soporte pero no lo aplicó
    }
  });

  overlay.querySelector('#scanManual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = overlay.querySelector('#scanManualInput');
    const value = input.value.trim();
    if (!value) return;
    await registerCode(value);
    input.value = '';
    input.focus();
  });

  // Tocar un código abre su edición (cantidad/condición/descripción) o
  // permite borrarlo — así el contenido de un mapeo se puede corregir
  // todas las veces que haga falta, no solo en el momento del escaneo.
  codesEl.addEventListener('click', (e) => {
    const row = e.target.closest('.scan-code');
    if (row) openCodeEditor(Number(row.dataset.codeId));
  });

  async function openCodeEditor(codeId) {
    const entry = codes.find((c) => c.id === codeId);
    if (!entry) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h3>${escapeHtml(entry.code)}</h3>
          <button class="btn-icon" data-close>${icon('x', 18)}</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Cantidad</label>
            <div class="qty-stepper">
              <button type="button" class="btn-icon" data-qty="-1">−</button>
              <input type="number" min="1" value="${entry.quantity}" id="qtyInput" />
              <button type="button" class="btn-icon" data-qty="1">+</button>
            </div>
          </div>
          <div class="field">
            <label>Condición</label>
            <div class="condition-pills" id="condPills">
              ${CONDITIONS.map((cond) => `<button type="button" class="cond-pill ${entry.condition === cond.value ? 'is-selected' : ''}" data-condition="${cond.value}">${cond.label}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label>Descripción</label>
            <input type="text" id="descInput" placeholder="Ej: Coca Cola Zero 1,75 - Generic Brand" value="${escapeHtml(entry.description || '')}" />
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-danger" id="removeCodeBtn">${icon('trash', 16)} Eliminar</button>
          <button type="button" class="btn btn-primary" id="saveCodeBtn">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    modal.querySelector('[data-close]').addEventListener('click', closeModal);

    let quantity = entry.quantity;
    let condition = entry.condition;
    const qtyInput = modal.querySelector('#qtyInput');

    modal.querySelectorAll('[data-qty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        quantity = Math.max(1, quantity + Number(btn.dataset.qty));
        qtyInput.value = quantity;
      });
    });
    qtyInput.addEventListener('change', () => {
      quantity = Math.max(1, Number(qtyInput.value) || 1);
      qtyInput.value = quantity;
    });
    modal.querySelectorAll('.cond-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        condition = condition === pill.dataset.condition ? null : pill.dataset.condition;
        modal.querySelectorAll('.cond-pill').forEach((p) => p.classList.toggle('is-selected', p.dataset.condition === condition));
      });
    });

    modal.querySelector('#saveCodeBtn').addEventListener('click', async () => {
      const description = modal.querySelector('#descInput').value.trim();
      const updated = await store.updateCode(mapeo.id, entry.id, { quantity, condition, description });
      codes = updated.codes;
      renderCodes();
      closeModal();
    });

    modal.querySelector('#removeCodeBtn').addEventListener('click', async () => {
      const updated = await store.removeCode(mapeo.id, entry.id);
      codes = updated.codes;
      renderCodes();
      closeModal();
    });
  }

  renderCodes();
  if (isNew) startCamera();
}
