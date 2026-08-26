// Controlador de cámara para escaneo (stream/torch/loop de detección), compartido por
// las herramientas que escanean. Encapsula solo el hardware; qué hacer con un código
// leído es del callback onCode. El debounce por "mismo código" vive acá (loop de
// detección); el ingreso manual no pasa por acá y nunca se debounce.
//
// Uso:
//   const scanner = createCameraScanner({ videoEl, cameraBox, torchBtn, hintEl, onCode });
//   scanner.start(); scanner.setPaused(true); scanner.pauseView(); scanner.destroy();

import { pickEngine } from './engines/index.js';

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;

// En celulares con varias lentes traseras, "facingMode: environment" a veces elige la
// gran angular (0.5x) en vez de la normal (visto en iPhone Pro/iOS reciente); esa lente
// tiene distancia mínima de foco muy alta y nunca enfoca un código de cerca. Solo se
// corrige si el label del device confirma gran angular sola (no "Dual/Triple Camera")
// y hay alternativa mejor — labels ambiguos o ausentes, no se toca nada.
function isUltraWideLabel(label) {
  return /ultra[\s-]?wide/i.test(label || '') && !/dual|triple/i.test(label || '');
}

async function pickBetterBackCamera(currentDeviceId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const backCams = devices.filter((d) => d.kind === 'videoinput' && !/front/i.test(d.label));
    if (backCams.length < 2) return null;
    const current = backCams.find((d) => d.deviceId === currentDeviceId);
    if (!current || !isUltraWideLabel(current.label)) return null;
    const better = backCams.find((d) => !isUltraWideLabel(d.label));
    return better ? better.deviceId : null;
  } catch {
    return null;
  }
}

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

    // Los labels de los devices vienen vacíos hasta que hay permiso concedido,
    // por eso esta corrección solo puede intentarse acá, tras el primer getUserMedia.
    const betterId = await pickBetterBackCamera(stream.getVideoTracks()[0]?.getSettings().deviceId);
    if (betterId) {
      try {
        const betterStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: betterId }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        stream.getTracks().forEach((t) => t.stop());
        stream = betterStream;
      } catch {
        /* si falla, se sigue con el stream original (gran angular) */
      }
      if (closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
    }

    cameraOn = true;

    videoEl.srcObject = stream;
    track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    torchBtn.hidden = !caps.torch;
    // Enfoque continuo explícito: sin esto, algunos celulares enfocan una sola vez
    // al abrir la cámara y no reintentan al acercar el código.
    if (caps.focusMode?.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }

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

  // Tocar el recuadro apaga/prende la cámara por completo — escape manual para
  // resolver bugs de cámara sin reiniciar la app.
  cameraBox.addEventListener('click', () => {
    if (cameraOn) {
      stop();
      // Solo frena la animación de la línea de escaneo.
      cameraBox.classList.add('is-off');
      showHint('Cámara apagada. Tocá para reactivarla.');
    } else {
      cameraBox.classList.remove('is-off');
      start();
    }
  });

  // Con una ventana propia abierta encima, la cámara se ve "apagada" (video
  // congelado) sin soltar el stream, para reanudar al instante al cerrarla.
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
      /* soporte anunciado pero no aplicado */
    }
  }
  torchBtn.addEventListener('click', () => setTorch(!torchOn));

  function destroy() {
    closed = true;
    stop();
  }

  return { start, destroy, pauseView, resumeView, setPaused, setTorch };
}
