/* ============================================================
   Módulo App · Consultar grupo — escáner de cámara de solo lectura.

   A diferencia de Mapear, acá no se guarda nada: cada código
   escaneado solo dispara una búsqueda (findProduct) y muestra el
   resultado en una ficha — al cerrarla, se puede seguir escaneando.
   findProduct (store.js) pide todo ya calculado a
   /api/consultas/lookup: descripción/EAN/grupo (Variables) + un
   rango por pasillo+nivel y hasta dos ubicaciones sugeridas, una para
   Picking y otra para Altura (cruzando Coordenadas y Referencia) —
   nunca la lista completa de ubicaciones de un grupo, que puede ser
   de miles y repartirse en varios pasillos y niveles no contiguos.

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

  // El sheet se abre YA, con placeholders en vez de esperar a que
  // conteste el servidor — si no, el usuario ve la cámara congelada
  // un par de segundos (el cruce con Coordenadas/Referencia no es
  // instantáneo) y piensa que el escaneo no funcionó, así que aprieta
  // "Buscar" de nuevo varias veces. La respuesta real solo reemplaza
  // los placeholders por los datos reales, con un fundido.
  async function lookupCode(rawValue) {
    if (navigator.vibrate) navigator.vibrate(35);
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

  // Placeholder angosto tipo "hueso" — se ve como texto a punto de
  // aparecer, no como una barra de carga genérica. `width`/`height`
  // son valores de CSS (ej. "70%", "18px").
  function skeletonHTML(width, height = '14px') {
    return `<span class="cq-skeleton" style="width:${width};height:${height}"></span>`;
  }

  // El título (la descripción) nunca puede empujar el sheet más allá
  // de 2 líneas — se achica la fuente en escalones en vez de cortar el
  // texto a la mitad de una palabra. El clamp de 2 líneas (CSS) es la
  // red de seguridad final para descripciones igual demasiado largas.
  function titleSizeClass(text) {
    if (text.length <= 34) return '';
    if (text.length <= 60) return 'is-md';
    return 'is-sm';
  }

  // El rango solo tiene que decir "pasillo + módulo" (ej. "MFCA30",
  // "B40"), nunca la posición/piso completo (ej. "MFCA300104",
  // "B400101") — mostrar hasta el módulo ya deja claro qué tramo
  // cubre, sin la posición exacta que la ubicación SUGERIDA sí
  // necesita completa. El formato real es prefijo de letras + 6
  // dígitos, donde los primeros 2 son el módulo — si no matchea (dato
  // con otra forma), se muestra tal cual en vez de romper.
  function simplifyLocation(loc) {
    const m = String(loc).match(/^(\D+)(\d{2})/);
    return m ? `${m[1]}${m[2]}` : loc;
  }

  // Todos los chips de ubicación miden lo mismo sin importar cuántos
  // caracteres tengan ("B4" vs "MFCA58") — se achica la fuente en vez
  // de dejar que la caja crezca, para que la fila de rangos quede
  // alineada y simétrica.
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

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title" id="resultTitle">${skeletonHTML('75%', '18px')}</span>
          <button type="button" class="btn-icon" id="resultClose" title="Cerrar">${icon('x', 18)}</button>
        </div>
        <div id="resultBody">
          <div class="reg-info-grid cq-info-grid">
            <div class="reg-info-cell">
              <span class="reg-info-label">EAN</span>
              <span class="reg-info-value">${skeletonHTML('44px')}</span>
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

    // Reemplaza los placeholders por los datos reales, cada uno con un
    // fundido — nunca un "parpadeo" de golpe. Se llama una sola vez,
    // cuando /api/consultas/lookup contesta (bien o mal).
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
                  ${chipHTML(simplifyLocation(r.from))}
                  <span class="cq-range-arrow">${icon('arrowRight', 15)}</span>
                  ${chipHTML(simplifyLocation(r.to))}
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
