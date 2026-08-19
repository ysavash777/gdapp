/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Sin header propio. Arriba, un slider horizontal de ubicaciones
   (.venc-loc-slider, misma forma/tamaño redondeado que los demás
   contenedores) — una tarjeta por posición pendiente (pendingItems),
   deslizable con el dedo. Al asentarse en una tarjeta distinta a la
   actual, cambia el ítem que se está validando (loadItem reinicia
   todo el estado, reutilizando la misma cámara ya activa — nunca se
   vuelve a pedir permiso). Debajo, un contenedor de escaneo aparte
   (.venc-scan-box) para el paso de Caja: separado del slider a
   propósito, porque el slider solo identifica DÓNDE estás parado, no
   es un paso que se abra/cierre como Producto/Observación.

   Se cierra únicamente con el gesto nativo de "atrás" del
   navegador/teléfono (popstate).

   Pasos:
     1) Caja — el número escaneado tiene que matchear item.caja. Nunca
        se puede saltar: es el único paso que confirma que el
        operario está parado frente a la posición correcta (por eso
        Producto arranca BLOQUEADO hasta que este se valida).
     2) Producto — descripción + referencia/EAN, mismo acordeón de
        siempre (tap para abrir/cerrar, no forma parte del slider).
        Acá SÍ se puede reportar "faltante" sin escanear (si el
        producto de verdad no está, insistir en escanearlo no tiene
        sentido), pero exige una foto de la posición vacía como
        evidencia.
     3) Observación — se libera recién con 1 y 2 validados. Sin
        motivos predefinidos: texto libre, vacío = "OK". No se valida
        contra nada (es opcional), así que su ícono queda "pendiente"
        para siempre, nunca pasa a "éxito".

   Un solo <video> de cámara se reutiliza en los 3 lugares donde hace
   falta (Caja, Producto, foto de faltante) — se mueve con .prepend,
   nunca se recrea ni se vuelve a pedir permiso. Trae dos botones
   flotando sobre ella (mismo estilo, esquinas opuestas): linterna
   (derecha) y teclado para tipear el código a mano (izquierda) — el
   teclado abre un input chico flotando abajo de la cámara, que pasa
   por el mismo checkMatch() que un código leído por cámara.

   Un match en cualquier paso avanza SOLO, sin pedir confirmación —
   pero se marca fuerte (color de éxito + vibración + destello + toast)
   para que nunca pase desapercibido. El valor esperado nunca se
   muestra de entrada; si hay un desacuerdo, se imprime solo lo leído
   (recortado a 14 caracteres) como insignia flotante sobre la cámara,
   nunca como bloque de texto que deforme el layout.
   ============================================================ */

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import * as store from './store.js';

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

const MISMATCH_MAX_CHARS = 14;
function truncate(v) {
  const s = String(v ?? '');
  return s.length > MISMATCH_MAX_CHARS ? `${s.slice(0, MISMATCH_MAX_CHARS)}…` : s;
}

// Mismo criterio que urgencyBannerHTML() en list-view.js (modo
// Sugerido) — acá se repite el mismo aviso, ya al final del flujo,
// para reforzar la acción a tomar justo antes de escribir la
// observación (que es donde tiene más sentido registrarla si hace
// falta retirar el producto).
function urgencyBannerHTML(it) {
  if (it.isRetirar) {
    return `<div class="venc-suggest-urgency is-${it.severity}">${icon('alertTriangle', 16)} Retirar de ubicación</div>`;
  }
  return `<div class="venc-suggest-urgency is-${it.severity}">${icon('calendarAlert', 16)} Vence en ${it.days} día${it.days === 1 ? '' : 's'}</div>`;
}

