/* ============================================================
   Mapear · Selector de motor de escaneo.

   Dos motores, cada uno en su propio archivo para poder debuguearlos
   por separado sin pisarse:
     android-engine.js   BarcodeDetector nativo (Chrome/Edge/Android)
     ios-engine.js        ZXing por software (iOS Safari, que no tiene
                          BarcodeDetector)

   editor-view.js no sabe cuál de los dos está corriendo: solo pide
   pickEngine() y usa el resultado a través del mismo contrato
   (detectFrame(videoEl) → código o null). Así, si un motor falla, el
   otro archivo ni se toca.

   ios-engine.js carga una librería de ~470KB (ZXing) — por eso se
   importa recién acá adentro, de forma dinámica, y solo cuando
   realmente hace falta: un usuario de Android jamás la descarga.
   ============================================================ */

import * as androidEngine from './android-engine.js';

function isIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ se identifica como "Macintosh" pero tiene pantalla
  // táctil — sin este chequeo, un iPad quedaría clasificado como
  // desktop y probaría (mal) el motor de Android.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

// Se recuerda el último motor entregado para no reinicializarlo cada
// vez que se abre el editor dentro de la misma sesión de la página.
let cached = null;

export async function pickEngine() {
  if (cached) return cached;

  let engine;
  if (!isIOS() && androidEngine.isSupported()) {
    engine = androidEngine;
  } else {
    // iOS, o cualquier navegador raro sin BarcodeDetector: se cae al
    // motor por software, que no depende de ninguna API del navegador.
    const iosEngine = await import('./ios-engine.js');
    engine = iosEngine;
  }

  await engine.init();
  cached = engine;
  return engine;
}

export function resetEngine() {
  if (cached) cached.destroy();
  cached = null;
}
