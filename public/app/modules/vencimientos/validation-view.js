/* ============================================================
   Módulo App · Vencimientos — validación de un ítem.

   Pantalla en acordeón de 3 contenedores, uno a la vez:
     1) Caja — ubicación + número de caja. Nunca se puede saltar: es
        el único paso que confirma que el operario está parado frente
        a la posición correcta (por eso el contenedor 2 arranca
        BLOQUEADO hasta que este se valida).
     2) Producto — descripción + referencia/EAN. Acá SÍ se puede
        reportar "faltante" sin escanear (si el producto de verdad no
        está, insistir en escanearlo no tiene sentido), pero exige una
        foto de la posición vacía como evidencia.
     3) Comentario — se libera recién con 1 y 2 validados. Sin motivos
        predefinidos: texto libre, vacío = "OK".

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

   El contenedor abierto ocupa TODO el espacio vertical libre (flex:1)
   dentro de la pantalla, que a su vez ocupa siempre el 100% de la
   ventana — nunca se agranda más allá de eso ni empuja lo de abajo:
   el contenido de ese contenedor (la cámara) se adapta al espacio
   disponible, no al revés. Por eso, por el momento, no hay ingreso
   manual: sin él, el único contenido variable es la cámara, que
   siempre puede estirarse o achicarse sin recortar nada.

   Un match en cualquier paso avanza SOLO, sin pedir confirmación
   ("sin fricción" es literal) — pero el cambio de paso se marca fuerte
   (color de éxito + vibración + destello + toast) para que nunca pase
   desapercibido.

   El valor esperado de cada paso nunca se muestra de entrada (eso
   volvería el paso un trámite de tipeo, no una verificación real) —
   solo aparece si hay un desacuerdo, para poder diagnosticarlo.
   ============================================================ */

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import * as store from './store.js';

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

