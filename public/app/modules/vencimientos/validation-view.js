// Módulo Vencimientos — validación de un ítem. Acordeón de 3 pasos (Caja >
// Producto > Observación), uno a la vez, montado embebido en list-view.js
// (modo "Sugerido") vía mountSuggestedFlow(). Caja confirma la posición
// (bloquea Producto hasta validarse); Producto admite reportar "faltante"
// con foto en vez de escanear; Observación repite los datos y pide texto
// libre obligatorio. Un solo <video> de cámara se reutiliza entre Caja y
// Producto (se mueve con .prepend, nunca se recrea ni repide permiso).

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { matchesCode } from '/shared/js/product-catalog.js';
import { createCameraScanner } from '../../scanner/camera.js';
import * as store from './store.js';
import { currentUser } from '/shared/js/session.js';

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

const MISMATCH_MAX_CHARS = 14;
function truncate(v) {
  const s = String(v ?? '');
  return s.length > MISMATCH_MAX_CHARS ? `${s.slice(0, MISMATCH_MAX_CHARS)}…` : s;
}

function formatQty(saldo) {
  if (saldo == null) return '-';
  return saldo.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// La ubicación debe entrar siempre en una línea: se escala la fuente por
// tramos de longitud en vez de cortar texto.
function locSizeClass(text) {
  const len = String(text || '').length;
  if (len <= 8) return '';
  if (len <= 11) return 'is-md';
  if (len <= 14) return 'is-sm';
  return 'is-xs';
}

// Texto libre: no alcanza con escalones fijos, se mide de verdad
// (scrollHeight > clientHeight con line-clamp a 2 líneas) y se achica de a
// 1px hasta que entre o se llegue al piso mínimo.
const PROD_DESC_MIN_FONT_PX = 11;
function fitProdDescription(el) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollHeight > el.clientHeight + 1 && size > PROD_DESC_MIN_FONT_PX) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

// Debe reflejar el mismo aviso que urgencyBannerHTML() en list-view.js.
function urgencyBannerHTML(it) {
  if (it.isRetirar) {
    return `<div class="venc-suggest-urgency is-${it.severity}">${icon('alertTriangle', 16)} Retirar de ubicación</div>`;
  }
  return `<div class="venc-suggest-urgency is-${it.severity}">${icon('calendarAlert', 16)} Vence en ${it.days} día${it.days === 1 ? '' : 's'}</div>`;
}

