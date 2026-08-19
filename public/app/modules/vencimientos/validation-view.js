/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Sin header propio: el espacio se lo queda el selector de ubicación
   de arriba (.venc-loc-selector) — mismo estilo de contenedor que
   Caja/Producto/Observación, pero es un selector, no un paso: al
   tocarlo despliega las demás posiciones pendientes (pendingItems) y
   permite saltar a cualquiera SIN cerrar esta pantalla (loadItem
   reinicia el estado para el nuevo ítem, reutilizando la misma cámara
   ya activa — nunca se vuelve a pedir permiso). Se cierra únicamente
   con el gesto nativo de "atrás" del navegador/teléfono (popstate).

   Acordeón de 3 contenedores debajo, uno a la vez:
     1) Caja — ubicación + número de caja. Nunca se puede saltar: es
        el único paso que confirma que el operario está parado frente
        a la posición correcta (por eso el contenedor 2 arranca
        BLOQUEADO hasta que este se valida).
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
   crece hacia el espacio libre de la pantalla (ver más abajo), nunca
   empuja lo que sigue. Una vez validado correctamente, el contenedor
   queda bloqueado (no se puede reabrir ni tiene más lógica) y su
   avatar pasa de "pendiente" a "éxito".

   Un solo <video> de cámara se reutiliza entre los contenedores 1 y 2
   (se monta dentro del que esté abierto, y se estira para ocupar todo
   el espacio que ese contenedor tenga disponible) — así, en la futura
   versión handheld (sin cámara), alcanza con no crearlo: el resto de
   la pantalla (avatares, textos) funciona igual.

   Un match en cualquier paso avanza SOLO, sin pedir confirmación
   ("sin fricción" es literal) — pero el cambio de paso se marca fuerte
   (color de éxito + vibración + destello + toast) para que nunca pase
   desapercibido.

   El valor esperado de cada paso nunca se muestra de entrada (eso
   volvería el paso un trámite de tipeo, no una verificación real). Si
   hay un desacuerdo, lo único que se imprime es lo que se leyó (no
   "esperado X, se leyó Y": alcanza con el dato erróneo para
   diagnosticarlo) — como una insignia flotante SOBRE la cámara, nunca
   como bloque de texto en el flujo: eso desarmaba el layout cada vez
   que aparecía (el panel se achicaba para hacerle lugar). Recortado a
   14 caracteres porque un QR mal leído puede traer strings larguísimos
   que igual deformarían la insignia.
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

