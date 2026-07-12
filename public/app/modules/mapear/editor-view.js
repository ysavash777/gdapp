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

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
const GENERIC_DESCRIPTION = 'Producto sin descripción';

function withDuplicateFlags(codes) {
  const counts = new Map();
  codes.forEach((c) => counts.set(c.code, (counts.get(c.code) || 0) + 1));
  return codes.map((c) => ({ ...c, duplicate: counts.get(c.code) > 1 }));
}

function recordCardHTML(c) {
  return `
    <button class="record-card ${c.duplicate ? 'is-duplicate' : ''}" data-code-id="${c.id}">
      <div class="record-top">
        <span class="record-desc">${escapeHtml(c.description || GENERIC_DESCRIPTION)}</span>
        <span class="record-qty">×${c.quantity}</span>
      </div>
      <div class="record-bottom">
        <span class="record-code">${escapeHtml(c.code)}${c.duplicate ? ' · <span class="record-dup">Repetido</span>' : ''}</span>
        <span class="record-reason ${c.condition ? '' : 'is-empty'}">${conditionLabel(c.condition) || 'Sin motivo'}</span>
      </div>
    </button>
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
      </div>
    </div>
    <div class="scan-camera">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-reticle"></div>
      <p class="scan-hint" id="scanHint">Apuntá al código de barras</p>
    </div>
    <div class="scan-sheet">
      <form class="scan-manual" id="scanManual">
        <input type="text" inputmode="numeric" placeholder="Ingresar código manualmente" id="scanManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Agregar">${icon('plus', 18)}</button>
      </form>
      <div class="scan-sheet-head" id="scanSheetHead">Sin códigos todavía</div>
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

  const videoEl = overlay.querySelector('#scanVideo');
  const sheetHead = overlay.querySelector('#scanSheetHead');
  const codesEl = overlay.querySelector('#scanCodes');
  const hintEl = overlay.querySelector('#scanHint');
  const torchBtn = overlay.querySelector('#scanTorch');

  let codes = mapeo.codes;
  let stream = null;
  let track = null;
  let torchOn = false;
  let detector = null;
  let detectTimer = null;
  let lastCode = null;
  let lastAt = 0;
  let detectionPaused = false;
  let closed = false;

  function renderCodes() {
    sheetHead.textContent = codes.length
      ? `${codes.length} código${codes.length === 1 ? '' : 's'} registrado${codes.length === 1 ? '' : 's'}`
      : 'Sin códigos todavía';
    codesEl.innerHTML = withDuplicateFlags(codes).slice().reverse().map(recordCardHTML).join('');
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
    openRegisterSheet(codes.at(-1));
  }

  async function startCamera() {
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
    if (closed) {
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
    clearInterval(detectTimer);
    detectTimer = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    track = null;
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
  });

  // Tocar un registro reabre la misma ventana flotante para corregir
  // su cantidad, motivo o descripción, o para eliminarlo.
  codesEl.addEventListener('click', (e) => {
    const card = e.target.closest('.record-card');
    if (!card) return;
    const entry = codes.find((c) => c.id === Number(card.dataset.codeId));
    if (entry) openRegisterSheet(entry);
  });

  function openRegisterSheet(entry) {
    detectionPaused = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-code">${escapeHtml(entry.code)}</span>
          <div class="reg-sheet-head-actions">
            <button type="button" class="btn-icon" id="regDelete" title="Eliminar código">${icon('trash', 18)}</button>
            <button type="button" class="btn-icon" id="regClose" title="Cerrar">${icon('x', 18)}</button>
          </div>
        </div>
        <div class="field">
          <label>Cantidad</label>
          <div class="qty-stepper">
            <button type="button" class="btn-icon" data-qty="-1">−</button>
            <input type="number" min="1" value="${entry.quantity}" id="qtyInput" />
            <button type="button" class="btn-icon" data-qty="1">+</button>
          </div>
        </div>
        <div class="field">
          <label>Motivo</label>
          <div class="condition-pills">
            ${CONDITIONS.map((cond) => `<button type="button" class="cond-pill ${entry.condition === cond.value ? 'is-selected' : ''}" data-condition="${cond.value}">${cond.label}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label>Descripción (opcional)</label>
          <input type="text" id="descInput" placeholder="Ej: Coca Cola Zero 1,75 - Generic Brand" value="${escapeHtml(entry.description || '')}" />
        </div>
        <button type="button" class="btn btn-primary btn-block" id="regDone">Listo</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    let quantity = entry.quantity;
    let condition = entry.condition;
    const qtyInput = backdrop.querySelector('#qtyInput');

    async function commit(patch) {
      const updated = await store.updateCode(mapeo.id, entry.id, patch);
      codes = updated.codes;
      renderCodes();
    }

    backdrop.querySelectorAll('[data-qty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        quantity = Math.max(1, quantity + Number(btn.dataset.qty));
        qtyInput.value = quantity;
        commit({ quantity });
      });
    });
    qtyInput.addEventListener('change', () => {
      quantity = Math.max(1, Number(qtyInput.value) || 1);
      qtyInput.value = quantity;
      commit({ quantity });
    });
    backdrop.querySelectorAll('.cond-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        condition = condition === pill.dataset.condition ? null : pill.dataset.condition;
        backdrop.querySelectorAll('.cond-pill').forEach((p) => p.classList.toggle('is-selected', p.dataset.condition === condition));
        commit({ condition });
      });
    });
    backdrop.querySelector('#descInput').addEventListener('change', (e) => {
      commit({ description: e.target.value.trim() });
    });

    function closeSheet() {
      backdrop.remove();
      detectionPaused = false;
    }
    backdrop.querySelector('#regClose').addEventListener('click', closeSheet);
    backdrop.querySelector('#regDone').addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSheet();
    });

    backdrop.querySelector('#regDelete').addEventListener('click', async () => {
      const updated = await store.removeCode(mapeo.id, entry.id);
      codes = updated.codes;
      renderCodes();
      closeSheet();
    });
  }

  renderCodes();
  startCamera();
}
