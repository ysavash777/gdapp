// Motor de escaneo Android/Chrome-Edge: BarcodeDetector nativo (no existe en iOS
// Safari, ver ios-engine.js). Contrato común (ver index.js): isSupported() → boolean;
// init() prepara el detector; detectFrame(videoEl) → código o null, nunca lanza; destroy().

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export const id = 'android-barcode-detector';

export function isSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

let detector = null;

export async function init() {
  detector = new window.BarcodeDetector({ formats: FORMATS });
}

export async function detectFrame(videoEl) {
  if (!detector || videoEl.readyState < 2) return null;
  try {
    const results = await detector.detect(videoEl);
    return results.length ? results[0].rawValue : null;
  } catch {
    // Frame no decodificable (movimiento, fuera de foco...): se reintenta en el próximo ciclo.
    return null;
  }
}

export function destroy() {
  detector = null;
}
