/* ============================================================
   Módulo App · Consultar grupo — escáner de cámara de solo lectura.

   A diferencia de Mapear, acá no se guarda nada: cada código
   escaneado solo dispara una búsqueda (findProduct) y muestra el
   resultado en una ficha — al cerrarla, se puede seguir escaneando.
   Sin base de datos conectada todavía, la ficha siempre aparece
   vacía (ver store.js).

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
    const product = await findProduct(rawValue);
    openResultSheet(rawValue, product);
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox, torchBtn, hintEl,
    onCode: (code) => lookupCode(code),
  });

  // A diferencia de Mapear, esta herramienta no tiene un paso de lista
  // antes del escáner — la ruta ES el escáner. Por eso no hace falta
  // una guarda de historial propia: alcanza con escuchar el "volver"
  // que ya generó pushRoute('consultas') en app.js y limpiar overlay
  // + cámara cuando ocurra. La flecha de volver hace exactamente lo
  // mismo que el gesto físico: un solo history.back(), un solo evento.
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

  // Ficha de solo lectura: sin motivo, sin cantidad, sin "Listo" — se
  // cierra y listo, no hay nada que confirmar ni guardar.
  function openResultSheet(code, product) {
    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    const locations = product?.locations || [];

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title">${product ? 'Producto encontrado' : 'Sin datos en la base'}</span>
          <button type="button" class="btn-icon" id="resultClose" title="Cerrar">${icon('x', 18)}</button>
        </div>
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
        <div class="cq-locations">
          <span class="cq-locations-label">${icon('pin', 14)} Ubicaciones de guardado</span>
          <div class="cq-location-list">
            ${locations.length ? locations.map((l) => `<span class="cq-location-chip">${escapeHtml(l)}</span>`).join('') : '<span class="cq-location-chip is-empty">—</span>'}
          </div>
        </div>
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