export function openValidation(item, { onDone }) {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-back" id="vencClose" title="Cerrar">${icon('chevronLeft', 22)}</button>
      <div class="scan-title">Validar SKU</div>
      <div class="scan-header-actions">
        <button class="btn-icon scan-torch" id="scanTorch" title="Linterna" hidden>${icon('zap', 20)}</button>
      </div>
    </div>
    <div class="scan-sheet cq-sheet venc-acc-body" id="vencAccBody">
      <div class="venc-acc-item" data-state="pending" id="itemCaja">
        <button type="button" class="venc-acc-head" id="headCaja">
          <span class="venc-acc-avatar" id="avatarCaja">${icon('clock', 18)}</span>
          <span class="venc-acc-head-text">
            <strong class="venc-acc-head-title">${escapeHtml(item.ubicacion || '-')}</strong>
            <span class="venc-acc-head-sub">${iconSolid('caja', 13)}<span>${escapeHtml(item.caja || '-')}</span></span>
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
            <strong class="venc-acc-head-title">${escapeHtml(item.descripcion || 'Producto sin descripción')}</strong>
            <span class="venc-acc-head-sub">${escapeHtml(item.referencia || '-')} - ${escapeHtml(item.ean || '-')}</span>
          </span>
        </button>
        <div class="venc-acc-panel" id="panelProd" hidden>
          <div class="venc-acc-controls" id="controlsProd"></div>
        </div>
      </div>

      <div class="venc-acc-comment" data-state="locked" id="commentBox">
        <label class="venc-acc-comment-label" for="vencComentario">Comentario</label>
        <textarea class="venc-acc-comment-input" id="vencComentario" rows="3" maxlength="200" placeholder="Validá caja y producto para poder escribir" disabled></textarea>
        <button type="button" class="btn btn-primary btn-block" id="vencConfirm" disabled>Confirmar</button>
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

  const torchBtn = overlay.querySelector('#scanTorch');
  const itemCaja = overlay.querySelector('#itemCaja');
  const headCaja = overlay.querySelector('#headCaja');
  const avatarCaja = overlay.querySelector('#avatarCaja');
  const panelCaja = overlay.querySelector('#panelCaja');
  const controlsCaja = overlay.querySelector('#controlsCaja');

  const itemProd = overlay.querySelector('#itemProd');
  const headProd = overlay.querySelector('#headProd');
  const avatarProd = overlay.querySelector('#avatarProd');
  const panelProd = overlay.querySelector('#panelProd');
  const controlsProd = overlay.querySelector('#controlsProd');

  const commentBox = overlay.querySelector('#commentBox');
  const comentarioInput = overlay.querySelector('#vencComentario');
  const confirmBtn = overlay.querySelector('#vencConfirm');

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
    <div class="scan-flash" id="scanFlash">${icon('check', 32)}</div>
    <p class="scan-hint" id="scanHint" hidden></p>
  `;
  const videoEl = cameraMount.querySelector('#scanVideo');
  const hintEl = cameraMount.querySelector('#scanHint');
  const flashEl = cameraMount.querySelector('#scanFlash');

  function playFlash() {
    flashEl.classList.remove('is-playing');
    void flashEl.offsetWidth; // fuerza reflow para poder re-disparar la animación seguida
    flashEl.classList.add('is-playing');
  }

  function moveCameraTo(panel) {
    panel.prepend(cameraMount);
  }

  let openKey = null; // 'caja' | 'prod' | null
  let prodMode = 'scan'; // 'scan' | 'foto'
  const stateOf = { caja: 'pending', prod: 'locked' };
  const mismatch = { caja: null, prod: null };
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

  function mismatchHTML(m) {
    if (!m) return '';
    return `
      <div class="venc-val-mismatch">
        ${icon('alertTriangle', 15)}
        <span>No coincide. Esperado <strong>${escapeHtml(m.expected)}</strong>, se leyó <strong>${escapeHtml(m.scanned)}</strong>.</span>
      </div>
    `;
  }

  function renderCajaControls() {
    controlsCaja.innerHTML = mismatchHTML(mismatch.caja);
  }

  function renderProdScanControls() {
    controlsProd.innerHTML = `
      ${mismatchHTML(mismatch.prod)}
      <button type="button" class="venc-val-skip" id="skipProd">No lo encuentro — reportar faltante</button>
    `;
    controlsProd.querySelector('#skipProd').addEventListener('click', () => {
      prodMode = 'foto';
      scanner.setPaused(true); // sin pauseView(): el video sigue en vivo para encuadrar la foto
      renderProdFotoControls();
    });
  }

  // Reportar faltante exige una foto de la posición vacía — un
  // snapshot del video YA activo (misma cámara del escaneo, nunca pide
  // permiso de nuevo). Confirmar acá termina la validación entera,
  // sin pasar por el contenedor de comentario.
  function renderProdFotoControls() {
    photoDataUrl = null;
    controlsProd.innerHTML = `
      <p class="venc-photo-hint">Encuadrá la posición vacía y tomá la foto — es obligatoria para reportar un faltante.</p>
      <div class="venc-photo-preview" id="photoPreview" hidden><img id="photoImg" alt="Foto de la posición" /></div>
      <button type="button" class="btn btn-primary btn-block" id="photoCapture">${icon('camera', 18)} Tomar foto</button>
      <div class="venc-photo-actions" id="photoActions" hidden>
        <button type="button" class="btn btn-ghost" id="photoRetake">Repetir foto</button>
        <button type="button" class="btn btn-danger" id="photoConfirm">Confirmar faltante</button>
      </div>
      <button type="button" class="venc-val-skip" id="backToScan">Volver a escanear</button>
    `;
    const captureBtn = controlsProd.querySelector('#photoCapture');
    const actionsEl = controlsProd.querySelector('#photoActions');
    const previewEl = controlsProd.querySelector('#photoPreview');
    const imgEl = controlsProd.querySelector('#photoImg');

    captureBtn.addEventListener('click', () => {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 480;
      canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      photoDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      imgEl.src = photoDataUrl;
      previewEl.hidden = false;
      captureBtn.hidden = true;
      actionsEl.hidden = false;
      if (navigator.vibrate) navigator.vibrate(35);
    });

    controlsProd.querySelector('#photoRetake').addEventListener('click', () => {
      photoDataUrl = null;
      previewEl.hidden = true;
      actionsEl.hidden = true;
      captureBtn.hidden = false;
    });

    controlsProd.querySelector('#backToScan').addEventListener('click', () => {
      prodMode = 'scan';
      scanner.setPaused(false);
      renderProdScanControls();
    });

    const photoConfirmBtn = controlsProd.querySelector('#photoConfirm');
    photoConfirmBtn.addEventListener('click', async () => {
      if (submitting || !photoDataUrl) return;
      submitting = true;
      photoConfirmBtn.disabled = true;
      try {
        await store.validate(item, 'faltante', '', photoDataUrl);
        if (navigator.vibrate) navigator.vibrate(35);
        close();
        onDone();
      } catch {
        showToast('No se pudo guardar. Probá de nuevo.', { variant: 'warn' });
        submitting = false;
        photoConfirmBtn.disabled = false;
      }
    });
  }

  function renderProdControls() {
    if (prodMode === 'foto') renderProdFotoControls();
    else renderProdScanControls();
  }

  function openAccordion(key) {
    if (openKey && openKey !== key) setOpen(openKey, false);
    openKey = key;
    setOpen(key, true);
    moveCameraTo(key === 'caja' ? panelCaja : panelProd);
    scanner.setPaused(false);
    scanner.resumeView();
    if (key === 'caja') renderCajaControls();
    else {
      prodMode = 'scan';
      renderProdControls();
    }
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

  function unlockComment() {
    commentBox.dataset.state = 'unlocked';
    comentarioInput.disabled = false;
    comentarioInput.placeholder = 'Agregar un comentario (opcional)';
    confirmBtn.disabled = false;
    scanner.setPaused(true);
    scanner.pauseView();
    comentarioInput.focus();
  }

  function markDone(key) {
    mismatch[key] = null;
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
    mismatch[key] = { expected, scanned: raw };
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    if (key === 'caja') renderCajaControls();
    else renderProdControls();
  }

  function handleCode(raw) {
    if (openKey === 'caja') checkMatch('caja', raw, item.caja);
    else if (openKey === 'prod' && prodMode === 'scan') checkMatch('prod', raw, item.referencia);
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

  overlay.querySelector('#vencClose').addEventListener('click', close);

  openAccordion('caja');
  scanner.start();
}
