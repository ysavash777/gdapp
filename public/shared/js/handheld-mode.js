// Modo Handheld (Configuración de la app): en TODAS las herramientas que
// escanean, la cámara se reemplaza por un campo de texto pensado para los
// handhelds con escáner integrado (el escáner "tipea" el código y manda Enter).
// Apagado por defecto; se guarda por dispositivo en el navegador.
//
// Se aplica al abrir cada herramienta (createCameraScanner lo lee al crearse),
// y deja la clase "handheld-mode" en <html> para los ajustes de estilo.

const KEY = 'gd.handheldMode.v1';

export function isHandheldMode() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function applyClass() {
  document.documentElement.classList.toggle('handheld-mode', isHandheldMode());
}

export function setHandheldMode(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch (e) {
    console.error('[shared/handheld-mode] No se pudo guardar el modo:', e.message);
  }
  applyClass();
}

applyClass();
