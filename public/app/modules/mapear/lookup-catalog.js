// Catálogo local de Variables (código -> descripción/EAN/grupo), cacheado en
// localStorage para completar datos al agregar un código sin conexión.
// El servidor sigue siendo la fuente de verdad y corrige al sincronizar
// (ver store.js, evento 'add-success'). Se refresca solo, al cargar y al volver la conexión.

import { apiFetch } from '/shared/js/api.js';

const CACHE_KEY = 'gd.mapear.lookupCatalog.v2';

let map = new Map();
let refreshing = false;

function normalize(code) {
  return String(code ?? '').trim().toLowerCase();
}

function buildMap(rows) {
  return new Map(rows.map(([referencia, descripcion, ean, grupo]) => [normalize(referencia), { descripcion, ean, grupo }]));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    map = buildMap(JSON.parse(raw));
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
    map = buildMap(items);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch (e) {
      // Cuota llena o storage deshabilitado: sigue en memoria, no sobrevive reload.
      console.error('[mapear/lookup-catalog] No se pudo persistir el catálogo:', e.message);
    }
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
