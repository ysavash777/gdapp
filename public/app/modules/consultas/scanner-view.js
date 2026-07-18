/* ============================================================
   Módulo App · Consultar grupo — escáner de cámara de solo lectura.

   A diferencia de Mapear, acá no se guarda nada: cada código
   escaneado solo dispara una búsqueda (findProduct) y muestra el
   resultado en una ficha — al cerrarla, se puede seguir escaneando.
   findProduct (store.js) pide todo ya calculado a
   /api/consultas/lookup: descripción/EAN/grupo (Variables) + un
   rango de ubicaciones y una sugerida (cruzando Coordenadas y
   Referencia) — nunca la lista completa de ubicaciones de un grupo,
   que puede ser de miles.

   Misma cámara y mismos motores de lectura que Mapear, vía
   scanner/camera.js — acá no hay lista debajo ni ingreso masivo, así
   que tampoco hace falta filtro/búsqueda sobre "registros": no
   existen, cada consulta es independiente.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { createCameraScanner } from '../../scanner/camera.js';
import { findProduct } from './store.js';

export function openScanner() {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-back" id="scannerClose" title="Volver">${icon('arrowLeft', 20)}</button>
      <div class="scan-title">Consultar grupo</div>
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
    <div class="scan-sheet cq-sheet">
      <form class="scan-manual" id="scanManual">
        <input type="text" inputmode="numeric" placeholder="Ingresar código manualmente" id="scanManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Buscar">${icon('search', 18)}</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const cameraBox = overlay.querySelector('#scanCamera');
  const videoEl = overlay.querySelector('#scanVideo');
  const hintEl = overlay.querySelector('#scanHint');
  const torchBtn = overlay.querySelector('#scanTorch');
  const manualForm = overlay.querySelector('#scanManual');

  let closed = false;
  let activeSheetBackdrop = null;

  async function lookupCode(rawValue) {
    if (navigator.vibrate) navigator.vibrate(35);
    let product = null;
    let lookupError = null;
    try {
      product = await findProduct(rawValue);
    } catch (err) {
      lookupError = err;
    }
    openResultSheet(rawValue, product, lookupError);
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox, torchBtn, hintEl,
    onCode: (code) => lookupCode(code),
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (activeSheetBackdrop) activeSheetBackdrop.remove();
    scanner.destroy();
    window.removeEventListener('popstate', cleanup);
    overlay.remove();
  }
  window.addEventListener('popstate', cleanup);
  overlay.querySelector('#scannerClose').addEventListener('click', () => history.back());

  manualForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = overlay.querySelector('#scanManualInput');
    const value = input.value.trim();
    if (!value) return;
    await lookupCode(value);
    input.value = '';
  });

  function openResultSheet(code, product, lookupError) {
    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    const hasRange = product?.rangeFrom && product?.rangeTo;

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title">${lookupError ? 'No se pudo consultar' : product ? 'Producto encontrado' : 'Sin datos en la base'}</span>
          <button type="button" class="btn-icon" id="resultClose" title="Cerrar">${icon('x', 18)}</button>
        </div>
        ${lookupError ? `
          <p class="cq-desc-value">No se pudo completar la búsqueda. Revisá la conexión e intentá de nuevo.</p>
        ` : `
          <div class="cq-desc">
            <span class="cq-desc-label">Descripción</span>
            <p class="cq-desc-value">${escapeHtml(product?.description || 'Producto sin descripción')}</p>
          </div>
          <div class="reg-info-grid">
            <div class="reg-info-cell">
              <span class="reg-info-label">EAN</span>
              <span class="reg-info-value">${product?.ean ? escapeHtml(product.ean) : '-'}</span>
            </div>
            <div class="reg-info-cell">
              <span class="reg-info-label">Referencia</span>
              <span class="reg-info-value">${escapeHtml(code)}</span>
            </div>
            <div class="reg-info-cell">
              <span class="reg-info-label">Grupo</span>
              <span class="reg-info-value">${product?.group ? escapeHtml(product.group) : '-'}</span>
            </div>
          </div>
          <div class="cq-desc">
            <span class="cq-desc-label">Ubicación sugerida</span>
            <p class="cq-desc-value">${product?.suggestedLocation ? escapeHtml(product.suggestedLocation) : 'Sin datos'}</p>
          </div>
          <div class="cq-locations">
            <span class="cq-locations-label">${icon('pin', 14)} Rango de ubicaciones del grupo</span>
            ${hasRange ? `
              <div class="cq-range-row">
                <span class="cq-location-chip">${escapeHtml(product.rangeFrom)}</span>
                <span class="cq-range-arrow">${icon('arrowRight', 16)}</span>
                <span class="cq-location-chip">${escapeHtml(product.rangeTo)}</span>
              </div>
            ` : `
              <div class="cq-location-list"><span class="cq-location-chip is-empty">—</span></div>
            `}
          </div>
        `}
      </div>
    `;
    document.body.appendChild(backdrop);
    activeSheetBackdrop = backdrop;

    function closeResult() {
      backdrop.remove();
      activeSheetBackdrop = null;
      scanner.setPaused(false);
      scanner.resumeView();
    }
    backdrop.querySelector('#resultClose').addEventListener('click', closeResult);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeResult();
    });
  }

  scanner.start();
}
