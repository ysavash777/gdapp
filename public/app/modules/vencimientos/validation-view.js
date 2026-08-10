/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Un solo overlay de cámara para los 3 pasos, sin volver a pedir
   permiso de cámara entre ellos ni parpadeos: 1) escanear la caja
   (comparado contra `caja`), 2) si coincide, escanear el código de
   barras (comparado contra `referencia`), 3) recién ahí, motivo
   (OK/Vencido/Faltante/Otro). "Sin fricción" es literal: un match
   avanza solo, sin pedir confirmación — el único freno es un
   desacuerdo real entre lo escaneado y el dato del sistema.

   El valor esperado de cada paso NUNCA se muestra de entrada (mostrar
   "tenés que leer 419532" antes de escanear volvería el paso un
   trámite de tipeo, no una verificación real) — solo aparece si hay
   un desacuerdo, para poder diagnosticarlo (¿la caja está mal rotulada?
   ¿está en el lugar equivocado?), junto con un atajo para saltar el
   resto del escaneo si el ítem realmente no está donde debería (ítem
   faltante: no tiene sentido insistir en escanear algo que no existe).
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { escapeHtml, formatDateTime } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import * as store from './store.js';

const MOTIVOS = [
  { value: 'ok', label: 'OK', icon: 'check' },
  { value: 'vencido', label: 'Vencido', icon: 'calendarAlert' },
  { value: 'faltante', label: 'Faltante', icon: 'inbox' },
  { value: 'otro', label: 'Otro', icon: 'edit' },
];

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

