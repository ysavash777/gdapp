// Catálogo local de existencia de producto (referencia/descripcion/ean), cacheado en
// localStorage, para validar un código escaneado antes de abrir ventana. Distinto de
// app/modules/mapear/lookup-catalog.js (ese incluye "grupo" para autocompletar).
// Si nunca hubo conexión, existsLocal() da false para todo hasta la primera sincronización.

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
      // Cuota llena o storage deshabilitado: sigue en memoria, solo no sobrevive un reload.
      console.error('[shared/product-catalog] No se pudo persistir el catálogo:', e.message);
    }
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

refresh();
window.addEventListener('online', refresh);
window.addEventListener('gd-session-ready', refresh);
