/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Sin header propio: el espacio se lo queda un slider horizontal con
   2 tarjetas (Caja / Producto) — cada una es el círculo tipo avatar
   con su dato principal arriba (ubicación / descripción) y el dato
   clave abajo (número de caja / referencia-EAN). Deslizar con el dedo
   entre las dos es la forma de moverse entre pasos (no hay tap para
   abrir/cerrar): al asentarse una tarjeta en pantalla, el panel de
   abajo (cámara + controles) se actualiza para ese paso. La tarjeta
   de Producto empieza bloqueada (atenuada, y el slider la "rebota" de
   vuelta a Caja si se intenta deslizar hasta ahí) hasta validar Caja
   — es el único paso que nunca se puede saltar, porque confirma que
   el operario está parado frente a la posición correcta. Una vez
   validada Caja, se desbloquea y el slider avanza solo.

   Sin header tampoco hay botón de volver: se cierra con el gesto
   nativo de "atrás" del navegador/teléfono (popstate), como cualquier
   otra pantalla superpuesta de la app.

   Observación (comentario libre, opcional) NO es parte del slider —
   vive fija debajo del panel activo, bloqueada hasta validar Caja y
   Producto. A diferencia de esos dos, nunca se "valida": su ícono
   quedwa "pendiente" (reloj) para siempre.

   Reportar faltante (dentro del paso Producto) exige una foto de la
   posición vacía y reemplaza por completo esta pantalla mientras dura
   (ver .venc-photo-view) — usa la misma cámara ya activa, sin línea
   de escaneo. Confirmar ahí termina la validación entera con el
   motivo "Faltante", sin pasar por Observación.

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

