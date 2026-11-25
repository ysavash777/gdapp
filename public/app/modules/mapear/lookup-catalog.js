// Catálogo local de Variables (código -> descripción/EAN/grupo), cacheado en
// localStorage para completar datos al agregar un código sin conexión.
// El servidor sigue siendo la fuente de verdad y corrige al sincronizar
// (ver store.js, evento 'add-success'). Se refresca solo, al cargar y al volver la conexión.

import { apiFetch } from '/shared/js/api.js';
import { loadBig, saveBig } from '/shared/js/idb-cache.js';

const CACHE_KEY = 'gd.mapear.lookupCatalog.v2';

let map = new Map();
let refreshing = false;

function normalize(code) {
  return String(code ?? '').trim().toLowerCase();
}

function buildMap(rows) {
  // `codigo` puede ser la referencia o un DUN; `ref` (solo en filas de DUN) es la
  // referencia real — findLocal(code).referencia es SIEMPRE la referencia.
  return new Map(rows.map(([codigo, descripcion, ean, grupo, ref]) => [normalize(codigo), { descripcion, ean, grupo, referencia: ref || codigo }]));
}

// IndexedDB, no localStorage (ver shared/js/idb-cache.js): con ~35.000 filas
// llenaba el almacenamiento y dejaba de guardarse lo importante. Asíncrono:
// hasta que responde el mapa está vacío (findLocal da null); si la red ya
// trajo datos frescos antes, no se pisan con la caché.
let fresh = false;
async function loadFromStorage() {
  try {
    const rows = await loadBig(CACHE_KEY);
    if (rows && !fresh) map = buildMap(rows);
  } catch (e) {
    console.error('[mapear/lookup-catalog] No se pudo leer el catálogo cacheado:', e.message);
  }
}
loadFromStorage();

export async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { items } = await apiFetch('/api/mapeos/lookup-catalog');
    fresh = true;
    map = buildMap(items);
    await saveBig(CACHE_KEY, items);
  } catch (e) {
    // Sin red o falló el servidor: sigue con lo último en caché, no bloquea el escaneo.
    console.error('[mapear/lookup-catalog] No se pudo actualizar el catálogo:', e.message);
  } finally {
    refreshing = false;
  }
}

export function findLocal(code) {
  return map.get(normalize(code)) || null;
}

refresh();
window.addEventListener('online', refresh);
window.addEventListener('gd-session-ready', refresh);
