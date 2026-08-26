// Motor de escaneo iOS Safari: decodifica por software con ZXing (no hay BarcodeDetector
// nativo). Se carga solo cuando este motor se selecciona (ver engines/index.js) — nunca
// se descarga en Android. Bundle en /shared/js/vendor/zxing.bundle.js: empaquetado propio
// de @zxing/browser+library generado con `npm run build:zxing` (ver build/zxing-entry.js),
// comiteado como estático; regenerar a mano solo si se actualiza la versión.
// Mismo contrato que android-engine.js: detectFrame nunca lanza, código o null.

import {
  BrowserMultiFormatReader,
  BrowserCodeReader,
  DecodeHintType,
  BarcodeFormat,
  NotFoundException,
} from '/shared/js/vendor/zxing.bundle.js';

const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

export const id = 'ios-zxing';

export function isSupported() {
  // Solo necesita <canvas> y lectura de píxeles, universal en cualquier navegador con getUserMedia.
  return typeof document !== 'undefined';
}

let reader = null;

export async function init() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
  // TRY_HARDER cuesta más CPU por frame pero sin él ZXing falla seguido con códigos
  // borrosos o en ángulo, y en iOS no hay otro motor al que recurrir.
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader = new BrowserMultiFormatReader(hints);
}

export async function detectFrame(videoEl) {
  if (!reader || videoEl.readyState < 2 || !videoEl.videoWidth) return null;
  try {
    const bitmap = BrowserCodeReader.createBinaryBitmapFromMediaElem(videoEl);
    const result = reader.decodeBitmap(bitmap);
    return result.getText();
  } catch (err) {
    if (err instanceof NotFoundException) return null;
    // Otros errores (checksum, formato) también son "nada legible en este frame".
    return null;
  }
}

export function destroy() {
  reader = null;
}