export function openValidation(item, { onDone }) {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="venc-slider" id="vencSlider">
      <div class="venc-slide" data-state="pending" id="slideCaja">
        <span class="venc-slide-avatar" id="avatarCaja">${icon('clock', 26)}</span>
        <strong class="venc-slide-title">${escapeHtml(item.ubicacion || '-')}</strong>
        <span class="venc-slide-sub">${iconSolid('caja', 13)}<span>${escapeHtml(item.caja || '-')}</span></span>
      </div>
      <div class="venc-slide" data-state="locked" id="slideProd">
        <span class="venc-slide-avatar" id="avatarProd">${icon('clock', 26)}</span>
        <strong class="venc-slide-title">${escapeHtml(item.descripcion || 'Producto sin descripción')}</strong>
        <span class="venc-slide-sub">${escapeHtml(item.referencia || '-')} - ${escapeHtml(item.ean || '-')}</span>
      </div>
    </div>
    <div class="venc-slider-dots">
      <span class="venc-slider-dot is-active" id="dotCaja"></span>
      <span class="venc-slider-dot" id="dotProd"></span>
    </div>
    <div class="scan-sheet cq-sheet venc-active-panel" id="vencActivePanel">
      <div class="venc-acc-panel" id="panelActive">
        <div class="venc-acc-controls" id="controlsActive"></div>
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

  const slider = overlay.querySelector('#vencSlider');
  const sliderDots = overlay.querySelector('.venc-slider-dots');
  const slideCaja = overlay.querySelector('#slideCaja');
  const slideProd = overlay.querySelector('#slideProd');
  const avatarCaja = overlay.querySelector('#avatarCaja');
  const avatarProd = overlay.querySelector('#avatarProd');
  const dotCaja = overlay.querySelector('#dotCaja');
  const dotProd = overlay.querySelector('#dotProd');

  const panelActive = overlay.querySelector('#panelActive');
  const controlsActive = overlay.querySelector('#controlsActive');

  const itemComment = overlay.querySelector('#itemComment');
  const panelComment = overlay.querySelector('#panelComment');
  const comentarioInput = overlay.querySelector('#vencComentario');
  const confirmBtn = overlay.querySelector('#vencConfirm');

  const vencActivePanel = overlay.querySelector('#vencActivePanel');
  const photoView = overlay.querySelector('#vencPhotoView');
  const photoFrame = overlay.querySelector('#vencPhotoFrame');
  const photoImgEl = overlay.querySelector('#vencPhotoImg');
  const photoCaptureRow = overlay.querySelector('#vencPhotoCaptureRow');
  const photoConfirmActions = overlay.querySelector('#vencPhotoConfirmActions');

  // Cámara única (video + línea + destello + linterna) reutilizada
  // entre Caja y Producto — sin header, la linterna se muestra flotando
  // sobre la propia cámara en vez de en una barra superior. Se mueve
  // solo para "reportar faltante" (ver enterFotoMode); entre Caja y
  // Producto se queda fija en panelActive, que es el único destino.
  const cameraMount = document.createElement('div');
  cameraMount.className = 'scan-camera';
  cameraMount.title = 'Tocar para apagar/prender la cámara';
  cameraMount.innerHTML = `
    <video id="scanVideo" autoplay playsinline muted></video>
    <div class="scan-line"></div>
    <button class="btn-icon scan-torch venc-camera-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 18)}</button>
    <div class="scan-flash" id="scanFlash">${icon('check', 32)}</div>
    <div class="scan-mismatch" id="scanMismatch">${icon('alertTriangle', 14)}<span id="scanMismatchText"></span></div>
    <p class="scan-hint" id="scanHint" hidden></p>
  `;
  panelActive.prepend(cameraMount);
  const videoEl = cameraMount.querySelector('#scanVideo');
  const hintEl = cameraMount.querySelector('#scanHint');
  const torchBtn = cameraMount.querySelector('#scanTorch');
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
  // lugar en el flujo) — aparecer/desaparecer nunca achica el espacio
  // de la cámara ni mueve nada alrededor.
  function showMismatch(raw) {
    mismatchTextEl.textContent = truncate(raw);
    mismatchEl.classList.add('is-visible');
    clearTimeout(mismatchTimer);
    mismatchTimer = setTimeout(() => mismatchEl.classList.remove('is-visible'), 2200);
  }

  let activeKey = 'caja'; // 'caja' | 'prod'
  let fotoViewOpen = false;
  const stateOf = { caja: 'pending', prod: 'locked' };
  let submitting = false;
  let photoDataUrl = null;

  function setSlideState(key, state) {
    stateOf[key] = state;
    (key === 'caja' ? slideCaja : slideProd).dataset.state = state;
  }

  function setAvatarDone(key) {
    (key === 'caja' ? avatarCaja : avatarProd).innerHTML = icon('check', 26);
  }

  function renderCajaControls() {
    controlsActive.innerHTML = '';
  }

  function renderProdScanControls() {
    controlsActive.innerHTML = `
      <button type="button" class="venc-val-skip" id="skipProd">${icon('ban', 15)} No lo encuentro — reportar faltante</button>
    `;
    controlsActive.querySelector('#skipProd').addEventListener('click', enterFotoMode);
  }

  // Deslizar hasta acá desde Caja (o al validarla) actualiza el panel
  // de abajo para este paso — nunca hace falta abrir/cerrar nada a
  // mano, la tarjeta que queda asentada en pantalla ES el paso activo.
  function activateSlide(key) {
    activeKey = key;
    dotCaja.classList.toggle('is-active', key === 'caja');
    dotProd.classList.toggle('is-active', key === 'prod');
    clearTimeout(mismatchTimer);
    mismatchEl.classList.remove('is-visible');
    scanner.setPaused(false);
    scanner.resumeView();
    if (key === 'caja') renderCajaControls();
    else renderProdScanControls();
  }

  // Detecta cuándo el deslizar se "asienta" en una tarjeta (debounce
  // sobre scroll, sin depender de scrollend — no está en todos los
  // navegadores). Si se asienta en Producto estando todavía bloqueado,
  // rebota de vuelta a Caja: es el único paso que no se puede saltar.
  let scrollTimer = null;
  slider.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const index = Math.round(slider.scrollLeft / slider.clientWidth);
      const key = index >= 1 ? 'prod' : 'caja';
      if (key === 'prod' && stateOf.prod === 'locked') {
        slider.scrollTo({ left: 0, behavior: 'smooth' });
        return;
      }
      if (key !== activeKey) activateSlide(key);
    }, 120);
  });

  // Reportar faltante exige una foto de la posición vacía — reemplaza
  // por completo esta pantalla mientras dura (ver .venc-photo-view en
  // app.css). Usa la misma cámara YA activa (nunca pide permiso de
  // nuevo), sin la línea de escaneo (sacar una foto no es "escanear").
  // Confirmar acá termina la validación entera, sin pasar por
  // Observación — el motivo queda registrado como "Faltante" directo.
  function enterFotoMode() {
    fotoViewOpen = true;
    photoDataUrl = null;
    scanner.setPaused(true); // sin pauseView(): el video sigue en vivo para encuadrar la foto
    cameraMount.classList.add('is-photo-mode');
    photoFrame.classList.remove('is-previewing');
    photoImgEl.removeAttribute('src');
    photoFrame.prepend(cameraMount);
    photoCaptureRow.hidden = false;
    photoConfirmActions.hidden = true;
    vencActivePanel.hidden = true;
    slider.hidden = true;
    sliderDots.hidden = true;
    photoView.hidden = false;
  }

  function exitFotoMode() {
    fotoViewOpen = false;
    photoDataUrl = null;
    cameraMount.classList.remove('is-photo-mode');
    photoView.hidden = true;
    slider.hidden = false;
    sliderDots.hidden = false;
    vencActivePanel.hidden = false;
    panelActive.prepend(cameraMount);
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
  // que Caja/Producto cerrados (solo el header, panel oculto).
  function unlockComment() {
    itemComment.dataset.state = 'unlocked';
    panelComment.hidden = false;
    comentarioInput.disabled = false;
    confirmBtn.disabled = false;
    scanner.setPaused(true);
    scanner.pauseView();
    comentarioInput.focus();
  }

  function markDone(key) {
    setSlideState(key, 'done');
    setAvatarDone(key);
    if (key === 'caja') {
      setSlideState('prod', 'pending');
      activateSlide('prod');
      slider.scrollTo({ left: slider.clientWidth, behavior: 'smooth' });
      showToast('Caja verificada — ahora escaneá el producto.');
    } else {
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
    if (activeKey === 'caja') checkMatch('caja', raw, item.caja);
    else checkMatch('prod', raw, item.referencia);
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

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scanner.destroy();
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
  }

  activateSlide('caja');
  scanner.start();
}