export function openValidation(item, { onDone }) {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-back" id="vencClose" title="Cerrar">${icon('x', 20)}</button>
      <div class="scan-title" id="vencStepTitle">Escaneá la caja</div>
      <div class="scan-header-actions">
        <button class="btn-icon scan-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 20)}</button>
      </div>
    </div>
    <div class="scan-camera cq-camera" id="scanCamera" title="Tocar para apagar/prender la cámara">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-line"></div>
      <p class="scan-hint" id="scanHint" hidden></p>
      <div class="scan-camera-gradient"></div>
    </div>
    <div class="scan-sheet cq-sheet" id="vencSheet"></div>
  `;
  document.body.appendChild(overlay);

  history.pushState({ vencValidation: true }, '', location.href);
  let closedByPop = false;
  window.addEventListener('popstate', onPopState);
  function onPopState() {
    closedByPop = true;
    close();
  }

  const cameraBox = overlay.querySelector('#scanCamera');
  const videoEl = overlay.querySelector('#scanVideo');
  const hintEl = overlay.querySelector('#scanHint');
  const torchBtn = overlay.querySelector('#scanTorch');
  const titleEl = overlay.querySelector('#vencStepTitle');
  const sheetEl = overlay.querySelector('#vencSheet');

  let step = 'caja'; // 'caja' -> 'barcode' -> 'motivo'
  let mismatch = null; // { expected, scanned } — solo mientras se muestra el aviso
  let closed = false;
  let submitting = false;

  function expectedFor(s) {
    return s === 'caja' ? item.caja : item.referencia;
  }

  function stepTitle(s) {
    return s === 'caja' ? 'Escaneá la caja' : 'Escaneá el código de barras';
  }

  function itemSummaryHTML() {
    // Sin la frase "Vencido hace"/"Vence en" — el signo del número ya
    // lo dice todo (pedido explícito).
    const daysLabel = item.days === 0 ? 'Hoy' : `${item.days}d`;
    const qty = item.saldo == null ? '-' : item.saldo.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    return `
      <div class="venc-val-summary">
        <p class="venc-val-desc">${escapeHtml(item.descripcion || 'Producto sin descripción')}</p>
        <div class="venc-val-meta">
          <span>${icon('pin', 13)} ${escapeHtml(item.ubicacion || '-')}</span>
          <span>${icon('package', 13)} ${qty} ${item.unidadmedida ? escapeHtml(item.unidadmedida) : ''}</span>
          <span>${icon('calendar', 13)} ${escapeHtml(item.fv || '-')}</span>
          <span class="venc-val-days is-${item.severity}">${daysLabel}</span>
        </div>
      </div>
    `;
  }

  function mismatchHTML() {
    if (!mismatch) return '';
    return `
      <div class="venc-val-mismatch">
        ${icon('alertTriangle', 15)}
        <span>No coincide. Esperado <strong>${escapeHtml(mismatch.expected)}</strong>, se leyó <strong>${escapeHtml(mismatch.scanned)}</strong>.</span>
      </div>
    `;
  }

  function renderScanStep() {
    titleEl.textContent = stepTitle(step);
    sheetEl.innerHTML = `
      ${itemSummaryHTML()}
      ${mismatchHTML()}
      <form class="scan-manual" id="vencManualForm">
        <input type="text" inputmode="numeric" placeholder="${step === 'caja' ? 'Ingresar número de caja' : 'Ingresar código de barras'}" id="vencManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Confirmar">${icon('check', 18)}</button>
      </form>
      <button type="button" class="venc-val-skip" id="vencSkip">No lo encuentro / saltar escaneo</button>
    `;
    sheetEl.querySelector('#vencManualForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = sheetEl.querySelector('#vencManualInput');
      const value = input.value.trim();
      if (!value) return;
      handleCode(value);
      input.value = '';
    });
    sheetEl.querySelector('#vencSkip').addEventListener('click', goToMotivo);
  }

  function renderMotivoStep() {
    titleEl.textContent = 'Motivo';
    sheetEl.innerHTML = `
      ${itemSummaryHTML()}
      <div class="venc-motivo-pills">
        ${MOTIVOS.map((m) => `<button type="button" class="venc-motivo-pill is-${m.value}" data-motivo="${m.value}">${icon(m.icon, 16)} ${m.label}</button>`).join('')}
      </div>
      <div id="vencMotivoExtra"></div>
      <button type="button" class="btn btn-primary btn-block" id="vencConfirm" disabled>Confirmar</button>
    `;
    let motivo = null;
    let motivoDetalle = '';
    const extraEl = sheetEl.querySelector('#vencMotivoExtra');
    const confirmBtn = sheetEl.querySelector('#vencConfirm');

    function updateDone() {
      confirmBtn.disabled = !motivo || (motivo === 'otro' && !motivoDetalle.trim());
    }

    sheetEl.querySelectorAll('.venc-motivo-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        motivo = pill.dataset.motivo;
        sheetEl.querySelectorAll('.venc-motivo-pill').forEach((p) => p.classList.toggle('is-selected', p === pill));
        extraEl.innerHTML = motivo === 'otro'
          ? `<input type="text" id="vencOtroInput" class="otro-input" maxlength="60" placeholder="Especificar motivo" autocomplete="off" />`
          : '';
        if (motivo === 'otro') {
          const otroInput = extraEl.querySelector('#vencOtroInput');
          otroInput.focus();
          otroInput.addEventListener('input', () => {
            motivoDetalle = otroInput.value;
            updateDone();
          });
        }
        updateDone();
      });
    });

    confirmBtn.addEventListener('click', async () => {
      if (submitting) return;
      submitting = true;
      confirmBtn.disabled = true;
      try {
        await store.validate(item, motivo, motivoDetalle);
        if (navigator.vibrate) navigator.vibrate(35);
        close();
        onDone();
      } catch {
        showToast('No se pudo guardar. Probá de nuevo.', { variant: 'warn' });
        submitting = false;
        updateDone();
      }
    });
  }

  function goToMotivo() {
    step = 'motivo';
    mismatch = null;
    scanner.setPaused(true);
    scanner.pauseView();
    renderMotivoStep();
  }

  function handleCode(raw) {
    if (step === 'motivo') return;
    const expected = expectedFor(step);
    if (!expected || norm(raw) === norm(expected)) {
      mismatch = null;
      if (navigator.vibrate) navigator.vibrate(35);
      if (step === 'caja') {
        step = 'barcode';
        renderScanStep();
      } else {
        goToMotivo();
      }
      return;
    }
    mismatch = { expected, scanned: raw };
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    renderScanStep();
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox, torchBtn, hintEl,
    onCode: (code) => handleCode(code),
  });

  function close() {
    if (closed) return;
    closed = true;
    scanner.destroy();
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
  }

  overlay.querySelector('#vencClose').addEventListener('click', close);

  renderScanStep();
  scanner.start();
}
