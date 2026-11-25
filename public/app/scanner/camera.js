// Controlador de cámara para escaneo (stream/torch/loop de detección), compartido por
// las herramientas que escanean. Encapsula solo el hardware; qué hacer con un código
// leído es del callback onCode. El debounce por "mismo código" vive acá (loop de
// detección); el ingreso manual no pasa por acá y nunca se debounce.
//
// Uso:
//   const scanner = createCameraScanner({ videoEl, cameraBox, torchBtn, hintEl, onCode });
//   scanner.start(); scanner.setPaused(true); scanner.pauseView(); scanner.destroy();

import { pickEngine } from './engines/index.js';
import { isHandheldMode } from '/shared/js/handheld-mode.js';
import { createHandheldScanner } from './handheld.js';

const DETECT_INTERVAL_MS = 350;
const SAME_CODE_DEBOUNCE_MS = 1200;
// ~1 s sin ver código (3 lecturas de 350 ms) = el producto salió de cuadro. Más de
// una lectura vacía porque el detector a veces falla un fotograma con el código a la vista.
const EMPTY_TICKS_TO_REARM = 3;

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

// `rearmAfterResume` (opcional): al reanudar la detección tras cerrar una ventana,
// NO se vuelve a leer el último código mientras siga a la vista. Ver setPaused().
export function createCameraScanner({ videoEl, cameraBox, torchBtn, hintEl, onCode, rearmAfterResume = false }) {
  // Modo Handheld (Configuración): en vez de la cámara, un campo para el escáner
  // integrado del dispositivo (ver handheld.js). Mismo contrato, las
  // herramientas no se enteran.
  if (isHandheldMode()) return createHandheldScanner({ videoEl, cameraBox, torchBtn, hintEl, onCode });

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
  // Una lectura todavía en curso (detectFrame es asíncrono): sin esto, el timer
  // lanzaba lecturas encimadas, y una que arrancó ANTES de abrirse una ventana
  // podía terminar DESPUÉS y disparar onCode con la ventana ya abierta.
  let detecting = false;
  // Código que acaba de resolverse (ventana cerrada) y que sigue frente a la
  // cámara: no se lee de nuevo hasta que salga de cuadro (EMPTY_TICKS_TO_REARM
  // lecturas seguidas sin código). Ver setPaused().
  let blockedCode = null;
  let emptyTicks = 0;

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
      if (closed || detectionPaused || !engine || detecting) return;
      detecting = true;
      let code;
      try {
        code = await engine.detectFrame(videoEl);
      } finally {
        detecting = false;
      }
      // Se abrió una ventana (o se cerró la herramienta) mientras leía: se descarta.
      if (closed || detectionPaused) return;

      if (!code) {
        if (blockedCode && ++emptyTicks >= EMPTY_TICKS_TO_REARM) blockedCode = null;
        return;
      }
      emptyTicks = 0;
      // Tras cerrar la ventana el video sigue mostrando (o vuelve a mostrar) el mismo
      // producto: no es un escaneo nuevo hasta que lo aparten de la cámara.
      if (blockedCode) {
        if (code === blockedCode) return;
        blockedCode = null;
      }
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

  // Al reanudar (cerrar la ventana de registro), el usuario casi siempre sigue
  // apuntando al producto recién registrado — y el video pausado además queda con
  // ese mismo fotograma congelado. Con solo el debounce de 1,2 s (que ya venció
  // mientras la ventana estaba abierta) se leía OTRA VEZ el mismo código y se
  // reabría la ventana como si se hubiera escaneado de nuevo.
  function setPaused(paused) {
    if (!paused && detectionPaused && rearmAfterResume) {
      blockedCode = lastCode;
      emptyTicks = 0;
    }
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
