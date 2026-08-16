/* ============================================================
   Paleta de color de las tarjetas de herramientas (home de /app) —
   3 opciones a elección en Configuración > Colores de herramientas.
   Los 3 juegos de colores viven siempre en :root como --pal-{a,b,c}-*
   (ver app.css); esto solo decide cuál de los tres alias --tool-*
   usa, vía [data-tool-theme] en <html>. Por dispositivo (localStorage,
   no por usuario): es una preferencia visual, no un dato de cuenta.
   ============================================================ */

const KEY = 'gd.toolTheme.v1';

export const THEMES = [
  { id: 'a', label: 'Paleta 1' },
  { id: 'b', label: 'Paleta 2' },
  { id: 'c', label: 'Paleta 3' },
];

export function getToolTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // localStorage deshabilitado: se usa la paleta por defecto (A).
  }
  return THEMES.some((t) => t.id === saved) ? saved : 'a';
}

export function applyToolTheme(id) {
  document.documentElement.dataset.toolTheme = id;
}

export function setToolTheme(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch (e) {
    console.error('[tool-theme] No se pudo guardar la preferencia:', e.message);
  }
  applyToolTheme(id);
}
