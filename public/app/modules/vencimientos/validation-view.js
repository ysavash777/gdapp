/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   El acordeón (nav de ubicación + Caja/Producto/Observación) se
   arma en renderValidationFlow() y se monta con mountSuggestedFlow(),
   embebido en el flujo normal de la página, DEBAJO del toggle
   Sugerido/Pendiente/Validado (ver list-view.js, modo "Sugerido") —
   único punto de entrada: tocar un ítem en "Pendiente" no abre nada
   aparte, salta a esta misma ficha ya parada en ese ítem (ver
   list-view.js). Sin overlay ni historial propio — "confirmar" no
   cierra nada, la propia ficha relee la cola (onValidated) y pasa sola
   a la siguiente posición pendiente.

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
        está, insistir en escanearlo no tiene sentido): reemplaza a
        Producto por un módulo compacto que exige una foto de la
        posición vacía como evidencia (cámara nativa o galería del
        dispositivo, no la cámara compartida — ver enterFotoMode()).
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
   linterna/teclado/input manual) se reutiliza entre Caja y Producto —
   se mueve entero con .prepend, nunca se recrea ni se vuelve a pedir
   permiso. La foto de faltante NO la usa (ver más abajo): mientras esa
   vista está activa, la cámara compartida solo se pausa donde esté
   parqueada (siempre en el panel de Producto), nunca se mueve.
   moveCameraTo
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
import { currentUser } from '/shared/js/session.js';

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

// Arma todo el acordeón dentro de `overlay` (el <div> que
// mountSuggestedFlow ya insertó en el flujo normal de la página —
// nunca se asume posición fixed acá adentro).
//   - onValidated(item): se llama YA, antes de que el guardado real
//     termine (ver finishValidation — optimista, nunca espera al
//     servidor). Devuelve la cola pendiente ya sin este ítem (quitado
//     de la copia local, sin pedirle nada al servidor) — refreshQueue
//     avanza sola con eso.
//   - onValidateError(item): el guardado real falló en segundo plano
//     — quien llama debe reincorporar el ítem a su lista local (nunca
//     quedó guardado, aunque la UI ya haya avanzado).
//   - onIndexChange(idx)/onEmpty(): opcionales, solo los usa la ficha
//     embebida (persistir la posición, mostrar el estado "todo
//     validado" cuando la cola queda vacía).
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
  // solo al contenedor de Producto (nunca a Caja, que ya quedó
  // "Ubicación confirmada" arriba y sirve de contexto) ni al de
  // Observación (sigue oculto, no se llega a él por acá — el motivo
  // queda registrado como "Faltante" directo). Nada de cámara propia:
  // dos accesos nativos (cámara del dispositivo o galería, vía <input
  // type="file">) en vez de la vista previa en vivo de antes — "es
  // incómodo tomar la foto desde ahí" fue el pedido explícito. La
  // cámara COMPARTIDA (Caja/Producto) solo se pausa mientras tanto,
  // nunca se mueve: sigue exactamente donde estaba (en panelProd) para
  // cuando se cancele.
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

  // Achica cualquier foto (de cámara o de galería, puede pesar varios
  // MB tal cual la entrega el dispositivo) a un tamaño manejable antes
  // de convertirla a data URL — el body JSON tiene un límite de 4mb
  // (ver server/index.js) y de todas formas no tiene sentido mandar
  // una foto de evidencia a resolución completa. createImageBitmap()
  // decodifica bastante más rápido que un <img> (evita todo el
  // pipeline de carga de imagen HTML) — con fotos de cámara modernas
  // (10+ MP) esa diferencia se sentía como la app "trabada" un par de
  // segundos; con fallback a Image+canvas para navegadores que no lo
  // soporten.
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

  // `photoRequestId` descarta cualquier procesamiento que llegue tarde
  // (dos toques seguidos en Cámara/Galería, o cancelar y elegir de
  // nuevo mientras el anterior todavía procesa) — sin esto, un
  // resultado viejo podía pisar al más nuevo, o peor, aplicarse
  // aunque el usuario ya haya salido del modo foto. `file.size` en 0
  // (algunos navegadores móviles disparan `change` con un archivo
  // vacío si se cancela la cámara sin tomar nada) se descarta directo,
  // nunca debe mostrar "Foto lista" sin una foto real.
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

  // Detalle del producto (descripción + saldo/pedprov/vencimiento +
  // sugerencia de acción) — última revisión antes de escribir la
  // observación. Se arma recién en unlockComment(), nunca antes: con
  // el contenedor todavía oculto (display:none) fitProdDescription()
  // mide alto 0 y nunca llega a achicar la fuente si el texto es
  // largo (mismo problema que ya se vio con setManualMode).
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
    finishValidation('otro', texto, null);
  });

  // Único punto de guardado, usado tanto por "Confirmar" (Observación)
  // como por "Confirmar faltante" (foto). Optimista: el avance a la
  // próxima posición (onValidated) es INMEDIATO, ya con la lista local
  // — nunca espera al servidor. El guardado real (store.validate)
  // corre en paralelo, en silencio; si falla, onValidateError le avisa
  // a quien llama para que reincorpore el ítem a la cola en vez de
  // darlo por guardado sin estarlo. onValidated puede devolver un
  // array (la ficha embebida avanza sola con refreshQueue) o null (el
  // modal ya se está cerrando, no hay nada más que mover acá).
  function finishValidation(motivo, texto, photoUrl) {
    if (submitting) return;
    submitting = true;
    if (navigator.vibrate) navigator.vibrate(35);
    const validatedItem = item;
    // `item` es la MISMA referencia que vive en state.items del lado
    // de list-view.js (pendingItems nunca clona) — completar estos
    // campos acá ya los deja bien en los dos lados, sin pasar nada
    // extra por onValidated. Sin esto, abrir el detalle en "Validado"
    // justo en la ventana optimista (antes de que el guardado real
    // confirme) mostraba motivo/fecha vacíos. fotoUrl usa el propio
    // data URL local — se ve igual que la real, no hace falta esperar
    // a que el servidor la aloje para poder mostrarla.
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

// Ficha embebida del modo "Sugerido" (ver list-view.js/drawSuggested):
// se monta una sola vez dentro de `container` y queda viva mientras esa
// pestaña está a la vista — validar un ítem no cierra nada, onValidated
// releé la cola pendiente y la propia ficha avanza sola a la siguiente
// posición (o dispara onEmpty si ya no queda ninguna).
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
