/* ============================================================
   Módulo App · Mapear — catálogo local de Referencia (código
   escaneado -> descripción + EAN corto), para completar esos datos
   al agregar un código incluso SIN conexión.

   Se descarga una vez (GET /api/mapeos/lookup-catalog) y se cachea
   en localStorage — el servidor sigue siendo la fuente de verdad;
   esto es una copia de lectura, best-effort, que además el propio
   servidor corrige apenas el código sincroniza (ver store.js, evento
   'add-success'). Si nunca hubo conexión en este dispositivo, el
   catálogo queda vacío y los campos se muestran sin dato — no hay
   forma de adivinarlos sin haberlos visto antes al menos una vez.

   Se refresca solo, sin que nadie tenga que acordarse de llamarlo:
   apenas se carga el módulo y cada vez que vuelve la conexión.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';

const CACHE_KEY = 'gd.mapear.lookupCatalog.v1';

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
      // Cuota llena o storage deshabilitado: el catálogo sigue
      // funcionando en memoria para esta sesión, solo no sobrevive un
      // reload — no hay razón para tirar abajo el refresh por esto.
      console.error('[mapear/lookup-catalog] No se pudo persistir el catálogo:', e.message);
    }
  } catch (e) {
    // Sin red o el servidor falló: se sigue con lo que ya había en
    // caché (o vacío, si nunca se pudo traer) — nunca bloquea el
    // escaneo por esto.
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
