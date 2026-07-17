/* ============================================================
   App · Controlador de cámara para escaneo — usado por Mapear y
   Consultar grupo (y cualquier otra herramienta que escanee), para no
   duplicar el manejo de stream/torch/loop de detección en cada una.

   Encapsula todo lo que es "hardware de cámara", nada de qué hacer
   con un código leído — eso queda 100% del lado de quien lo usa, vía
   el callback onCode. El debounce por "mismo código" (mientras un
   código sigue en cuadro, el loop lo vuelve a leer cada ciclo) también
   vive acá, porque es un problema del loop de detección, no de cada
   herramienta — el ingreso manual de cada módulo no pasa por acá, así
   que nunca se debounce (una acción deliberada del usuario siempre
   se procesa, aunque sea el mismo código que el último).

   Uso:
     const scanner = createCameraScanner({ videoEl, cameraBox, torchBtn, hintEl, onCode });
     scanner.start();          // pide permiso, arranca el loop
     scanner.setPaused(true);  // pausa el loop (p. ej. con una ventana abierta encima)
     scanner.pauseView();      // además congela/oscurece el video sin soltar el stream
     scanner.destroy();        // suelta cámara y detiene todo, para cuando se cierra la vista
   ============================================================ */

import { pickEngine } from './engines/index.js';

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;

export function createCameraScanner({ videoEl, cameraBox, torchBtn, hintEl, onCode }) {
  let stream = null;
  let track = null;
  let torchOn = false;
  let cameraOn = false;
  let engine = null;
  let detectTimer = null;
  let lastCode = null;
  let lastAt = 0;
  let detectionPaused = false;
  let closed = false;

  function showHint(text) {
    hintEl.textContent = text;
    hintEl.hidden = false;
  }

  async function start() {
    hintEl.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      showHint('No se pudo acceder a la cámara. Usá el ingreso manual.');
      return;
    }
    if (closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    cameraOn = true;

    videoEl.srcObject = stream;
    track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    torchBtn.hidden = !caps.torch;

    try {
      engine = await pickEngine();
    } catch {
      engine = null;
    }
    if (!engine) {
      showHint('Este dispositivo no soporta lectura automática. Usá el ingreso manual.');
      return;
    }

    detectTimer = setInterval(async () => {
      if (closed || detectionPaused || !engine) return;
      const code = await engine.detectFrame(videoEl);
      if (!code) return;
      const now = Date.now();
      if (code === lastCode && now - lastAt < SAME_CODE_DEBOUNCE_MS) return;
      lastCode = code;
      lastAt = now;
      onCode(code);
    }, DETECT_INTERVAL_MS);
  }

  function stop() {
    cameraOn = false;
    clearInterval(detectTimer);
    detectTimer = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    track = null;
  }

  // Tocar el recuadro de la cámara la apaga/prende por completo — un
  // escape a mano para resolver bugs de cámara sin reiniciar la app,
  // sin exponer un botón dedicado para algo que no se usa seguido.
  cameraBox.addEventListener('click', () => {
    if (cameraOn) {
      stop();
      // Solo frena la animación de la línea de escaneo — nada más del
      // recuadro (video, gradiente) cambia por apagar la cámara a mano.
      cameraBox.classList.add('is-off');
      showHint('Cámara apagada. Tocá para reactivarla.');
    } else {
      cameraBox.classList.remove('is-off');
      start();
    }
  });

  // Mientras hay una ventana propia abierta encima (registro, ficha de
  // producto...), la cámara se ve "apagada" (video congelado, sin
  // barra) para no distraer — sin soltar el stream, así se reanuda al
  // instante al cerrarla.
  function pauseView() {
    videoEl.pause();
    cameraBox.classList.add('is-paused');
  }
  function resumeView() {
    cameraBox.classList.remove('is-paused');
    if (cameraOn) videoEl.play().catch(() => {});
  }

  function setPaused(paused) {
    detectionPaused = paused;
  }

  async function setTorch(on) {
    if (!track || torchOn === on) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      torchOn = on;
      torchBtn.classList.toggle('is-active', torchOn);
    } catch {
      /* el navegador anunció soporte pero no lo aplicó */
    }
  }
  torchBtn.addEventListener('click', () => setTorch(!torchOn));

  function destroy() {
    closed = true;
    stop();
  }

  return { start, destroy, pauseView, resumeView, setPaused, setTorch };
}
