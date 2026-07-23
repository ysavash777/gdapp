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
import { existsLocal, hasData, findLocal } from '/shared/js/product-catalog.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import { findProduct } from './store.js';

const LAST_SCANNED_KEY = 'gd.consultas.lastScanned.v1';

// Solo el ÚLTIMO producto escaneado — nunca un historial. Cada
// escaneo exitoso pisa el anterior por completo (nunca se acumula),
// así que esto siempre pesa lo mismo en localStorage sin importar
// cuánto se use la herramienta.
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

// Sin EAN acá (solo referencia): este renglón es un acceso rápido, no
// una ficha — el EAN ya se ve completo si se vuelve a abrir la ficha
// deslizando hacia arriba. El "manija" (barra chica arriba) es la
// única pista visual de que se puede deslizar — sin ella, un renglón
// que reacciona a un gesto pero no lo insinúa se siente roto.
function lastScannedHTML(product) {
  if (!product) return '';
  return `
    <div class="cq-last-scanned" id="lastScannedCard">
      <span class="cq-last-scanned-handle"></span>
      <span class="cq-last-scanned-label">Último escaneado</span>
      <span class="cq-last-scanned-desc">${escapeHtml(product.description || 'Producto sin descripción')}</span>
      <span class="cq-last-scanned-code">${escapeHtml(product.code)}</span>
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

  // Repinta el renglón Y le vuelve a conectar los gestos — innerHTML
  // tira cualquier listener anterior, así que esto se llama tanto al
  // abrir el escáner como cada vez que hay un escaneo nuevo (ver
  // showResult() más abajo), nunca una sola vez.
  function renderLastScanned(product) {
    lastScannedEl.innerHTML = lastScannedHTML(product);
    const card = lastScannedEl.querySelector('#lastScannedCard');
    if (!card) return;

    card.addEventListener('click', () => lookupCode(product.code));

    // Deslizar hacia arriba reabre la ficha completa (ubicación
    // sugerida, rango, etc.) — el mismo camino que un escaneo nuevo
    // del mismo código, así siempre trae el dato más fresco en vez de
    // una foto vieja guardada en el celular.
    let startY = null;
    card.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
    card.addEventListener('touchend', (e) => {
      if (startY == null) return;
      const draggedUp = startY - (e.changedTouches[0]?.clientY ?? startY);
      startY = null;
      if (draggedUp > 24) lookupCode(product.code);
    });
  }
  renderLastScanned(loadLastScanned());
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
  // Antes de abrir la ficha (y de gastar una llamada al servidor), se
  // valida contra el catálogo local (shared/js/product-catalog.js) si
  // el código existe en Variables — si no, una alerta flotante basta:
  // abrir una ficha entera para terminar mostrando "Sin datos" es una
  // interacción de más (hay que cerrarla a mano) por algo que ya se
  // sabía de antemano. Solo se salta esta validación si el catálogo
  // local todavía está vacío (sin red desde el primer uso): ahí no hay
  // forma de saber si existe o no, así que se deja pasar a la ficha,
  // que igual maneja el caso "sin conexión" mostrando el error real.
  async function lookupCode(rawValue) {
    // Si ya hay una ficha abierta, se ignora cualquier escaneo nuevo
    // (cámara o manual) — nunca dos fichas encimadas.
    if (activeSheetBackdrop) return;
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

    // Descripción y EAN, si ya están en el catálogo local (ver
    // /shared/js/product-catalog.js), se pintan de una — ese dato no
    // cambia una vez que el producto existe en Variables, así que no
    // hace falta esperar al servidor ni mostrar un "hueso" para estos
    // dos campos. Grupo y ubicaciones SÍ necesitan el cruce real
    // (Coordenadas/Referencia), eso sigue esperando a findProduct().
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

      // Solo se guarda si el producto existe de verdad — un "no
      // encontrado" o un error de red nunca deben pisar el último
      // escaneado válido que ya había.
      if (!lookupError && product) {
        const scanned = { code, description: product.description };
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