// Arma el acordeón dentro de `overlay`.
//   - onValidated(item): optimista, llamado antes de que termine el guardado
//     real; devuelve la cola pendiente sin este ítem.
//   - onValidateError(item): el guardado falló en segundo plano, quien llama
//     debe reincorporar el ítem a su lista local.
//   - onIndexChange(idx)/onEmpty(): opcionales, usados por la ficha embebida.
function renderValidationFlow(overlay, initialItem, { pendingItems = [], onValidated, onValidateError, onIndexChange, onEmpty }) {
  let item = initialItem;
  let slides = pendingItems.length ? pendingItems : [initialItem];

  overlay.innerHTML = `
    <div class="scan-sheet cq-sheet venc-acc-body" id="vencAccBody">
      <div class="venc-acc-item venc-loc-nav" id="locNav">
        <button type="button" class="venc-loc-arrow" id="locPrev" title="Posición anterior">${icon('chevronLeft', 20)}</button>
        <div class="venc-loc-info" id="locInfo">
          <span class="venc-loc-caption">Ubicación sugerida:</span>
          <strong class="venc-loc-ubicacion" id="locUbicacion"></strong>
          <span class="venc-loc-caja">${iconSolid('caja', 13)}<span id="locCajaNumero"></span></span>
        </div>
        <button type="button" class="venc-loc-arrow" id="locNext" title="Posición siguiente">${icon('chevronRight', 20)}</button>
      </div>
      <div class="venc-acc-item" data-state="pending" id="itemCaja">
        <button type="button" class="venc-acc-head" id="headCaja">
          <span class="venc-acc-avatar" id="avatarCaja">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title" id="cajaHeadTitle">Confirmar ubicación</strong>
            <span class="venc-acc-head-sub" id="cajaHeadSub">Escanea la etiqueta</span>
          </span>
        </button>
        <div class="venc-acc-panel" id="panelCaja" hidden>
          <div class="venc-acc-controls" id="controlsCaja"></div>
        </div>
      </div>

      <div class="venc-acc-item" data-state="locked" id="itemProd">
        <button type="button" class="venc-acc-head" id="headProd">
          <span class="venc-acc-avatar" id="avatarProd">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title venc-prod-desc" id="prodDescripcion"></strong>
            <span class="venc-acc-head-sub" id="prodReferencia"></span>
          </span>
        </button>
        <div class="venc-acc-panel" id="panelProd" hidden>
          <div class="venc-acc-controls" id="controlsProd"></div>
        </div>
      </div>

      <div class="venc-acc-item venc-photo-view" id="vencPhotoView" hidden>
        <div class="venc-acc-head">
          <span class="venc-acc-avatar">${icon('camera', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title">Reportar faltante</strong>
            <span class="venc-acc-head-sub">Foto de la posición vacía</span>
          </span>
        </div>
        <div class="venc-acc-panel">
          <div class="venc-photo-source-row" id="vencPhotoSourceRow">
            <label class="venc-photo-source-btn" for="vencPhotoCameraInput">${icon('camera', 18)}<span>Cámara</span></label>
            <label class="venc-photo-source-btn" for="vencPhotoGalleryInput">${icon('image', 18)}<span>Galería</span></label>
          </div>
          <input type="file" accept="image/*" capture="environment" id="vencPhotoCameraInput" hidden />
          <input type="file" accept="image/*" id="vencPhotoGalleryInput" hidden />
          <div class="venc-photo-thumb-row" id="vencPhotoThumbRow" hidden>
            <img class="venc-photo-thumb" id="vencPhotoThumb" alt="Foto elegida" />
            <span class="venc-photo-thumb-label">Foto lista</span>
            <button type="button" class="btn-icon" id="vencPhotoRemove" title="Quitar foto">${icon('x', 15)}</button>
          </div>
          <div class="venc-photo-actions-row">
            <button type="button" class="venc-val-skip" id="vencPhotoCancel">${icon('chevronLeft', 15)} Cancelar</button>
            <button type="button" class="btn btn-danger btn-block" id="vencPhotoConfirm" disabled>Confirmar faltante</button>
          </div>
        </div>
      </div>

      <div class="venc-acc-item" id="itemComment" hidden>
        <div class="venc-acc-panel" id="panelComment">
          <div class="venc-review-box" id="vencReviewBox"></div>
          <div class="venc-acc-controls">
            <textarea class="venc-acc-comment-input" id="vencComentario" rows="3" maxlength="200" placeholder="Añadir observación" disabled></textarea>
            <button type="button" class="btn btn-primary btn-block" id="vencConfirm" disabled>Confirmar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const locPrev = overlay.querySelector('#locPrev');
  const locNext = overlay.querySelector('#locNext');
  const locInfoEl = overlay.querySelector('#locInfo');
  const locUbicacionEl = overlay.querySelector('#locUbicacion');
  const locCajaNumeroEl = overlay.querySelector('#locCajaNumero');

  const itemCaja = overlay.querySelector('#itemCaja');
  const headCaja = overlay.querySelector('#headCaja');
  const avatarCaja = overlay.querySelector('#avatarCaja');
  const cajaHeadTitleEl = overlay.querySelector('#cajaHeadTitle');
  const cajaHeadSubEl = overlay.querySelector('#cajaHeadSub');
  const panelCaja = overlay.querySelector('#panelCaja');
  const controlsCaja = overlay.querySelector('#controlsCaja');

  const itemProd = overlay.querySelector('#itemProd');
  const headProd = overlay.querySelector('#headProd');
  const avatarProd = overlay.querySelector('#avatarProd');
  const prodDescripcionEl = overlay.querySelector('#prodDescripcion');
  const prodReferenciaEl = overlay.querySelector('#prodReferencia');
  const panelProd = overlay.querySelector('#panelProd');
  const controlsProd = overlay.querySelector('#controlsProd');

  const itemComment = overlay.querySelector('#itemComment');
  const reviewBox = overlay.querySelector('#vencReviewBox');
  const comentarioInput = overlay.querySelector('#vencComentario');
  const confirmBtn = overlay.querySelector('#vencConfirm');

  const photoView = overlay.querySelector('#vencPhotoView');
  const photoSourceRow = overlay.querySelector('#vencPhotoSourceRow');
  const photoCameraInput = overlay.querySelector('#vencPhotoCameraInput');
  const photoGalleryInput = overlay.querySelector('#vencPhotoGalleryInput');
  const photoThumbRow = overlay.querySelector('#vencPhotoThumbRow');
  const photoThumbEl = overlay.querySelector('#vencPhotoThumb');
  const photoRemoveBtn = overlay.querySelector('#vencPhotoRemove');
  const photoConfirmBtn = overlay.querySelector('#vencPhotoConfirm');

  // --- Nav de ubicación (flechas) ---
  let currentIndex = Math.max(0, slides.findIndex((i) => i.key === initialItem.key));

  function updateLocNavButtons() {
    locPrev.disabled = currentIndex === 0;
    locNext.disabled = currentIndex === slides.length - 1;
  }
  updateLocNavButtons();

  function goToIndex(nextIndex) {
    if (nextIndex < 0 || nextIndex >= slides.length) return;
    currentIndex = nextIndex;
    updateLocNavButtons();
    onIndexChange?.(currentIndex);
    const next = slides[currentIndex];
    if (next.key !== item.key) loadItem(next);
  }
  locPrev.addEventListener('click', () => goToIndex(currentIndex - 1));
  locNext.addEventListener('click', () => goToIndex(currentIndex + 1));

  // Stage de cámara compartido, se mueve entero entre Caja/Producto sin
  // recrear el stream. Linterna/teclado viven en el stage (no en <video>)
  // para seguir tocables con la cámara oculta en modo manual.
  const cameraStage = document.createElement('div');
  cameraStage.className = 'scan-camera-stage';
  cameraStage.innerHTML = `
    <div class="scan-camera" id="cameraMount" title="Tocar para apagar/prender la cámara">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-line"></div>
      <div class="scan-flash" id="scanFlash">${icon('check', 32)}</div>
      <div class="scan-mismatch" id="scanMismatch">${icon('alertTriangle', 14)}<span id="scanMismatchText"></span></div>
      <p class="scan-hint" id="scanHint" hidden></p>
    </div>
    <button class="btn-icon scan-torch venc-camera-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 18)}</button>
    <button type="button" class="btn-icon venc-camera-keyboard" id="scanKeyboardBtn" title="Ingresar código a mano">${icon('keyboard', 18)}</button>
    <form class="venc-camera-manual" id="scanManualRow">
      <button type="button" class="venc-camera-manual-back" id="scanManualBack" title="Volver a la cámara">${icon('camera', 16)}</button>
      <input type="text" inputmode="numeric" id="scanManualInput" placeholder="Ingresar código" autocomplete="off" />
      <button type="submit" class="venc-camera-manual-submit" title="Confirmar">${icon('check', 16)}</button>
    </form>
  `;
  const cameraMount = cameraStage.querySelector('#cameraMount');
  const videoEl = cameraStage.querySelector('#scanVideo');
  const hintEl = cameraStage.querySelector('#scanHint');
  const torchBtn = cameraStage.querySelector('#scanTorch');
  const keyboardBtn = cameraStage.querySelector('#scanKeyboardBtn');
  const manualRow = cameraStage.querySelector('#scanManualRow');
  const manualBackBtn = cameraStage.querySelector('#scanManualBack');
  const manualInput = cameraStage.querySelector('#scanManualInput');
  const flashEl = cameraStage.querySelector('#scanFlash');
  const mismatchEl = cameraStage.querySelector('#scanMismatch');
  const mismatchTextEl = cameraStage.querySelector('#scanMismatchText');
  let mismatchTimer = null;

  function playFlash() {
    flashEl.classList.remove('is-playing');
    void flashEl.offsetWidth; // fuerza reflow para poder re-disparar la animación seguida
    flashEl.classList.add('is-playing');
  }

  // Insignia flotante sobre la cámara (position:absolute): aparecer/
  // desaparecer nunca achica el espacio de la cámara ni mueve nada alrededor.
  function showMismatch(raw) {
    mismatchTextEl.textContent = truncate(raw);
    mismatchEl.classList.add('is-visible');
    clearTimeout(mismatchTimer);
    mismatchTimer = setTimeout(() => mismatchEl.classList.remove('is-visible'), 2200);
  }

  // Modo manual: técnica FLIP — mide el alto ANTES de cambiar nada, aplica
  // el cambio, mide el alto DESPUÉS y anima entre esos valores (flex-grow/
  // flex-basis no da una transición de alto fiable entre navegadores).
  let manualAnimCleanup = null;
  function setManualMode(active) {
    // Guard necesario: closeManualInput() se llama "por las dudas" en varios
    // puntos aunque el modo ya esté apagado. Sin este freno, la medición de
    // alto podía ocurrir con el panel vacío (alto mal capturado), sin una
    // transición real de por medio nunca dispara "transitionend", y el
    // cleanup que libera el height inline queda pegado para siempre.
    if (active === cameraStage.classList.contains('is-manual')) return;
    const activeItem = openKey === 'caja' ? itemCaja : (openKey === 'prod' ? itemProd : null);
    keyboardBtn.classList.toggle('is-active', active);
    scanner.setPaused(active);

    if (manualAnimCleanup) manualAnimCleanup();

    if (!activeItem) {
      cameraStage.classList.toggle('is-manual', active);
    } else {
      const fromHeight = activeItem.getBoundingClientRect().height;
      cameraStage.classList.toggle('is-manual', active);
      activeItem.classList.toggle('is-manual-active', active);
      const toHeight = activeItem.getBoundingClientRect().height;

      activeItem.style.flex = 'none';
      activeItem.style.height = `${fromHeight}px`;
      void activeItem.offsetHeight; // fuerza reflow antes de animar
      activeItem.style.transition = 'height 280ms cubic-bezier(.22, 1, .36, 1)';
      activeItem.style.height = `${toHeight}px`;

      const cleanup = () => {
        activeItem.style.transition = '';
        activeItem.style.height = '';
        activeItem.style.flex = '';
        activeItem.removeEventListener('transitionend', onEnd);
        manualAnimCleanup = null;
      };
      const onEnd = (e) => {
        if (e.propertyName === 'height' && e.target === activeItem) cleanup();
      };
      activeItem.addEventListener('transitionend', onEnd);
      manualAnimCleanup = cleanup;
    }

    if (active) {
      manualInput.value = '';
      manualInput.focus();
    }
  }
  function closeManualInput() {
    setManualMode(false);
  }
  keyboardBtn.addEventListener('click', () => setManualMode(true));
  manualBackBtn.addEventListener('click', () => setManualMode(false));
  manualRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = manualInput.value.trim();
    if (!value) return;
    handleCode(value);
    manualInput.value = '';
  });

  // No mover el stage si ya está en destino: aunque un .prepend de más no
  // relanza la cámara, sí corta y reinicia la animación de la línea de escaneo.
  function moveCameraTo(target) {
    closeManualInput();
    if (cameraStage.parentElement !== target) target.prepend(cameraStage);
  }

  let openKey = null; // 'caja' | 'prod' | null
  let fotoViewOpen = false;
  const stateOf = { caja: 'pending', prod: 'locked' };
  let submitting = false;
  let photoDataUrl = null;

  function setItemState(key, state) {
    stateOf[key] = state;
    (key === 'caja' ? itemCaja : itemProd).dataset.state = state;
  }

  function setAvatarDone(key) {
    (key === 'caja' ? avatarCaja : avatarProd).innerHTML = icon('check', 18);
  }

  function setOpen(key, isOpen) {
    const itemEl = key === 'caja' ? itemCaja : itemProd;
    const panelEl = key === 'caja' ? panelCaja : panelProd;
    itemEl.classList.toggle('is-open', isOpen);
    panelEl.hidden = !isOpen;
    if (!isOpen) {
      // Corta de una la animación de modo manual si estaba a mitad de camino,
      // para no dejar estilos inline colgados (height/transition/flex).
      itemEl.classList.remove('is-manual-active');
      if (manualAnimCleanup) { manualAnimCleanup(); manualAnimCleanup = null; }
    }
  }

  function renderCajaControls() {
    controlsCaja.innerHTML = '';
  }

  function renderProdScanControls() {
    controlsProd.innerHTML = `
      <button type="button" class="venc-val-skip" id="skipProd">${icon('ban', 15)} No lo encuentro — reportar faltante</button>
    `;
    controlsProd.querySelector('#skipProd').addEventListener('click', enterFotoMode);
  }

  function openAccordion(key) {
    if (openKey && openKey !== key) setOpen(openKey, false);
    openKey = key;
    setOpen(key, true);
    clearTimeout(mismatchTimer);
    mismatchEl.classList.remove('is-visible');
    moveCameraTo(key === 'caja' ? panelCaja : panelProd);
    scanner.setPaused(false);
    scanner.resumeView();
    if (key === 'caja') renderCajaControls();
    else renderProdScanControls();
  }

  function closeAccordion(key) {
    if (openKey === key) openKey = null;
    setOpen(key, false);
  }

  headCaja.addEventListener('click', () => {
    if (stateOf.caja !== 'pending' || openKey === 'caja') return;
    openAccordion('caja');
  });
  headProd.addEventListener('click', () => {
    if (stateOf.prod !== 'pending' || openKey === 'prod') return;
    openAccordion('prod');
  });

  // Reportar faltante reemplaza solo el contenedor de Producto y exige
  // foto (input file nativo, cámara o galería). La cámara compartida solo
  // se pausa, nunca se mueve, para seguir donde estaba si se cancela.
  function enterFotoMode() {
    fotoViewOpen = true;
    photoDataUrl = null;
    closeManualInput();
    photoCameraInput.value = '';
    photoGalleryInput.value = '';
    photoThumbRow.hidden = true;
    photoConfirmBtn.disabled = true;
    photoSourceRow.classList.remove('is-busy');
    itemProd.hidden = true;
    photoView.hidden = false;
    scanner.setPaused(true);
  }

  function exitFotoMode() {
    fotoViewOpen = false;
    photoDataUrl = null;
    photoView.hidden = true;
    itemProd.hidden = false;
    scanner.setPaused(false);
  }

  overlay.querySelector('#vencPhotoCancel').addEventListener('click', exitFotoMode);

  // Achica la foto antes de convertirla a data URL: el body JSON tiene un
  // límite de 4mb (ver server/index.js). createImageBitmap() decodifica
  // mucho más rápido que un <img> con fotos de cámara modernas (10+ MP);
  // fallback a Image+canvas si no está disponible.
  const PHOTO_MAX_DIM = 1280;
  const PHOTO_QUALITY = 0.6;
  async function resizeImageFile(file) {
    const scaleFor = (w, h) => Math.min(1, PHOTO_MAX_DIM / Math.max(w, h));
    if (window.createImageBitmap) {
      const bitmap = await createImageBitmap(file);
      const s = scaleFor(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * s);
      canvas.height = Math.round(bitmap.height * s);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const s = scaleFor(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * s);
        canvas.height = Math.round(img.height * s);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('IMAGE_LOAD_FAILED')); };
      img.src = objectUrl;
    });
  }

  // `photoRequestId` descarta procesamiento que llegue tarde (dos toques
  // seguidos, o elegir de nuevo mientras el anterior procesa), evitando que
  // un resultado viejo pise al más nuevo. `file.size === 0` se descarta
  // directo: algunos navegadores móviles disparan `change` con un archivo
  // vacío (0 bytes) si se cancela la cámara sin tomar nada.
  let photoRequestId = 0;
  async function handlePhotoFile(file) {
    if (!file || !file.size) return;
    const requestId = ++photoRequestId;
    photoSourceRow.classList.add('is-busy');
    try {
      const dataUrl = await resizeImageFile(file);
      if (requestId !== photoRequestId) return;
      photoDataUrl = dataUrl;
      photoThumbEl.src = photoDataUrl;
      photoThumbRow.hidden = false;
      photoConfirmBtn.disabled = false;
      if (navigator.vibrate) navigator.vibrate(35);
    } catch {
      if (requestId === photoRequestId) showToast('No se pudo procesar la foto. Probá de nuevo.', { variant: 'warn' });
    } finally {
      if (requestId === photoRequestId) photoSourceRow.classList.remove('is-busy');
    }
  }
  photoCameraInput.addEventListener('change', () => handlePhotoFile(photoCameraInput.files[0]));
  photoGalleryInput.addEventListener('change', () => handlePhotoFile(photoGalleryInput.files[0]));

  photoRemoveBtn.addEventListener('click', () => {
    photoDataUrl = null;
    photoCameraInput.value = '';
    photoGalleryInput.value = '';
    photoThumbRow.hidden = true;
    photoConfirmBtn.disabled = true;
  });

  photoConfirmBtn.addEventListener('click', () => {
    if (!photoDataUrl) return;
    finishValidation('faltante', 'Faltante', photoDataUrl);
  });

  // Se arma recién en unlockComment(), nunca antes: con el contenedor oculto
  // (display:none) fitProdDescription() mide alto 0 y no llega a achicar la
  // fuente.
  function renderCommentInfo(it) {
    const um = it.unidadmedida ? ` ${it.unidadmedida}` : '';
    reviewBox.innerHTML = `
      <div class="venc-comment-head">
        <span class="venc-acc-avatar">${icon('clock', 18)}</span>
        <p class="venc-comment-desc" id="commentDescripcion">${escapeHtml(it.descripcion || 'Producto sin descripción')}</p>
      </div>
      <div class="reg-info-grid venc-review-grid">
        <div class="reg-info-cell">
          <span class="reg-info-label">Saldo</span>
          <span class="reg-info-value">${escapeHtml(formatQty(it.saldo))}${escapeHtml(um)}</span>
        </div>
        <div class="reg-info-cell">
          <span class="reg-info-label">Pedprov</span>
          <span class="reg-info-value">${escapeHtml(it.pedprov || '-')}</span>
        </div>
        <div class="reg-info-cell">
          <span class="reg-info-label">Vencimiento</span>
          <span class="reg-info-value">${escapeHtml(it.fv || '-')}</span>
        </div>
      </div>
      ${urgencyBannerHTML(it)}
    `;
    fitProdDescription(reviewBox.querySelector('#commentDescripcion'));
  }

  // Sin foco automático: el operario ya viene de escanear.
  function unlockComment() {
    itemComment.hidden = false;
    renderCommentInfo(item);
    comentarioInput.disabled = false;
    scanner.setPaused(true);
    scanner.pauseView();
  }

  function markDone(key) {
    closeManualInput();
    setItemState(key, 'done');
    setAvatarDone(key);
    closeAccordion(key);
    (key === 'caja' ? controlsCaja : controlsProd).innerHTML = '';
    if (key === 'caja') {
      cajaHeadTitleEl.textContent = 'Ubicación confirmada';
      cajaHeadSubEl.hidden = true;
      setItemState('prod', 'pending');
      openAccordion('prod');
      showToast('Caja verificada — ahora escaneá el producto.');
    } else {
      prodDescripcionEl.textContent = 'Artículo confirmado';
      prodDescripcionEl.style.fontSize = '';
      prodReferenciaEl.hidden = true;
      unlockComment();
    }
  }

  // allowDun: solo el paso "Producto" — el escaneado puede ser el DUN
  // (bulto) del mismo producto, no solo su referencia de unidad (ver
  // matchesCode en shared/js/product-catalog.js). "Caja" es una
  // ubicación física, nunca un código de producto, así que no aplica.
  function checkMatch(key, raw, expected, allowDun) {
    if (!expected || norm(raw) === norm(expected) || (allowDun && matchesCode(raw, expected))) {
      if (navigator.vibrate) navigator.vibrate(35);
      playFlash();
      markDone(key);
      return;
    }
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    showMismatch(raw);
  }

  function handleCode(raw) {
    if (fotoViewOpen) return;
    if (openKey === 'caja') checkMatch('caja', raw, item.caja, false);
    else if (openKey === 'prod') checkMatch('prod', raw, item.referencia, true);
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox: cameraMount, torchBtn, hintEl,
    onCode: (code) => handleCode(code),
  });

  comentarioInput.addEventListener('input', () => {
    confirmBtn.disabled = !comentarioInput.value.trim();
  });
  confirmBtn.addEventListener('click', () => {
    const texto = comentarioInput.value.trim();
    if (!texto) return;
    finishValidation('otro', texto, null);
  });

  // Único punto de guardado (Confirmar Observación o Confirmar faltante).
  // Optimista: onValidated avanza YA con la lista local, sin esperar al
  // servidor. store.validate corre en paralelo; si falla, onValidateError
  // avisa para reincorporar el ítem a la cola.
  function finishValidation(motivo, texto, photoUrl) {
    if (submitting) return;
    submitting = true;
    if (navigator.vibrate) navigator.vibrate(35);
    const validatedItem = item;
    // `item` es la MISMA referencia que vive en state.items de list-view.js
    // (pendingItems nunca clona) — completar estos campos acá los deja bien
    // en los dos lados. Sin esto, abrir "Validado" en la ventana optimista
    // mostraba motivo/fecha vacíos.
    validatedItem.motivo = motivo;
    validatedItem.motivoDetalle = texto;
    validatedItem.validatedAt = new Date().toISOString();
    validatedItem.validatedBy = currentUser()?.username || null;
    if (photoUrl) validatedItem.fotoUrl = photoUrl;
    const freshQueue = onValidated(validatedItem);
    submitting = false;
    if (Array.isArray(freshQueue)) refreshQueue(freshQueue);

    store.validate(validatedItem, motivo, texto, photoUrl).catch(() => {
      validatedItem.motivo = null;
      validatedItem.motivoDetalle = null;
      validatedItem.validatedAt = null;
      validatedItem.validatedBy = null;
      if (photoUrl) validatedItem.fotoUrl = null;
      showToast('No se pudo guardar la validación. Volvé a intentarlo.', { variant: 'warn' });
      onValidateError?.(validatedItem);
    });
  }

  // Si el ítem actual sigue en la cola nueva, solo actualiza los límites de
  // las flechas; si no, avanza al mismo índice (o al último si se acortó).
  function refreshQueue(newSlides) {
    slides = newSlides;
    if (!slides.length) {
      onEmpty?.();
      return;
    }
    const idx = slides.findIndex((s) => s.key === item.key);
    if (idx !== -1) {
      currentIndex = idx;
      updateLocNavButtons();
      onIndexChange?.(currentIndex);
      return;
    }
    currentIndex = Math.min(currentIndex, slides.length - 1);
    updateLocNavButtons();
    onIndexChange?.(currentIndex);
    loadItem(slides[currentIndex]);
  }

  function flashDataSwap(el) {
    el.classList.remove('venc-data-swap');
    void el.offsetWidth; // fuerza reflow para poder re-disparar la animación seguida
    el.classList.add('venc-data-swap');
  }

  // Reinicia el estado por-ítem sin recrear la cámara ni pedir permiso.
  function loadItem(newItem) {
    item = newItem;
    closeManualInput();
    if (fotoViewOpen) exitFotoMode();

    currentIndex = Math.max(0, slides.findIndex((i) => i.key === item.key));
    updateLocNavButtons();

    locUbicacionEl.textContent = item.ubicacion || '-';
    locUbicacionEl.className = `venc-loc-ubicacion ${locSizeClass(item.ubicacion)}`;
    locCajaNumeroEl.textContent = item.caja || '-';
    prodDescripcionEl.textContent = item.descripcion || 'Producto sin descripción';
    fitProdDescription(prodDescripcionEl);
    const prodUm = item.unidadmedida ? ` ${item.unidadmedida}` : '';
    prodReferenciaEl.innerHTML = `
      <span class="venc-prod-ref-item venc-prod-ref-referencia">${iconSolid('barcodeSolid', 13)}${escapeHtml(item.referencia || '-')}</span>
      <span class="venc-prod-ref-item venc-prod-ref-cantidad">${iconSolid('caja', 13)}${escapeHtml(formatQty(item.saldo))}${escapeHtml(prodUm)}</span>
    `;
    prodReferenciaEl.hidden = false;
    flashDataSwap(locInfoEl);

    openKey = null;
    setItemState('caja', 'pending');
    setItemState('prod', 'locked');
    cajaHeadTitleEl.textContent = 'Confirmar ubicación';
    cajaHeadSubEl.hidden = false;
    avatarCaja.innerHTML = icon('clock', 18);
    avatarProd.innerHTML = icon('clock', 18);
    setOpen('caja', false);
    setOpen('prod', false);

    itemComment.hidden = true;
    reviewBox.innerHTML = '';
    comentarioInput.value = '';
    comentarioInput.disabled = true;
    confirmBtn.disabled = true;

    openAccordion('caja');
  }

  loadItem(item);
  scanner.start();

  return {
    destroy() { scanner.destroy(); },
    refresh: refreshQueue,
  };
}

// Ficha embebida del modo "Sugerido" (ver list-view.js/drawSuggested):
// se monta una sola vez y queda viva mientras esa pestaña está a la vista.
export function mountSuggestedFlow(container, initialItem, { pendingItems, onValidated, onValidateError, onIndexChange, onEmpty }) {
  const root = document.createElement('div');
  root.className = 'venc-suggest-inline cq-fade-in';
  container.appendChild(root);

  const flow = renderValidationFlow(root, initialItem, {
    pendingItems, onValidated, onValidateError, onIndexChange, onEmpty,
  });

  return {
    destroy() { flow.destroy(); root.remove(); },
    refresh: flow.refresh,
  };
}
