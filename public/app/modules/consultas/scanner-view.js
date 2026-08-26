// Módulo App · Consultar grupo — escáner de cámara de solo lectura.
// Cada código escaneado dispara una búsqueda (findProduct) y muestra el
// resultado en una ficha; no se guarda nada, no hay listado ni ingreso masivo.
// Misma cámara/motores de lectura que Mapear (scanner/camera.js).

import { icon } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { existsLocal, hasData, findLocal } from '/shared/js/product-catalog.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import { findProduct } from './store.js';

const LAST_SCANNED_KEY = 'gd.consultas.lastScanned.v1';

// Solo el último producto escaneado — cada escaneo pisa el anterior, nunca se acumula.
function saveLastScanned(product) {
  try {
    localStorage.setItem(LAST_SCANNED_KEY, JSON.stringify(product));
  } catch (e) {
    console.error('[consultas/scanner-view] No se pudo guardar el último escaneado:', e.message);
  }
}

function loadLastScanned() {
  try {
    const raw = localStorage.getItem(LAST_SCANNED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lastScannedHTML(product) {
  if (!product) return '';
  return `
    <div class="cq-last-scanned" id="lastScannedCard">
      <span class="cq-last-scanned-label">Último escaneado</span>
      <span class="cq-last-scanned-desc">${escapeHtml(product.description || 'Producto sin descripción')}</span>
      <div class="cq-last-scanned-meta">
        <span class="cq-last-scanned-item">${icon('barcode', 13)} ${escapeHtml(product.code)}</span>
        <span class="cq-last-scanned-item">${icon('tag', 13)} ${product.ean ? escapeHtml(product.ean) : '-'}</span>
        <span class="cq-last-scanned-item">${icon('package', 13)} ${product.group ? escapeHtml(product.group) : '-'}</span>
      </div>
    </div>
  `;
}

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
      <div id="lastScanned"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const lastScannedEl = overlay.querySelector('#lastScanned');

  // Repinta y reconecta el listener (innerHTML tira el anterior); se llama
  // al abrir y en cada escaneo nuevo. Tocarlo relanza lookupCode con datos frescos.
  function renderLastScanned(product) {
    lastScannedEl.innerHTML = lastScannedHTML(product);
    const card = lastScannedEl.querySelector('#lastScannedCard');
    if (!card) return;
    card.addEventListener('click', () => lookupCode(product.code));
  }
  renderLastScanned(loadLastScanned());
  const cameraBox = overlay.querySelector('#scanCamera');
  const videoEl = overlay.querySelector('#scanVideo');
  const hintEl = overlay.querySelector('#scanHint');
  const torchBtn = overlay.querySelector('#scanTorch');
  const manualForm = overlay.querySelector('#scanManual');

  let closed = false;
  let activeSheetBackdrop = null;

  // El sheet se abre ya con placeholders (evita que el usuario crea que el
  // escaneo no funcionó mientras espera el cruce Coordenadas/Referencia).
  // Antes de eso valida contra el catálogo local para evitar abrir una
  // ficha entera si el código no existe; se salta la validación si el
  // catálogo local está vacío (sin red desde el primer uso).
  async function lookupCode(rawValue) {
    if (activeSheetBackdrop) return; // ya hay una ficha abierta, ignora escaneos nuevos
    if (navigator.vibrate) navigator.vibrate(35);
    if (hasData() && !existsLocal(rawValue)) {
      showToast(`Código no encontrado: ${rawValue}`, { variant: 'warn' });
      return;
    }
    const sheet = openResultSheet(rawValue);
    try {
      const product = await findProduct(rawValue);
      sheet.showResult(product, null);
    } catch (err) {
      sheet.showResult(null, err);
    }
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

  // width/height son valores CSS (ej. "70%", "18px").
  function skeletonHTML(width, height = '14px') {
    return `<span class="cq-skeleton" style="width:${width};height:${height}"></span>`;
  }

  // Achica la fuente en escalones en vez de cortar texto; el clamp de 2
  // líneas (CSS) es la red de seguridad final.
  function titleSizeClass(text) {
    if (text.length <= 34) return '';
    if (text.length <= 60) return 'is-md';
    return 'is-sm';
  }

  function chipSizeClass(text) {
    if (text.length <= 3) return '';
    if (text.length <= 5) return 'is-md';
    return 'is-sm';
  }

  function chipHTML(text) {
    return `<span class="cq-location-chip ${chipSizeClass(text)}">${escapeHtml(text)}</span>`;
  }

  function openResultSheet(code) {
    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    // Descripción/EAN, si ya están en el catálogo local, se pintan de una;
    // grupo y ubicaciones necesitan el cruce real y esperan a findProduct().
    const local = findLocal(code);

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title ${local ? titleSizeClass(local.descripcion || '') : ''}" id="resultTitle">${local ? escapeHtml(local.descripcion || 'Producto sin descripción') : skeletonHTML('75%', '18px')}</span>
          <button type="button" class="btn-icon" id="resultClose" title="Cerrar">${icon('x', 18)}</button>
        </div>
        <div id="resultBody">
          <div class="reg-info-grid cq-info-grid">
            <div class="reg-info-cell">
              <span class="reg-info-label">EAN</span>
              <span class="reg-info-value">${local ? (local.ean ? escapeHtml(local.ean) : '-') : skeletonHTML('44px')}</span>
            </div>
            <div class="reg-info-cell">
              <span class="reg-info-label">Referencia</span>
              <span class="reg-info-value">${escapeHtml(code)}</span>
            </div>
            <div class="reg-info-cell">
              <span class="reg-info-label">Grupo</span>
              <span class="reg-info-value">${skeletonHTML('44px')}</span>
            </div>
          </div>
          <div class="cq-suggested-box">
            <span class="cq-locations-label">Ubicación sugerida</span>
            <div class="cq-suggested-list">
              <div class="cq-suggested-row">
                <span class="cq-suggested-level-label">${skeletonHTML('44px', '11px')}</span>
                <span class="cq-suggested-value">${skeletonHTML('64px')}</span>
              </div>
            </div>
          </div>
          <div class="cq-aisles-box">
            <span class="cq-locations-label">${icon('map', 14)} Rango de ubicaciones del grupo</span>
            <div class="cq-aisles-list">
              <div class="cq-aisle-row">
                <span class="cq-location-chip">${skeletonHTML('28px')}</span>
                <span class="cq-range-arrow">${icon('arrowRight', 15)}</span>
                <span class="cq-location-chip">${skeletonHTML('28px')}</span>
              </div>
            </div>
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

    // Reemplaza los placeholders por los datos reales; se llama una sola vez.
    function showResult(product, lookupError) {
      if (!backdrop.isConnected) return; // el usuario ya cerró el sheet antes de que llegara la respuesta

      const ranges = product?.ranges || [];
      const suggestions = product?.suggestions || [];
      const titleText = lookupError
        ? 'No se pudo consultar'
        : product
          ? (product.description || 'Producto sin descripción')
          : 'Sin datos en la base';

      const titleEl = backdrop.querySelector('#resultTitle');
      titleEl.textContent = titleText;
      titleEl.classList.remove('is-md', 'is-sm');
      titleEl.classList.add(...['cq-fade-in', titleSizeClass(titleText)].filter(Boolean));

      // Solo se guarda si el producto existe de verdad — un "no
      // encontrado" o un error de red nunca deben pisar el último
      // escaneado válido que ya había.
      if (!lookupError && product) {
        const scanned = { code, description: product.description, ean: product.ean, group: product.group };
        saveLastScanned(scanned);
        renderLastScanned(scanned);
      }

      const bodyEl = backdrop.querySelector('#resultBody');
      if (lookupError) {
        bodyEl.innerHTML = `<p class="cq-desc-value cq-fade-in">No se pudo completar la búsqueda. Revisá la conexión e intentá de nuevo.</p>`;
        return;
      }
      if (!product) {
        bodyEl.innerHTML = '';
        return;
      }

      bodyEl.innerHTML = `
        <div class="reg-info-grid cq-info-grid cq-fade-in">
          <div class="reg-info-cell">
            <span class="reg-info-label">EAN</span>
            <span class="reg-info-value">${product.ean ? escapeHtml(product.ean) : '-'}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Referencia</span>
            <span class="reg-info-value">${escapeHtml(code)}</span>
          </div>
          <div class="reg-info-cell">
            <span class="reg-info-label">Grupo</span>
            <span class="reg-info-value">${product.group ? escapeHtml(product.group) : '-'}</span>
          </div>
        </div>
        <div class="cq-suggested-box cq-fade-in">
          <span class="cq-locations-label">Ubicación sugerida</span>
          ${suggestions.length ? `
            <div class="cq-suggested-list">
              ${suggestions.map((s) => `
                <div class="cq-suggested-row">
                  <span class="cq-suggested-level-label">${escapeHtml(s.level)}</span>
                  <span class="cq-suggested-value">${escapeHtml(s.location)}</span>
                </div>
              `).join('')}
            </div>
          ` : `<p class="cq-suggested-value">Sin datos</p>`}
        </div>
        <div class="cq-aisles-box cq-fade-in">
          <span class="cq-locations-label">${icon('map', 14)} Rango de ubicaciones del grupo</span>
          ${ranges.length ? `
            <div class="cq-aisles-list">
              ${ranges.map((r) => `
                <div class="cq-aisle-row">
                  <span class="cq-level-tag cq-level-tag--${r.level === 'Picking' ? 'picking' : 'altura'}">${r.level}</span>
                  ${chipHTML(r.from)}
                  <span class="cq-range-arrow">${icon('arrowRight', 15)}</span>
                  ${chipHTML(r.to)}
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="cq-location-list"><span class="cq-location-chip is-empty">—</span></div>
          `}
        </div>
      `;
    }

    return { showResult };
  }

  scanner.start();
}
