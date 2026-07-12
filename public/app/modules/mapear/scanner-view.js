/* ============================================================
   Módulo App · Mapear — escáner de cámara para un mapeo nuevo.

   Detección nativa vía BarcodeDetector (Chrome/Android/Edge). Donde
   no está disponible (p. ej. iOS Safari) se avisa de inmediato y el
   ingreso manual queda como única vía — nunca se deja al usuario sin
   forma de registrar un código.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { codeItemHTML } from './format.js';

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export async function openScanner({ onClose }) {
  const mapeo = await store.create();

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-close" id="scanClose" title="Cerrar">${icon('x', 20)}</button>
      <div class="scan-count"><strong id="scanCount">0</strong> escaneados</div>
      <button class="btn-icon scan-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 20)}</button>
    </div>
    <div class="scan-camera">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-reticle"></div>
      <p class="scan-hint" id="scanHint">Apuntá al código de barras</p>
    </div>
    <div class="scan-sheet">
      <div class="scan-sheet-head">Códigos registrados</div>
      <ul class="scan-codes" id="scanCodes"></ul>
      <form class="scan-manual" id="scanManual">
        <input type="text" inputmode="numeric" placeholder="Ingresar código manualmente" id="scanManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Agregar">${icon('plus', 18)}</button>
      </form>
      <button class="btn btn-primary btn-block scan-finish" id="scanFinish">Finalizar mapeo</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // El primer "volver" del dispositivo cierra el escáner (vuelve al
  // listado), no sale de la herramienta — misma guarda de historial
  // que usa el detalle de un mapeo (ver list-view.js).
  history.pushState({ mapearScanner: true }, '', location.href);
  let closedByPop = false;
  window.addEventListener('popstate', onPopState);
  function onPopState() {
    closedByPop = true;
    close();
  }

  const videoEl = overlay.querySelector('#scanVideo');
  const countEl = overlay.querySelector('#scanCount');
  const codesEl = overlay.querySelector('#scanCodes');
  const hintEl = overlay.querySelector('#scanHint');
  const torchBtn = overlay.querySelector('#scanTorch');

  let stream = null;
  let track = null;
  let torchOn = false;
  let detector = null;
  let detectTimer = null;
  let lastCode = null;
  let lastAt = 0;
  let closed = false;

  function renderCodes(codes) {
    countEl.textContent = String(codes.length);
    codesEl.innerHTML = codes.slice().reverse().map(codeItemHTML).join('');
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
    renderCodes(updated.codes);
    if (navigator.vibrate) navigator.vibrate(updated.codes.at(-1).duplicate ? [35, 60, 35] : 35);
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      hintEl.textContent = 'No se pudo acceder a la cámara. Usá el ingreso manual.';
      return;
    }

    videoEl.srcObject = stream;
    track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) torchBtn.hidden = false;

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
      if (closed || videoEl.readyState < 2) return;
      try {
        const codes = await detector.detect(videoEl);
        if (codes.length) await registerCode(codes[0].rawValue, { debounce: true });
      } catch {
        /* frame no decodificable, se reintenta en el próximo ciclo */
      }
    }, DETECT_INTERVAL_MS);
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(detectTimer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
    onClose();
  }

  overlay.querySelector('#scanClose').addEventListener('click', close);

  overlay.querySelector('#scanFinish').addEventListener('click', async () => {
    await store.finish(mapeo.id);
    close();
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

  renderCodes(mapeo.codes);
  startCamera();
}
