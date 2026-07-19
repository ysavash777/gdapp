/* ============================================================
   Catálogo local de existencia de producto (referencia, descripcion,
   ean) — compartido por Mapear y Consultar grupo para validar un
   código escaneado ANTES de abrir cualquier ventana. Se descarga una
   vez (GET /api/catalog/lookup) y se cachea en localStorage, igual
   que app/modules/mapear/lookup-catalog.js (que sigue existiendo
   aparte, con "grupo" incluido, porque a Mapear le sirve además para
   autocompletar esos campos — acá solo hace falta saber si el código
   existe o no).

   Si nunca hubo conexión en este dispositivo, el catálogo queda
   vacío: existsLocal() devuelve `false` para cualquier código, así
   que hasta la primera sincronización ningún escaneo abre ventana. Se
   refresca solo, sin que nadie tenga que acordarse de llamarlo: apenas
   se carga el módulo y cada vez que vuelve la conexión.
   ============================================================ */

import { apiFetch } from './api.js';

const CACHE_KEY = 'gd.productCatalog.v1';

let map = new Map();
let refreshing = false;

function normalize(code) {
  return String(code ?? '').trim().toLowerCase();
}

function buildMap(rows) {
  return new Map(rows.map(([referencia, descripcion, ean]) => [normalize(referencia), { descripcion, ean }]));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    map = buildMap(JSON.parse(raw));
  } catch (e) {
    console.error('[shared/product-catalog] No se pudo leer el catálogo cacheado:', e.message);
  }
}
loadFromStorage();

export async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { items } = await apiFetch('/api/catalog/lookup');
    map = buildMap(items);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch (e) {
      // Cuota llena o storage deshabilitado: el catálogo sigue
      // funcionando en memoria para esta sesión, solo no sobrevive un
      // reload — no hay razón para tirar abajo el refresh por esto.
      console.error('[shared/product-catalog] No se pudo persistir el catálogo:', e.message);
    }
  } catch (e) {
    // Sin red o el servidor falló: se sigue con lo que ya había en
    // caché (o vacío, si nunca se pudo traer) — nunca bloquea el
    // escaneo por esto.
    console.error('[shared/product-catalog] No se pudo actualizar el catálogo:', e.message);
  } finally {
    refreshing = false;
  }
}

export function existsLocal(code) {
  return map.has(normalize(code));
}

// Si el catálogo nunca se pudo descargar en este dispositivo (nunca
// hubo red desde el primer uso), no hay forma de saber si un código
// existe o no — los llamadores deben dejar pasar el escaneo en vez de
// bloquearlo con un "no encontrado" que en realidad es "no se sabe".
export function hasData() {
  return map.size > 0;
}

refresh();
window.addEventListener('online', refresh);
window.addEventListener('gd-session-ready', refresh);