export function openValidation(initialItem, { onDone, pendingItems = [] }) {
  let item = initialItem;

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="venc-loc-selector" id="vencLocSelector">
      <button type="button" class="venc-acc-head venc-loc-head" id="vencLocHead">
        <span class="venc-acc-avatar" id="vencLocAvatar">${icon('pin', 18)}</span>
        <span class="venc-acc-head-text">
          <strong class="venc-acc-head-title" id="vencLocTitle"></strong>
          <span class="venc-acc-head-sub" id="vencLocSub"></span>
        </span>
        <span class="venc-loc-chevron">${icon('chevronDown', 16)}</span>
      </button>
      <div class="mapeo-menu venc-loc-menu" id="vencLocMenu" hidden></div>
    </div>
    <div class="scan-sheet cq-sheet venc-acc-body" id="vencAccBody">
      <div class="venc-acc-item" data-state="pending" id="itemCaja">
        <button type="button" class="venc-acc-head" id="headCaja">
          <span class="venc-acc-avatar" id="avatarCaja">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
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

  const locHead = overlay.querySelector('#vencLocHead');
  const locMenu = overlay.querySelector('#vencLocMenu');
  const locTitle = overlay.querySelector('#vencLocTitle');
  const locSub = overlay.querySelector('#vencLocSub');

  const itemCaja = overlay.querySelector('#itemCaja');
  const headCaja = overlay.querySelector('#headCaja');
  const avatarCaja = overlay.querySelector('#avatarCaja');
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
  const comentarioInput = overlay.querySelector('#vencComentario');
  const confirmBtn = overlay.querySelector('#vencConfirm');

  const vencAccBody = overlay.querySelector('#vencAccBody');
  const photoView = overlay.querySelector('#vencPhotoView');
  const photoFrame = overlay.querySelector('#vencPhotoFrame');
  const photoImgEl = overlay.querySelector('#vencPhotoImg');
  const photoCaptureRow = overlay.querySelector('#vencPhotoCaptureRow');
  const photoConfirmActions = overlay.querySelector('#vencPhotoConfirmActions');

  // Cámara única (video + línea + destello) reutilizada entre los
  // contenedores 1 y 2 — se mueve de uno a otro con .prepend, sin
  // recrearla ni perder el stream. En handheld este bloque no
  // existiría y el resto de la pantalla sigue funcionando igual.
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
  // lugar en el flujo) — a diferencia de un bloque de texto en los
  // controles, aparecer/desaparecer nunca achica el espacio de la
  // cámara ni mueve nada alrededor.
  function showMismatch(raw) {
    mismatchTextEl.textContent = truncate(raw);
    mismatchEl.classList.add('is-visible');
    clearTimeout(mismatchTimer);
    mismatchTimer = setTimeout(() => mismatchEl.classList.remove('is-visible'), 2200);
  }

  function moveCameraTo(panel) {
    panel.prepend(cameraMount);
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
    const avatar = key === 'caja' ? avatarCaja : avatarProd;
    avatar.innerHTML = icon('check', 18);
  }

  function setOpen(key, isOpen) {
    const itemEl = key === 'caja' ? itemCaja : itemProd;
    const panelEl = key === 'caja' ? panelCaja : panelProd;
    itemEl.classList.toggle('is-open', isOpen);
    panelEl.hidden = !isOpen;
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
    if (stateOf.caja !== 'pending') return;
    if (openKey === 'caja') { closeAccordion('caja'); return; }
    openAccordion('caja');
  });
  headProd.addEventListener('click', () => {
    if (stateOf.prod !== 'pending') return;
    if (openKey === 'prod') { closeAccordion('prod'); return; }
    openAccordion('prod');
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

  // --- Selector de ubicación (arriba, en el lugar del header) ---
  // Solo lista OTRAS posiciones pendientes (nunca la actual, nunca las
  // ya validadas) — tocar una la carga en el momento (loadItem),
  // reutilizando esta misma pantalla y la cámara ya activa, sin cerrar
  // ni volver a pedir permiso.
  function otherPending() {
    return pendingItems.filter((i) => i.key !== item.key);
  }

  function locMenuHTML() {
    const others = otherPending();
    if (!others.length) {
      return `<p class="venc-loc-menu-empty">No hay más posiciones pendientes.</p>`;
    }
    return others.map((it) => `
      <button type="button" class="user-menu-item venc-loc-menu-item" data-key="${escapeHtml(it.key)}">
        <span class="venc-loc-menu-text">
          <strong>${escapeHtml(it.ubicacion || '-')}</strong>
          <span>${escapeHtml(it.descripcion || 'Producto sin descripción')}</span>
        </span>
      </button>
    `).join('');
  }

  function closeLocMenu() {
    locMenu.hidden = true;
  }

  locHead.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = locMenu.hidden;
    if (opening) locMenu.innerHTML = locMenuHTML();
    locMenu.hidden = !opening;
  });
  locMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const next = pendingItems.find((i) => i.key === btn.dataset.key);
    closeLocMenu();
    if (next) loadItem(next);
  });
  function onDocClick(e) {
    if (!locMenu.hidden && !overlay.contains(e.target)) closeLocMenu();
  }
  document.addEventListener('click', onDocClick);

  // Reinicia todo el estado por-ítem (sin recrear la cámara ni pedir
  // permiso de nuevo) — usado tanto al abrir por primera vez como al
  // saltar a otra posición desde el selector de arriba.
  function loadItem(newItem) {
    item = newItem;
    closeLocMenu();
    if (fotoViewOpen) exitFotoMode();

    locTitle.textContent = item.ubicacion || '-';
    locSub.textContent = `${otherPending().length} más pendiente${otherPending().length === 1 ? '' : 's'}`;
    cajaUbicacionEl.textContent = item.ubicacion || '-';
    cajaNumeroEl.textContent = item.caja || '-';
    prodDescripcionEl.textContent = item.descripcion || 'Producto sin descripción';
    prodReferenciaEl.textContent = `${item.referencia || '-'} - ${item.ean || '-'}`;

    openKey = null;
    setItemState('caja', 'pending');
    setItemState('prod', 'locked');
    avatarCaja.innerHTML = icon('clock', 18);
    avatarProd.innerHTML = icon('clock', 18);
    setOpen('caja', false);
    setOpen('prod', false);

    itemComment.dataset.state = 'locked';
    panelComment.hidden = true;
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
    document.removeEventListener('click', onDocClick);
    overlay.remove();
    if (!closedByPop) history.back();
  }

  loadItem(item);
  scanner.start();
}
