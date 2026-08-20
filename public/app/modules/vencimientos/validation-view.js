/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Sin header propio. Arriba de todo, una barra fija solo con las
   flechas de navegación entre posiciones pendientes y el texto
   estático "Ubicación" en el medio (.venc-loc-nav) — no muestra datos
   del ítem, es puramente el control para saltar de a una posición
   (pendingItems) sin cerrar esta pantalla (loadItem reinicia todo el
   estado, reutilizando la misma cámara ya activa — nunca se vuelve a
   pedir permiso).

   Debajo, el acordeón de 3 contenedores de siempre, uno a la vez:
     1) Caja — ubicación + número de caja + avatar de estado, mismo
        patrón exacto que Producto (tap para abrir/cerrar, cámara
        adentro). Nunca se puede saltar: es el único paso que confirma
        que el operario está parado frente a la posición correcta (por
        eso Producto arranca BLOQUEADO hasta que este se valida).
     2) Producto — descripción + referencia/EAN. Acá SÍ se puede
        reportar "faltante" sin escanear (si el producto de verdad no
        está, insistir en escanearlo no tiene sentido), pero exige una
        foto de la posición vacía como evidencia.
     3) Observación — se libera recién con 1 y 2 validados. Sin
        motivos predefinidos: texto libre, vacío = "OK". No se valida
        contra nada (es opcional), así que su ícono queda "pendiente"
        para siempre, nunca pasa a "éxito".

   Abrir un contenedor cierra automáticamente cualquier otro que
   estuviera abierto — pero sin desplazar nada de lugar: el que se abre
   crece hacia el espacio libre de la pantalla, nunca empuja lo que
   sigue. Una vez validado correctamente, el contenedor queda bloqueado
   (no se puede reabrir ni tiene más lógica) y su avatar pasa de
   "pendiente" a "éxito".

   Se cierra únicamente con el gesto nativo de "atrás" del
   navegador/teléfono (popstate).

   Un solo <video> de cámara (envuelto en .scan-camera-stage junto con
   linterna/teclado/input manual) se reutiliza en los 3 lugares donde
   hace falta (Caja, Producto, foto de faltante) — se mueve entero con
   .prepend, nunca se recrea ni se vuelve a pedir permiso. moveCameraTo
   evita mover el stage si ya está en el contenedor destino: aunque no
   relanza nada (ni cámara ni permisos), un .prepend "de más" corta y
   reinicia la animación de la línea de escaneo — se nota feo cada vez
   que se cambiaba de ítem sin necesidad.

   El teclado abre un input chico que reemplaza a la cámara por
   completo (no flota encima): mientras está activo, la cámara se
   oculta y el contenedor entero se achica a la altura justa del
   input, en vez de quedarse con el alto grande que usaba la cámara.
   Volver a la cámara es un botón integrado en el propio input (no un
   botón flotando aparte). Ese input pasa por el mismo checkMatch()
   que un código leído por cámara.

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
      <div class="venc-acc-item venc-loc-nav" id="locNav">
        <button type="button" class="venc-loc-arrow" id="locPrev" title="Posición anterior">${icon('chevronLeft', 20)}</button>
        <span class="venc-loc-label">Seleccionar ubicación</span>
        <button type="button" class="venc-loc-arrow" id="locNext" title="Posición siguiente">${icon('chevronRight', 20)}</button>
      </div>
      <div class="venc-acc-item" data-state="pending" id="itemCaja">
        <button type="button" class="venc-acc-head" id="headCaja">
          <span class="venc-acc-avatar" id="avatarCaja">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text" id="cajaHeadText">
            <strong class="venc-acc-head-title" id="cajaUbicacion"></strong>
            <span class="venc-acc-head-sub">${iconSolid('caja', 13)}<span id="cajaNumero"></span></span>
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

  const locPrev = overlay.querySelector('#locPrev');
  const locNext = overlay.querySelector('#locNext');

  const itemCaja = overlay.querySelector('#itemCaja');
  const headCaja = overlay.querySelector('#headCaja');
  const avatarCaja = overlay.querySelector('#avatarCaja');
  const cajaHeadTextEl = overlay.querySelector('#cajaHeadText');
  const cajaUbicacionEl = overlay.querySelector('#cajaUbicacion');
  const cajaNumeroEl = overlay.querySelector('#cajaNumero');
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
    const next = slides[currentIndex];
    if (next.key !== item.key) loadItem(next);
  }
  locPrev.addEventListener('click', () => goToIndex(currentIndex - 1));
  locNext.addEventListener('click', () => goToIndex(currentIndex + 1));

  // Stage de cámara compartido (video + línea + destello + insignia +
  // linterna + teclado + input manual) — se mueve entero entre Caja,
  // Producto y la foto de faltante, sin recrear nada ni perder el
  // stream. Linterna/teclado viven en el STAGE, no en el <video> en sí,
  // para seguir tocables aunque la cámara esté oculta (modo manual).
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

  // Modo manual: reemplaza la cámara por completo (nunca flota
  // encima) — mientras está activo, se oculta y el CONTENEDOR GRIS
  // ENTERO (no solo la cámara) se achica a la altura justa del input,
  // con una animación real (mismo ancho, mismo radio, solo el alto se
  // mueve). Técnica FLIP: se mide el alto real ANTES de cambiar nada,
  // se aplica el cambio (cámara↔input, y la clase que determina el
  // alto nuevo), se mide el alto real DESPUÉS, y recién ahí se anima
  // de un número al otro — animar flex-grow/flex-basis directamente
  // no da una transición de alto fiable entre navegadores. Pausa la
  // detección: no tiene sentido seguir leyendo frames de una cámara
  // escondida.
  let manualAnimCleanup = null;
  function setManualMode(active) {
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
      // Curva suave (ease-out pronunciado, sin frenada seca al final)
      // en vez del material-standard más "mecánico" de antes.
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
  // Volver a la cámara vive integrado en el propio input (no flotando
  // encima, superpuesto y descolgado como el botón de teclado — que
  // además solo tiene sentido para ABRIR el modo manual, no para
  // cerrarlo).
  manualBackBtn.addEventListener('click', () => setManualMode(false));
  manualRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = manualInput.value.trim();
    if (!value) return;
    handleCode(value);
    manualInput.value = '';
  });

  // No mover el stage si ya está en el destino: un .prepend "de más"
  // no relanza la cámara ni pide permiso de nuevo (sigue siendo el
  // mismo <video>/stream), pero SÍ corta y reinicia la animación de
  // la línea de escaneo — se notaba feo cada vez que se cambiaba de
  // ítem con el mismo contenedor ya activo.
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
      // Si se cierra con una animación de modo manual a mitad de
      // camino (p. ej. se validó justo mientras estaba escribiendo a
      // mano), la termina de una para no dejar estilos inline
      // colgados (height/transition/flex) en un contenedor que ya no
      // se ve.
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

  // Tocar un contenedor ya abierto no lo contrae — solo abrir OTRO lo
  // cierra (ver openAccordion). Evita cerrar la cámara sin querer.
  headCaja.addEventListener('click', () => {
    if (stateOf.caja !== 'pending' || openKey === 'caja') return;
    openAccordion('caja');
  });
  headProd.addEventListener('click', () => {
    if (stateOf.prod !== 'pending' || openKey === 'prod') return;
    openAccordion('prod');
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
    closeManualInput();
    cameraStage.classList.add('is-photo-mode');
    photoFrame.classList.remove('is-previewing');
    photoImgEl.removeAttribute('src');
    photoFrame.prepend(cameraStage);
    photoCaptureRow.hidden = false;
    photoConfirmActions.hidden = true;
    vencAccBody.hidden = true;
    photoView.hidden = false;
    scanner.setPaused(true); // sin pauseView(): el video sigue en vivo para encuadrar la foto
  }

  function exitFotoMode() {
    fotoViewOpen = false;
    photoDataUrl = null;
    cameraStage.classList.remove('is-photo-mode');
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
  // que Caja/Producto cerrados (solo el header, panel oculto).
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
    closeManualInput();
    setItemState(key, 'done');
    setAvatarDone(key);
    closeAccordion(key);
    (key === 'caja' ? controlsCaja : controlsProd).innerHTML = '';
    if (key === 'caja') {
      setItemState('prod', 'pending');
      openAccordion('prod');
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

  // Destello mínimo (fade + corrimiento leve) al cambiar el dato de
  // ubicación/SKU — sin esto, entre posiciones parecidas no se
  // percibía que el intercambio había ocurrido de verdad.
  function flashDataSwap(el) {
    el.classList.remove('venc-data-swap');
    void el.offsetWidth; // fuerza reflow para poder re-disparar la animación seguida
    el.classList.add('venc-data-swap');
  }

  // Reinicia todo el estado por-ítem (sin recrear la cámara ni pedir
  // permiso de nuevo) — usado tanto al abrir por primera vez como al
  // navegar con las flechas de arriba.
  function loadItem(newItem) {
    item = newItem;
    closeManualInput();
    if (fotoViewOpen) exitFotoMode();

    currentIndex = Math.max(0, slides.findIndex((i) => i.key === item.key));
    updateLocNavButtons();

    cajaUbicacionEl.textContent = item.ubicacion || '-';
    cajaNumeroEl.textContent = item.caja || '-';
    // Punto tipo viñeta, no guion — separador entre referencia y EAN.
    prodDescripcionEl.textContent = item.descripcion || 'Producto sin descripción';
    prodReferenciaEl.textContent = `${item.referencia || '-'} • ${item.ean || '-'}`;
    // Solo en Ubicación (Caja) — Producto/SKU no forma parte de la
    // navegación con flechas, así que no hace falta destacarlo ahí.
    flashDataSwap(cajaHeadTextEl);

    openKey = null;
    setItemState('caja', 'pending');
    setItemState('prod', 'locked');
    avatarCaja.innerHTML = icon('clock', 18);
    avatarProd.innerHTML = icon('clock', 18);
    setOpen('caja', false);
    setOpen('prod', false);

    itemComment.dataset.state = 'locked';
    panelComment.hidden = true;
    reviewBox.innerHTML = '';
    comentarioInput.value = '';
    comentarioInput.disabled = true;
    confirmBtn.disabled = true;

    openAccordion('caja');
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
