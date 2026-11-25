// Escáner "handheld": reemplaza a la cámara (camera.js) con un campo de texto
// para dispositivos con escáner integrado, que escriben el código y mandan
// Enter. Mismo contrato que createCameraScanner (start / destroy / pauseView /
// resumeView / setPaused / setTorch), así las herramientas no cambian.
//
// Pensado para ir rápido, sin tocar la pantalla entre un escaneo y otro:
//  - El campo NO abre el teclado nativo al tocarlo (inputmode="none"). El ícono
//    de teclado, dentro del campo, lo abre a pedido y lo vuelve a cerrar al
//    enviar.
//  - Enter envía el código (y limpia el campo) de inmediato, sin debounce: en
//    un handheld repetir el mismo producto es un escaneo legítimo.
//  - El foco vuelve solo al campo: al arrancar, al cerrar una ventana
//    (setPaused(false) / resumeView()), al tocar fuera sobre algo no editable y
//    al volver a la app. Mientras hay una ventana abierta (setPaused(true)) el
//    campo suelta el foco para no robarle el teclado a los campos de esa ventana.

import { icon } from '/shared/js/icons.js';

export function createHandheldScanner({ cameraBox, torchBtn, hintEl, onCode }) {
  let paused = false;
  let closed = false;

  cameraBox.classList.add('is-handheld');
  cameraBox.removeAttribute('title'); // sin "tocar para apagar la cámara"
  if (torchBtn) torchBtn.hidden = true;
  if (hintEl) hintEl.hidden = true;

  const panel = document.createElement('div');
  panel.className = 'hh-panel';
  panel.innerHTML = `
    <div class="hh-field">
      <input class="hh-input" type="text" inputmode="none" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Código…" aria-label="Código escaneado" />
      <button type="button" class="hh-kbd" title="Abrir teclado" aria-label="Abrir teclado">${icon('keyboard', 18)}</button>
    </div>
  `;
  cameraBox.appendChild(panel);
  const input = panel.querySelector('.hh-input');
  const kbdBtn = panel.querySelector('.hh-kbd');

  function focusInput() {
    if (closed || paused || !input.isConnected) return;
    input.inputMode = 'none';
    kbdBtn.classList.remove('is-active');
    try { input.focus({ preventScroll: true }); } catch { /* sin foco posible */ }
  }

  // Cierra el teclado nativo (si estaba abierto) sin perder el foco del campo.
  function hideKeyboard() {
    if (input.inputMode === 'none') return;
    input.blur();
    focusInput();
  }

  function send() {
    const value = input.value.trim();
    input.value = '';
    hideKeyboard();
    if (value && !paused && !closed) onCode(value);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      send();
    }
  });

  // El botón no debe robarle el foco al campo al tocarlo (si no, el campo
  // se "desenfoca" justo antes de que el click reabra el teclado).
  kbdBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  kbdBtn.addEventListener('click', () => {
    if (paused || closed) return;
    if (input.inputMode === 'none') {
      input.inputMode = 'text';
      kbdBtn.classList.add('is-active');
      input.blur(); // Android abre el teclado recién con un foco nuevo
      try { input.focus({ preventScroll: true }); } catch { /* sin foco posible */ }
    } else {
      hideKeyboard();
    }
  });

  // Tocar sobre algo no editable deja el foco "en la nada": se recupera. Si el
  // foco se fue a otro campo o botón (relatedTarget), se respeta.
  input.addEventListener('blur', (e) => {
    if (closed || paused || e.relatedTarget) return;
    setTimeout(() => {
      if (closed || paused) return;
      const active = document.activeElement;
      if (!active || active === document.body) focusInput();
    }, 60);
  });
  function onVisible() {
    if (document.visibilityState === 'visible') focusInput();
  }
  document.addEventListener('visibilitychange', onVisible);

  return {
    start() { focusInput(); },
    destroy() {
      closed = true;
      document.removeEventListener('visibilitychange', onVisible);
      panel.remove();
      cameraBox.classList.remove('is-handheld');
    },
    pauseView() { /* sin video que congelar */ },
    resumeView() { focusInput(); },
    setPaused(value) {
      paused = value;
      if (paused) input.blur();
      else focusInput();
    },
    setTorch() { /* sin linterna */ },
  };
}
