/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Un solo overlay de cámara para todo el flujo, sin volver a pedir
   permiso ni parpadear entre pasos:
     1) Escanear la caja (contra `caja`) — NUNCA se puede saltar: es el
        único paso que confirma que el operario está parado frente a
        la posición correcta, saltarlo volvería inútil todo lo que
        sigue.
     2) Si coincide, escanear el código de barras (contra `referencia`)
        — acá SÍ se puede reportar "faltante" sin escanear (si el
        producto de verdad no está, insistir en escanearlo no tiene
        sentido), pero exige una foto de la posición vacía como
        evidencia.
     3) Motivo: OK u Otro (personalizado) — "Faltante" no es una opción
        de este paso, es su propio camino (2b) con su propia exigencia.

   Un match en cualquier paso avanza SOLO, sin pedir confirmación
   ("sin fricción" es literal) — pero el cambio de paso se marca fuerte
   (stepper + vibración + toast) para que nunca pase desapercibido que
   ahora se espera escanear algo distinto.

   El valor esperado de cada paso nunca se muestra de entrada (eso
   volvería el paso un trámite de tipeo, no una verificación real) —
   solo aparece si hay un desacuerdo, para poder diagnosticarlo.
   ============================================================ */

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import * as store from './store.js';

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function formatQty(saldo) {
  if (saldo == null) return '-';
  return saldo.toLocaleString('es-AR', { maximumFractionDigits: 2 });
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

  let step = 'caja'; // 'caja' -> 'barcode' -> 'motivo' | 'foto'
  let mismatch = null; // { expected, scanned } — solo mientras se muestra el aviso
  let closed = false;
  let submitting = false;
  let photoDataUrl = null;

  function expectedFor(s) {
    return s === 'caja' ? item.caja : item.referencia;
  }

  function stepTitle(s) {
    return s === 'caja' ? 'Escaneá la caja' : 'Escaneá el código de barras';
  }

  // Stepper de 2 pasos, siempre visible arriba del contenido del
  // sheet — junto con el toast al avanzar, es lo que hace imposible no
  // notar que cambió qué hay que escanear (antes, solo el título de
  // arriba cambiaba y pasaba desapercibido).
  function stepperHTML(current) {
    const cajaDone = current !== 'caja';
    const prodActive = current === 'barcode';
    const prodDone = current === 'motivo' || current === 'foto';
    return `
      <div class="venc-stepper">
        <span class="venc-step ${cajaDone ? 'is-done' : 'is-active'}">${cajaDone ? icon('check', 12) : '1'} Caja</span>
        <span class="venc-step-sep"></span>
        <span class="venc-step ${prodDone ? 'is-done' : prodActive ? 'is-active' : ''}">${prodDone ? icon('check', 12) : '2'} Producto</span>
      </div>
    `;
  }

  // Acá SÍ va la fecha completa (a diferencia de la tarjeta de la
  // lista): este es el momento de confirmar el ítem exacto, no de
  // decidir a dónde ir — mismo patrón de celdas (reg-info-grid) que
  // ya usan Mapear/Consultar grupo para datos de producto, así queda
  // consistente con el resto de la app.
  function itemSummaryHTML() {
    const daysLabel = item.days === 0 ? 'Hoy' : `${item.days}d`;
    const um = item.unidadmedida ? ` ${item.unidadmedida}` : '';
    return `
      <div class="venc-val-summary">
        <div class="venc-val-top">
          <div class="venc-val-days is-${item.severity}">${daysLabel}</div>
          <div class="venc-val-top-info">
            <span class="venc-val-ubicacion">${iconSolid('ubicacion', 17)} ${escapeHtml(item.ubicacion || '-')}</span>
            <p class="venc-val-desc">${escapeHtml(item.descripcion || 'Producto sin descripción')}</p>
          </div>
        </div>
        <div class="reg-info-grid">
          <div class="reg-info-cell">
            <span class="reg-info-label">${iconSolid('caja', 13)}</span>
            <span class="reg-info-value">${escapeHtml(item.caja || '-')}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Vence</span>
            <span class="reg-info-value">${escapeHtml(item.fv || '-')}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">${iconSolid('unidades', 13)}</span>
            <span class="reg-info-value">${formatQty(item.saldo)}${escapeHtml(um)}</span>
          </div>
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
    const isBarcode = step === 'barcode';
    sheetEl.innerHTML = `
      ${stepperHTML(step)}
      ${itemSummaryHTML()}
      ${mismatchHTML()}
      <form class="scan-manual" id="vencManualForm">
        <input type="text" inputmode="numeric" placeholder="${step === 'caja' ? 'Ingresar número de caja' : 'Ingresar código de barras'}" id="vencManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Confirmar">${icon('check', 18)}</button>
      </form>
      ${isBarcode ? `<button type="button" class="venc-val-skip" id="vencSkip">No lo encuentro — reportar faltante</button>` : ''}
    `;
    sheetEl.querySelector('#vencManualForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = sheetEl.querySelector('#vencManualInput');
      const value = input.value.trim();
      if (!value) return;
      handleCode(value);
      input.value = '';
    });
    if (isBarcode) sheetEl.querySelector('#vencSkip').addEventListener('click', goToFoto);
  }

  function renderMotivoStep() {
    titleEl.textContent = 'Motivo';
    sheetEl.innerHTML = `
      ${stepperHTML(step)}
      ${itemSummaryHTML()}
      <div class="venc-motivo-pills venc-motivo-pills-2">
        <button type="button" class="venc-motivo-pill is-ok" data-motivo="ok">${icon('check', 16)} OK</button>
        <button type="button" class="venc-motivo-pill is-otro" data-motivo="otro">${icon('edit', 16)} Otro</button>
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

  // Reportar faltante exige una foto de la posición vacía — un
  // snapshot del video YA activo (misma cámara del escaneo, nunca pide
  // permiso de nuevo ni cambia a la app de cámara nativa). El video
  // sigue en vivo durante este paso (a diferencia de "motivo", donde
  // ya no hace falta) para que el operario pueda encuadrar antes de
  // tomarla.
  function renderFotoStep() {
    titleEl.textContent = 'Foto de la posición vacía';
    photoDataUrl = null;
    sheetEl.innerHTML = `
      ${stepperHTML(step)}
      ${itemSummaryHTML()}
      <p class="venc-photo-hint">Encuadrá la posición vacía y tomá la foto — es obligatoria para reportar un faltante.</p>
      <div class="venc-photo-preview" id="vencPhotoPreview" hidden><img id="vencPhotoImg" alt="Foto de la posición" /></div>
      <button type="button" class="btn btn-primary btn-block" id="vencPhotoCapture">${icon('camera', 18)} Tomar foto</button>
      <div class="venc-photo-actions" id="vencPhotoActions" hidden>
        <button type="button" class="btn btn-ghost" id="vencPhotoRetake">Repetir foto</button>
        <button type="button" class="btn btn-danger" id="vencPhotoConfirm">Confirmar faltante</button>
      </div>
    `;

    const captureBtn = sheetEl.querySelector('#vencPhotoCapture');
    const actionsEl = sheetEl.querySelector('#vencPhotoActions');
    const previewEl = sheetEl.querySelector('#vencPhotoPreview');
    const imgEl = sheetEl.querySelector('#vencPhotoImg');

    captureBtn.addEventListener('click', () => {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 480;
      canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      photoDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      imgEl.src = photoDataUrl;
      previewEl.hidden = false;
      captureBtn.hidden = true;
      actionsEl.hidden = false;
      if (navigator.vibrate) navigator.vibrate(35);
    });

    sheetEl.querySelector('#vencPhotoRetake').addEventListener('click', () => {
      photoDataUrl = null;
      previewEl.hidden = true;
      actionsEl.hidden = true;
      captureBtn.hidden = false;
    });

    const confirmBtn = sheetEl.querySelector('#vencPhotoConfirm');
    confirmBtn.addEventListener('click', async () => {
      if (submitting || !photoDataUrl) return;
      submitting = true;
      confirmBtn.disabled = true;
      try {
        await store.validate(item, 'faltante', '', photoDataUrl);
        if (navigator.vibrate) navigator.vibrate(35);
        close();
        onDone();
      } catch {
        showToast('No se pudo guardar. Probá de nuevo.', { variant: 'warn' });
        submitting = false;
        confirmBtn.disabled = false;
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

  function goToFoto() {
    step = 'foto';
    mismatch = null;
    scanner.setPaused(true); // sin pauseView(): el video sigue en vivo para encuadrar la foto
    renderFotoStep();
  }

  function handleCode(raw) {
    if (step !== 'caja' && step !== 'barcode') return;
    const expected = expectedFor(step);
    if (!expected || norm(raw) === norm(expected)) {
      mismatch = null;
      if (navigator.vibrate) navigator.vibrate(35);
      if (step === 'caja') {
        step = 'barcode';
        renderScanStep();
        showToast('Caja verificada — ahora escaneá el producto.');
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