export function openValidation(initialItem, { onDone, pendingItems = [] }) {
  let item = initialItem;
  const slides = pendingItems.length ? pendingItems : [initialItem];

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-sheet cq-sheet venc-acc-body" id="vencAccBody">
      <div class="venc-acc-item venc-loc-slider" id="locSlider"></div>

      <div class="venc-scan-box" id="scanBoxCaja">
        <div class="venc-acc-controls" id="controlsCaja"></div>
      </div>

      <div class="venc-acc-item" data-state="locked" id="itemProd">
        <button type="button" class="venc-acc-head" id="headProd">
          <span class="venc-acc-avatar" id="avatarProd">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title" id="prodDescripcion"></strong>
            <span class="venc-acc-head-sub" id="prodReferencia"></span>
          </span>
        </button>
        <div class="venc-acc-panel" id="panelProd" hidden>
          <div class="venc-acc-controls" id="controlsProd"></div>
        </div>
      </div>

      <div class="venc-acc-item" data-state="locked" id="itemComment">
        <div class="venc-acc-head">
          <span class="venc-acc-avatar" id="avatarComment">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title">Observación</strong>
            <span class="venc-acc-head-sub">Opcional</span>
          </span>
        </div>
        <div class="venc-acc-panel" id="panelComment" hidden>
          <div class="venc-review-box" id="vencReviewBox"></div>
          <div class="venc-acc-controls">
            <textarea class="venc-acc-comment-input" id="vencComentario" rows="3" maxlength="200" placeholder="Agregar una observación (opcional)" disabled></textarea>
            <button type="button" class="btn btn-primary btn-block" id="vencConfirm" disabled>Confirmar</button>
          </div>
        </div>
      </div>
    </div>
    <div class="scan-sheet cq-sheet venc-photo-view" id="vencPhotoView" hidden>
      <div class="venc-photo-frame" id="vencPhotoFrame">
        <img class="venc-photo-img" id="vencPhotoImg" alt="Foto de la posición" />
      </div>
      <p class="venc-photo-hint">Encuadrá la posición vacía y tomá la foto — es obligatoria para reportar un faltante.</p>
      <div class="venc-photo-capture-row" id="vencPhotoCaptureRow">
        <button type="button" class="venc-val-skip" id="vencPhotoCancel">${icon('chevronLeft', 15)} Cancelar</button>
        <button type="button" class="btn btn-primary btn-block" id="vencPhotoCapture">${icon('camera', 18)} Tomar foto</button>
      </div>
      <div class="venc-photo-actions" id="vencPhotoConfirmActions" hidden>
        <button type="button" class="btn btn-ghost" id="vencPhotoRetake">Repetir foto</button>
        <button type="button" class="btn btn-danger" id="vencPhotoConfirm">Confirmar faltante</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  history.pushState({ vencValidation: true }, '', location.href);
  let closedByPop = false;
  window.addEventListener('popstate', onPopState);
  function onPopState() {
    closedByPop = true;
    close();
  }

  const locSlider = overlay.querySelector('#locSlider');
  const scanBoxCaja = overlay.querySelector('#scanBoxCaja');
  const controlsCaja = overlay.querySelector('#controlsCaja');

  const itemProd = overlay.querySelector('#itemProd');
  const headProd = overlay.querySelector('#headProd');
  const avatarProd = overlay.querySelector('#avatarProd');
  const prodDescripcionEl = overlay.querySelector('#prodDescripcion');
  const prodReferenciaEl = overlay.querySelector('#prodReferencia');
  const panelProd = overlay.querySelector('#panelProd');
  const controlsProd = overlay.querySelector('#controlsProd');

  const itemComment = overlay.querySelector('#itemComment');
  const panelComment = overlay.querySelector('#panelComment');
  const reviewBox = overlay.querySelector('#vencReviewBox');
  const comentarioInput = overlay.querySelector('#vencComentario');
  const confirmBtn = overlay.querySelector('#vencConfirm');

  const vencAccBody = overlay.querySelector('#vencAccBody');
  const photoView = overlay.querySelector('#vencPhotoView');
  const photoFrame = overlay.querySelector('#vencPhotoFrame');
  const photoImgEl = overlay.querySelector('#vencPhotoImg');
  const photoCaptureRow = overlay.querySelector('#vencPhotoCaptureRow');
  const photoConfirmActions = overlay.querySelector('#vencPhotoConfirmActions');

  // --- Slider de ubicaciones ---
  // Se arma UNA sola vez (no se re-renderiza en cada loadItem, para no
  // perder la posición del scroll) — deslizar y "asentarse" en una
  // tarjeta distinta es lo que dispara loadItem(). El avatar de la
  // tarjeta activa se actualiza in-place (findSlide) a medida que se
  // valida, en vez de vivir en un elemento fijo aparte.
  locSlider.innerHTML = slides.map((it) => `
    <div class="venc-loc-slide" data-key="${escapeHtml(it.key)}" data-state="pending">
      <span class="venc-acc-avatar">${icon('clock', 18)}</span>
      <span class="venc-acc-head-text">
        <strong class="venc-acc-head-title">${escapeHtml(it.ubicacion || '-')}</strong>
        <span class="venc-acc-head-sub">${iconSolid('caja', 13)}<span>${escapeHtml(it.caja || '-')}</span></span>
      </span>
    </div>
  `).join('');
  const initialIndex = Math.max(0, slides.findIndex((i) => i.key === initialItem.key));
  locSlider.scrollLeft = initialIndex * locSlider.clientWidth;

  function findSlide(key) {
    return Array.from(locSlider.children).find((el) => el.dataset.key === key);
  }

  let sliderScrollTimer = null;
  locSlider.addEventListener('scroll', () => {
    clearTimeout(sliderScrollTimer);
    sliderScrollTimer = setTimeout(() => {
      const idx = Math.round(locSlider.scrollLeft / locSlider.clientWidth);
      const next = slides[idx];
      if (next && next.key !== item.key) loadItem(next);
    }, 120);
  });

  // Cámara única (video + línea + destello + linterna + teclado)
  // reutilizada en Caja/Producto/foto — se mueve con .prepend, sin
  // recrearla ni perder el stream. En handheld este bloque no
  // existiría y el resto de la pantalla sigue funcionando igual.
  const cameraMount = document.createElement('div');
  cameraMount.className = 'scan-camera';
  cameraMount.title = 'Tocar para apagar/prender la cámara';
  cameraMount.innerHTML = `
    <video id="scanVideo" autoplay playsinline muted></video>
    <div class="scan-line"></div>
    <button class="btn-icon scan-torch venc-camera-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 18)}</button>
    <button type="button" class="btn-icon venc-camera-keyboard" id="scanKeyboardBtn" title="Ingresar código a mano">${icon('keyboard', 18)}</button>
    <form class="venc-camera-manual" id="scanManualRow" hidden>
      <input type="text" inputmode="numeric" id="scanManualInput" placeholder="Ingresar código" autocomplete="off" />
      <button type="submit" title="Confirmar">${icon('check', 16)}</button>
    </form>
    <div class="scan-flash" id="scanFlash">${icon('check', 32)}</div>
    <div class="scan-mismatch" id="scanMismatch">${icon('alertTriangle', 14)}<span id="scanMismatchText"></span></div>
    <p class="scan-hint" id="scanHint" hidden></p>
  `;
  const videoEl = cameraMount.querySelector('#scanVideo');
  const hintEl = cameraMount.querySelector('#scanHint');
  const torchBtn = cameraMount.querySelector('#scanTorch');
  const keyboardBtn = cameraMount.querySelector('#scanKeyboardBtn');
  const manualRow = cameraMount.querySelector('#scanManualRow');
  const manualInput = cameraMount.querySelector('#scanManualInput');
  const flashEl = cameraMount.querySelector('#scanFlash');
  const mismatchEl = cameraMount.querySelector('#scanMismatch');
  const mismatchTextEl = cameraMount.querySelector('#scanMismatchText');
  let mismatchTimer = null;

  function playFlash() {
    flashEl.classList.remove('is-playing');
    void flashEl.offsetWidth; // fuerza reflow para poder re-disparar la animación seguida
    flashEl.classList.add('is-playing');
  }

  // Insignia flotante SOBRE la cámara (position:absolute, no ocupa
  // lugar en el flujo) — a diferencia de un bloque de texto en los
  // controles, aparecer/desaparecer nunca achica el espacio de la
  // cámara ni mueve nada alrededor.
  function showMismatch(raw) {
    mismatchTextEl.textContent = truncate(raw);
    mismatchEl.classList.add('is-visible');
    clearTimeout(mismatchTimer);
    mismatchTimer = setTimeout(() => mismatchEl.classList.remove('is-visible'), 2200);
  }

  function closeManualInput() {
    manualRow.hidden = true;
    keyboardBtn.classList.remove('is-active');
  }
  keyboardBtn.addEventListener('click', () => {
    const opening = manualRow.hidden;
    manualRow.hidden = !opening;
    keyboardBtn.classList.toggle('is-active', opening);
    if (opening) manualInput.focus();
  });
  manualRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = manualInput.value.trim();
    if (!value) return;
    handleCode(value);
    manualInput.value = '';
  });

  function moveCameraTo(target) {
    closeManualInput();
    target.prepend(cameraMount);
  }

  let openKey = null; // 'caja' | 'prod' | null
  let fotoViewOpen = false;
  const stateOf = { caja: 'pending', prod: 'locked' };
  let submitting = false;
  let photoDataUrl = null;

  function setItemState(key, state) {
    stateOf[key] = state;
    if (key === 'caja') {
      const slide = findSlide(item.key);
      if (slide) slide.dataset.state = state;
    } else {
      itemProd.dataset.state = state;
    }
  }

  function setAvatarDone(key) {
    if (key === 'caja') {
      const slide = findSlide(item.key);
      if (slide) slide.querySelector('.venc-acc-avatar').innerHTML = icon('check', 18);
    } else {
      avatarProd.innerHTML = icon('check', 18);
    }
  }

  // Caja no es un contenedor que se abra/cierre con tap (el slider de
  // arriba solo identifica DÓNDE estás parado) — activarlo simplemente
  // muestra la caja de escaneo separada, siempre que sea el paso
  // vigente. Se desactiva al validarla (o al cambiar de ítem).
  function activateCaja() {
    openKey = 'caja';
    scanBoxCaja.hidden = false;
    clearTimeout(mismatchTimer);
    mismatchEl.classList.remove('is-visible');
    moveCameraTo(scanBoxCaja);
    scanner.setPaused(false);
    scanner.resumeView();
    controlsCaja.innerHTML = '';
  }

  function deactivateCaja() {
    if (openKey === 'caja') openKey = null;
    scanBoxCaja.hidden = true;
  }

  function renderProdScanControls() {
    controlsProd.innerHTML = `
      <button type="button" class="venc-val-skip" id="skipProd">${icon('ban', 15)} No lo encuentro — reportar faltante</button>
    `;
    controlsProd.querySelector('#skipProd').addEventListener('click', enterFotoMode);
  }

  function showProd() {
    openKey = 'prod';
    itemProd.classList.add('is-open');
    panelProd.hidden = false;
    clearTimeout(mismatchTimer);
    mismatchEl.classList.remove('is-visible');
    moveCameraTo(panelProd);
    scanner.setPaused(false);
    scanner.resumeView();
    renderProdScanControls();
  }

  function hideProd() {
    if (openKey === 'prod') openKey = null;
    itemProd.classList.remove('is-open');
    panelProd.hidden = true;
  }

  // Tocar Producto ya abierto no lo contrae — nada más lo cierra
  // (evita cerrar la cámara sin querer).
  headProd.addEventListener('click', () => {
    if (stateOf.prod !== 'pending' || openKey === 'prod') return;
    showProd();
  });

  // Reportar faltante exige una foto de la posición vacía — reemplaza
  // por completo al acordeón mientras dura (ver .venc-photo-view en
  // app.css): meterla adentro del contenedor de Producto lo deformaba,
  // porque tiene que competir por espacio con el resto de la pantalla.
  // Usa la misma cámara YA activa (nunca pide permiso de nuevo), sin
  // la línea de escaneo (sacar una foto no es "escanear"). Confirmar
  // acá termina la validación entera, sin pasar por el contenedor de
  // comentario — el motivo queda registrado como "Faltante" directo.
  function enterFotoMode() {
    fotoViewOpen = true;
    photoDataUrl = null;
    scanner.setPaused(true); // sin pauseView(): el video sigue en vivo para encuadrar la foto
    closeManualInput();
    cameraMount.classList.add('is-photo-mode');
    photoFrame.classList.remove('is-previewing');
    photoImgEl.removeAttribute('src');
    photoFrame.prepend(cameraMount);
    photoCaptureRow.hidden = false;
    photoConfirmActions.hidden = true;
    vencAccBody.hidden = true;
    photoView.hidden = false;
  }

  function exitFotoMode() {
    fotoViewOpen = false;
    photoDataUrl = null;
    cameraMount.classList.remove('is-photo-mode');
    photoView.hidden = true;
    vencAccBody.hidden = false;
    moveCameraTo(panelProd);
    scanner.setPaused(false);
  }

  overlay.querySelector('#vencPhotoCancel').addEventListener('click', exitFotoMode);

  overlay.querySelector('#vencPhotoCapture').addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 640;
    canvas.height = videoEl.videoHeight || 480;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    photoDataUrl = canvas.toDataURL('image/jpeg', 0.6);
    photoImgEl.src = photoDataUrl;
    photoFrame.classList.add('is-previewing');
    photoCaptureRow.hidden = true;
    photoConfirmActions.hidden = false;
    if (navigator.vibrate) navigator.vibrate(35);
  });

  overlay.querySelector('#vencPhotoRetake').addEventListener('click', () => {
    photoDataUrl = null;
    photoFrame.classList.remove('is-previewing');
    photoCaptureRow.hidden = false;
    photoConfirmActions.hidden = true;
  });

  const photoConfirmBtn = overlay.querySelector('#vencPhotoConfirm');
  photoConfirmBtn.addEventListener('click', async () => {
    if (submitting || !photoDataUrl) return;
    submitting = true;
    photoConfirmBtn.disabled = true;
    try {
      await store.validate(item, 'faltante', 'Faltante', photoDataUrl);
      if (navigator.vibrate) navigator.vibrate(35);
      close();
      onDone();
    } catch {
      showToast('No se pudo guardar. Probá de nuevo.', { variant: 'warn' });
      submitting = false;
      photoConfirmBtn.disabled = false;
    }
  });

  // El ícono de Observación queda "pendiente" (reloj) siempre — a
  // diferencia de Caja/Producto, este contenedor no se valida contra
  // nada, así que nunca pasa a "éxito". Mientras el texto no está
  // disponible para escribir, el contenedor tiene el mismo alto/forma
  // que Producto cerrado (solo el header, panel oculto).
  function unlockComment() {
    itemComment.dataset.state = 'unlocked';
    panelComment.hidden = false;
    // Detalle del producto + sugerencia de acción justo antes de
    // escribir la observación — es donde más sentido tiene revisarlo
    // una última vez y, si hace falta, anotar algo al respecto.
    reviewBox.innerHTML = `
      <p class="venc-review-desc">${escapeHtml(item.descripcion || 'Producto sin descripción')}</p>
      <div class="reg-info-grid venc-review-grid">
        <div class="reg-info-cell">
          <span class="reg-info-label">Fecha</span>
          <span class="reg-info-value">${escapeHtml(item.fv || '-')}</span>
        </div>
        <div class="reg-info-cell">
          <span class="reg-info-label">Pedprov</span>
          <span class="reg-info-value">${escapeHtml(item.pedprov || '-')}</span>
        </div>
      </div>
      ${urgencyBannerHTML(item)}
    `;
    comentarioInput.disabled = false;
    confirmBtn.disabled = false;
    scanner.setPaused(true);
    scanner.pauseView();
    comentarioInput.focus();
  }

  function markDone(key) {
    setItemState(key, 'done');
    setAvatarDone(key);
    if (key === 'caja') {
      deactivateCaja();
      controlsCaja.innerHTML = '';
      setItemState('prod', 'pending');
      showProd();
      showToast('Caja verificada — ahora escaneá el producto.');
    } else {
      hideProd();
      controlsProd.innerHTML = '';
      unlockComment();
    }
  }

  function checkMatch(key, raw, expected) {
    if (!expected || norm(raw) === norm(expected)) {
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
    if (openKey === 'caja') checkMatch('caja', raw, item.caja);
    else if (openKey === 'prod') checkMatch('prod', raw, item.referencia);
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox: cameraMount, torchBtn, hintEl,
    onCode: (code) => handleCode(code),
  });

  confirmBtn.addEventListener('click', async () => {
    if (submitting) return;
    submitting = true;
    confirmBtn.disabled = true;
    const texto = comentarioInput.value.trim();
    try {
      await store.validate(item, texto ? 'otro' : 'ok', texto);
      if (navigator.vibrate) navigator.vibrate(35);
      close();
      onDone();
    } catch {
      showToast('No se pudo guardar. Probá de nuevo.', { variant: 'warn' });
      submitting = false;
      confirmBtn.disabled = false;
    }
  });

  // Reinicia todo el estado por-ítem (sin recrear la cámara ni pedir
  // permiso de nuevo) — usado tanto al abrir por primera vez como al
  // deslizar hasta otra tarjeta del slider de arriba.
  function loadItem(newItem) {
    item = newItem;
    if (fotoViewOpen) exitFotoMode();

    prodDescripcionEl.textContent = item.descripcion || 'Producto sin descripción';
    prodReferenciaEl.textContent = `${item.referencia || '-'} - ${item.ean || '-'}`;

    openKey = null;
    setItemState('caja', 'pending');
    setItemState('prod', 'locked');
    avatarProd.innerHTML = icon('clock', 18);
    hideProd();

    itemComment.dataset.state = 'locked';
    panelComment.hidden = true;
    reviewBox.innerHTML = '';
    comentarioInput.value = '';
    comentarioInput.disabled = true;
    confirmBtn.disabled = true;

    activateCaja();
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scanner.destroy();
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
  }

  loadItem(item);
  scanner.start();
}
