/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   El acordeón (nav de ubicación + Caja/Producto/Observación) se
   arma en renderValidationFlow(), y se monta de DOS formas distintas
   según quién llame:
     - openValidation()     → modal a pantalla completa (.scan-overlay,
       fixed/inset:0) con historial (back cierra), usado al tocar un
       ítem en la lista "Pendiente" — ahí sí hace falta un cierre
       explícito para volver a la lista.
     - mountSuggestedFlow() → embebido en el flujo normal de la página,
       DEBAJO del toggle Sugerido/Pendiente/Validado (ver list-view.js,
       modo "Sugerido"): ya no hace falta tocar "Validar" para entrar,
       esta ficha ES el modo Sugerido. No hay overlay ni historial —
       "confirmar" no cierra nada, la propia ficha relee la cola
       (onValidated) y pasa sola a la siguiente posición pendiente.
   Las dos comparten toda la lógica interna (cámara, acordeón, modo
   manual, foto de faltante) — lo único que cambia es qué pasa cuando
   un ítem termina de validarse (ver onValidated en cada export).

   Arriba de todo, una barra solo con las flechas de navegación entre
   posiciones pendientes y el texto estático "Ubicación" en el medio
   (.venc-loc-nav) — no muestra datos del ítem, es puramente el
   control para saltar de a una posición (pendingItems) sin perder el
   estado (loadItem reinicia todo el estado, reutilizando la misma
   cámara ya activa — nunca se vuelve a pedir permiso).

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
     3) Observación — contenedor de cierre, oculto por completo hasta
        validar 1 y 2. Repite la info del producto (descripción,
        saldo, pedprov, vencimiento) para la última revisión y pide
        una observación en texto libre — obligatoria, no se puede
        confirmar vacía. No se valida contra nada, así que no tiene
        avatar de estado propio.

   Abrir un contenedor cierra automáticamente cualquier otro que
   estuviera abierto — pero sin desplazar nada de lugar: el que se abre
   crece hacia el espacio libre de la pantalla, nunca empuja lo que
   sigue. Una vez validado correctamente, el contenedor queda bloqueado
   (no se puede reabrir ni tiene más lógica) y su avatar pasa de
   "pendiente" a "éxito".

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

// Mismo criterio que formatQty() en list-view.js.
function formatQty(saldo) {
  if (saldo == null) return '-';
  return saldo.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// La ubicación en la barra de navegación (arriba de todo) tiene que
// entrar siempre en una sola línea, sin importar el largo del código
// — nunca deformar el contenedor ni saltar de línea. Mismo criterio
// que el resto de "medidas fijas" de la app (ver qtySizeClass/
// chipSizeClass en otras herramientas): se va escalando el tamaño de
// fuente en vez de cortar texto.
function locSizeClass(text) {
  const len = String(text || '').length;
  if (len <= 8) return '';
  if (len <= 11) return 'is-md';
  if (len <= 14) return 'is-sm';
  return 'is-xs';
}

// La descripción del producto no tiene un largo predecible como la
// ubicación (es texto libre) — achicar por escalones fijos según
// cantidad de caracteres no alcanza (dos textos del mismo largo
// pueden ocupar distinto según el ancho de cada letra/palabra). Se
// mide de verdad: con el texto puesto a tamaño normal y recortado a 2
// líneas (line-clamp), scrollHeight > clientHeight indica que sigue
// sin entrar completo — de a un pixel, hasta que entre o se llegue al
// piso mínimo (nunca desaparece del todo, en el peor caso queda algo
// recortado por la elipsis del line-clamp, red de seguridad final).
const PROD_DESC_MIN_FONT_PX = 11;
function fitProdDescription(el) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollHeight > el.clientHeight + 1 && size > PROD_DESC_MIN_FONT_PX) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
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

