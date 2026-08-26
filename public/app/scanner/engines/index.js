// Selector de motor de escaneo (vía scanner/camera.js): android-engine.js usa
// BarcodeDetector nativo, ios-engine.js decodifica con ZXing por software.
// ios-engine.js pesa ~470KB, por eso se importa dinámico y solo cuando hace falta
// (un usuario de Android nunca lo descarga).

import * as androidEngine from './android-engine.js';

function isIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ se identifica como "Macintosh" pero tiene pantalla táctil;
  // sin este chequeo un iPad probaría (mal) el motor de Android.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

// Se recuerda el último motor entregado para no reinicializarlo en la misma sesión.
let cached = null;

export async function pickEngine() {
  if (cached) return cached;

  let engine;
  if (!isIOS() && androidEngine.isSupported()) {
    engine = androidEngine;
  } else {
    // iOS, o cualquier navegador sin BarcodeDetector: cae al motor por software.
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
