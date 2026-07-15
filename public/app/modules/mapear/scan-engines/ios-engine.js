/* ============================================================
   Motor de escaneo · iOS Safari — ZXing (decodificación por software).

   Safari en iOS no implementa BarcodeDetector (ver android-engine.js),
   así que acá no hay API nativa a la que recurrir: se decodifica cada
   frame "a mano" con la librería ZXing (github.com/zxing-js), la
   misma que usan la mayoría de los escáneres web robustos para este
   caso. Se carga solo cuando este motor se selecciona (ver
   scan-engines/index.js) — nunca se descarga en Android.

   El bundle usado acá (/shared/js/vendor/zxing.bundle.js) es un
   empaquetado propio de @zxing/browser + @zxing/library en un único
   archivo ESM, generado con `npm run build:zxing` (ver
   build/zxing-entry.js) — este proyecto no tiene paso de build para
   el resto de la app, así que el resultado queda comiteado como
   cualquier otro estático y solo se regenera a mano si se actualiza
   la versión de la librería.

   Mismo contrato que android-engine.js: isSupported / init /
   detectFrame(videoEl) / destroy — detectFrame nunca lanza, siempre
   devuelve el código leído o null.
   ============================================================ */

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
  // No depende de ninguna API experimental: solo necesita poder crear
  // un <canvas> y leer sus píxeles, algo universal en cualquier
  // navegador con getUserMedia (ya validado antes de llegar acá).
  return typeof document !== 'undefined';
}

let reader = null;

export async function init() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
  // TRY_HARDER cuesta más CPU por frame pero es lo que hace robusto el
  // motor alternativo: sin él, ZXing falla seguido con códigos
  // borrosos o en ángulo — justo el caso que este motor tiene que
  // cubrir mejor que nadie, porque no hay otra opción en iOS.
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
    // Otros errores (checksum, formato) también significan "en este
    // frame no había nada legible" — se reintenta en el siguiente.
    return null;
  }
}

export function destroy() {
  reader = null;
}
