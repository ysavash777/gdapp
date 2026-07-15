/* ============================================================
   Motor de escaneo · Android / Chrome-Edge — BarcodeDetector nativo.

   Es la API del propio navegador: cero dependencias, cero descarga
   extra, y el mismo motor que ya venía funcionando. No existe en iOS
   Safari (WebKit no la implementa) — para eso está ios-engine.js.

   Contrato común con el resto de los motores (ver index.js):
     isSupported()            → boolean, sin crear nada todavía
     init()                   → prepara el detector, se llama una vez
     detectFrame(videoEl)     → intenta leer el frame actual del
                                 <video>; devuelve el código (string) o
                                 null si no encontró nada — nunca lanza
     destroy()                → libera el detector
   ============================================================ */

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
    // Frame no decodificable (movimiento, fuera de foco...): se
    // reintenta solo en el próximo ciclo del loop, no es un error real.
    return null;
  }
}

export function destroy() {
  detector = null;
}
