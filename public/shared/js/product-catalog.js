// Catálogo local de existencia de producto (referencia/descripcion/ean), cacheado en
// localStorage, para validar un código escaneado antes de abrir ventana. Distinto de
// app/modules/mapear/lookup-catalog.js (ese incluye "grupo" para autocompletar).
// Si nunca hubo conexión, existsLocal() da false para todo hasta la primera sincronización.

import { apiFetch } from './api.js';
import { loadBig, saveBig } from './idb-cache.js';

const CACHE_KEY = 'gd.productCatalog.v1';

let map = new Map();
let refreshing = false;

function normalize(code) {
  return String(code ?? '').trim().toLowerCase();
}

function buildMap(rows) {
  // `codigo` puede ser la referencia o un DUN; `ref` (solo en filas de DUN) es la
  // referencia real — findLocal(code).referencia es SIEMPRE la referencia.
  return new Map(rows.map(([codigo, descripcion, ean, ref]) => [normalize(codigo), { descripcion, ean, referencia: ref || codigo }]));
}

// Se lee de IndexedDB (ver idb-cache.js: localStorage ya no alcanza para este
// tamaño). Es asíncrono: hasta que responde, el mapa está vacío y hasData() da
// false, que es justo el caso "todavía no se sabe" que los llamadores ya
// contemplan. Si la red ya trajo datos frescos antes, no se pisan con la caché.
let fresh = false;
async function loadFromStorage() {
  try {
    const rows = await loadBig(CACHE_KEY);
    if (rows && !fresh) map = buildMap(rows);
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
    fresh = true;
    map = buildMap(items);
    await saveBig(CACHE_KEY, items);
  } catch (e) {
    // Sin red o falló el servidor: sigue con lo que ya había en caché, nunca bloquea el escaneo.
    console.error('[shared/product-catalog] No se pudo actualizar el catálogo:', e.message);
  } finally {
    refreshing = false;
  }
}

export function existsLocal(code) {
  return map.has(normalize(code));
}

// Descripción + EAN conocidos localmente (sin red) — no cambian una vez creados en Variables.
export function findLocal(code) {
  return map.get(normalize(code)) || null;
}

// Si nunca se pudo descargar el catálogo, no hay forma de saber si un código existe:
// el llamador debe dejar pasar el escaneo en vez de bloquear con un falso "no encontrado".
export function hasData() {
  return map.size > 0;
}

// ¿El código escaneado es el mismo producto que `expected` (una
// referencia)? El catálogo mete al mismo EAN tanto la referencia como
// cada código "dun" (bulto) del producto — ver routes/catalog.js — así
// que dos códigos que resuelven al mismo EAN son el mismo producto,
// aunque el escaneado sea un DUN. Se usa donde se compara un escaneo
// contra un valor esperado (ej. Vencimientos): el DUN nunca se muestra,
// solo sirve para que el match no falle por escanear el bulto en vez
// de la unidad.
export function matchesCode(raw, expected) {
  if (!expected) return false;
  if (normalize(raw) === normalize(expected)) return true;
  const scanned = findLocal(raw);
  const target = findLocal(expected);
  return !!(scanned?.ean && target?.ean && scanned.ean === target.ean);
}

refresh();
window.addEventListener('online', refresh);
window.addEventListener('gd-session-ready', refresh);