// Núcleo compartido entre el modal (openValidation) y la ficha embebida
// del modo Sugerido (mountSuggestedFlow) — arma todo el acordeón
// dentro de `overlay` (que puede ser un <div class="scan-overlay">
// fixed o un <div> cualquiera ya insertado en el flujo normal, da
// igual: acá adentro nunca se asume posición fixed).
//   - onValidated(): se llama después de guardar OK un ítem. Si
//     devuelve un array, se usa como cola nueva (refreshQueue) — el
//     modal devuelve null (ya se está cerrando); la ficha embebida
//     devuelve la cola pendiente recién releída, para avanzar sola.
//   - onIndexChange(idx)/onEmpty(): opcionales, solo los usa la ficha
//     embebida (persistir la posición, mostrar el estado "todo
//     validado" cuando la cola queda vacía).
function renderValidationFlow(overlay, initialItem, { pendingItems = [], onValidated, onIndexChange, onEmpty }) {
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

      <div class="venc-acc-item" id="itemComment" hidden>
        <div class="venc-acc-panel" id="panelComment">
          <div class="venc-review-box" id="vencReviewBox"></div>
          <div class="venc-acc-controls">
            <label class="venc-comment-label" for="vencComentario">Observación:</label>
            <textarea class="venc-acc-comment-input" id="vencComentario" rows="3" maxlength="200" placeholder="Añadir observación" disabled></textarea>
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
    onIndexChange?.(currentIndex);
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
    // closeManualInput() se llama "por las dudas" en varios puntos
    // (moveCameraTo, loadItem, markDone...) aunque el modo manual ya
    // esté apagado — sin este freno, cada una de esas llamadas
    // disparaba igual toda la animación FLIP de abajo (mide alto
    // ANTES/DESPUÉS aunque nada vaya a cambiar) y, si esa medición
    // ocurre con el panel todavía vacío (cámara sin mover adentro
    // todavía), el alto capturado quedaba mal — sin una transición
    // real de por medio nunca dispara "transitionend", así que el
    // cleanup que libera el height inline nunca llegaba a correr y el
    // contenedor quedaba con un alto fijo pegado para siempre.
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
  photoConfirmBtn.addEventListener('click', () => {
    if (!photoDataUrl) return;
    finishValidation('faltante', 'Faltante', photoDataUrl, photoConfirmBtn);
  });

  // Detalle del producto (descripción + saldo/pedprov/vencimiento +
  // sugerencia de acción) — última revisión antes de escribir la
  // observación. Se arma recién en unlockComment(), nunca antes: con
  // el contenedor todavía oculto (display:none) fitProdDescription()
  // mide alto 0 y nunca llega a achicar la fuente si el texto es
  // largo (mismo problema que ya se vio con setManualMode).
  function renderCommentInfo(it) {
    const um = it.unidadmedida ? ` ${it.unidadmedida}` : '';
    reviewBox.innerHTML = `
      <p class="venc-comment-desc" id="commentDescripcion">${escapeHtml(it.descripcion || 'Producto sin descripción')}</p>
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

  // El contenedor queda oculto por completo hasta validar Caja y
  // Producto (a diferencia de esos dos, acá no hay nada contra qué
  // validar — la observación es texto libre, obligatorio). Sin foco
  // automático: el operario ya viene de escanear, no tiene sentido
  // "robarle" el teclado antes de que decida escribir.
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

  // La observación es obligatoria — "Confirmar" queda deshabilitado
  // hasta que haya texto.
  comentarioInput.addEventListener('input', () => {
    confirmBtn.disabled = !comentarioInput.value.trim();
  });
  confirmBtn.addEventListener('click', () => {
    const texto = comentarioInput.value.trim();
    if (!texto) return;
    finishValidation('otro', texto, null, confirmBtn);
  });

  // Único punto de guardado, usado tanto por "Confirmar" (Observación)
  // como por "Confirmar faltante" (foto). Al terminar OK, onValidated
  // decide qué sigue: el modal cierra y listo (devuelve null); la
  // ficha embebida relee la cola pendiente y, si onValidated devuelve
  // un array, refreshQueue() avanza sola al siguiente ítem (o muestra
  // el estado vacío si ya no queda nada).
  async function finishValidation(motivo, texto, photoUrl, busyBtn) {
    if (submitting) return;
    submitting = true;
    busyBtn.disabled = true;
    try {
      await store.validate(item, motivo, texto, photoUrl);
      if (navigator.vibrate) navigator.vibrate(35);
      submitting = false;
      const freshQueue = await onValidated();
      if (Array.isArray(freshQueue)) refreshQueue(freshQueue);
    } catch {
      showToast('No se pudo guardar. Probá de nuevo.', { variant: 'warn' });
      submitting = false;
      busyBtn.disabled = false;
    }
  }

  // Tras validar un ítem (o si la cola cambia por otro motivo, p. ej.
  // se excluyó una ubicación), la ficha embebida se reacomoda sola:
  // si el ítem actual sigue en la cola nueva, solo actualiza los
  // límites de las flechas (sin tocar nada visible); si no (el caso
  // normal después de validar), avanza a la posición que haya quedado
  // en el mismo índice, o a la última si la cola se acortó más allá.
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

    locUbicacionEl.textContent = item.ubicacion || '-';
    locUbicacionEl.className = `venc-loc-ubicacion ${locSizeClass(item.ubicacion)}`;
    locCajaNumeroEl.textContent = item.caja || '-';
    prodDescripcionEl.textContent = item.descripcion || 'Producto sin descripción';
    fitProdDescription(prodDescripcionEl);
    prodReferenciaEl.textContent = item.referencia || '-';
    prodReferenciaEl.hidden = false;
    // Ubicación y número de caja cambian juntos con cada ítem — un
    // solo destello para todo el bloque de arriba.
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

// Modal a pantalla completa (usado desde la lista "Pendiente"): validar
// UN ítem siempre cierra la ficha entera y vuelve a la lista, aunque
// pendingItems traiga más posiciones (esas solo sirven para navegar
// con las flechas mientras el modal está abierto). Se cierra con el
// gesto nativo de "atrás" del navegador/teléfono (popstate).
export function openValidation(initialItem, { onDone, pendingItems = [] }) {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  document.body.appendChild(overlay);

  history.pushState({ vencValidation: true }, '', location.href);
  let closedByPop = false;
  let closed = false;
  window.addEventListener('popstate', onPopState);
  function onPopState() {
    closedByPop = true;
    teardown();
  }

  const flow = renderValidationFlow(overlay, initialItem, {
    pendingItems,
    onValidated: async () => {
      teardown();
      onDone();
      return null;
    },
  });

  function teardown() {
    if (closed) return;
    closed = true;
    flow.destroy();
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
  }
}

// Ficha embebida del modo "Sugerido" (ver list-view.js/drawSuggested):
// se monta una sola vez dentro de `container` y queda viva mientras esa
// pestaña está a la vista — validar un ítem no cierra nada, onValidated
// releé la cola pendiente y la propia ficha avanza sola a la siguiente
// posición (o dispara onEmpty si ya no queda ninguna).
export function mountSuggestedFlow(container, initialItem, { pendingItems, onValidated, onIndexChange, onEmpty }) {
  const root = document.createElement('div');
  root.className = 'venc-suggest-inline cq-fade-in';
  container.appendChild(root);

  const flow = renderValidationFlow(root, initialItem, {
    pendingItems, onValidated, onIndexChange, onEmpty,
  });

  return {
    destroy() { flow.destroy(); root.remove(); },
    refresh: flow.refresh,
  };
}
