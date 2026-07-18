/* ============================================================
   Módulo App · Mapear — capa de datos.

   Cliente de /api/mapeos (server/routes/mapeos.js + store/mapeos.store.js,
   Supabase) — con una caché local offline-first para los CÓDIGOS de
   un mapeo ya abierto: addCode/updateCode/removeCode escriben primero
   en localStorage y devuelven al instante, sin esperar la red — el
   envío real a la base ocurre después, en segundo plano, vía
   sync-engine.js. Así un corte de conexión a mitad de un escaneo
   nunca bloquea seguir escaneando.

   list()/create()/rename()/remove() (a nivel mapeo, no código) siguen
   siendo llamadas de red directas sin caché: crear o renombrar un
   mapeo entero sí requiere conexión — lo que tiene que sobrevivir sin
   red es seguir agregando códigos a uno que ya existe, que es el caso
   real de un operario caminando el depósito.

   Cada código de la caché lleva un `syncStatus`: 'syncing' (recién
   local, todavía no confirmado), 'synced' (ya está en la base) u
   'offline' (se intentó y no hay conexión — sigue en cola). Es un
   campo puramente de UI, nunca se manda al servidor.

   Misma forma de funciones que el store en memoria original
   (incluido el parámetro `actor` en las mutaciones, que ya no se usa:
   el servidor fija el autor desde la sesión) — list-view.js sigue
   llamando exactamente igual. editor-view.js solo suma `subscribe()`
   para enterarse cuando el estado de sincronización de un código
   cambia en segundo plano (para redibujar su ícono).

   Cada código también lleva un `clientId`: un identificador estable
   que nunca cambia, a diferencia de `id` (que empieza siendo un id
   temporal de texto y pasa a ser el id real numérico apenas el alta
   se confirma). editor-view.js debe usar `clientId` para encontrar UN
   código dado a lo largo de toda su edición (nunca guardar `id` en
   una variable de larga vida) — si guarda `id` y el remapeo ocurre
   mientras el usuario todavía está completando el registro (con
   buena conexión puede pasar en menos de un segundo), un updateCode
   contra el id viejo ya no encuentra nada y la edición se pierde en
   silencio.

   addCode también completa descripción y EAN al instante (antes de
   cualquier red) contra lookup-catalog.js, un catálogo local liviano
   de Referencia — así se ven incluso sin conexión, no solo una vez
   que el motor de sync confirma el alta (que sigue corrigiendo estos
   mismos campos con el dato fresco del servidor apenas puede).

   list() SÍ tiene una caché de respaldo (`gd.mapear.listCache.v1`):
   sin ella, reabrir la app entera sin conexión (no solo seguir
   escaneando dentro de un mapeo ya abierto) dejaba la pantalla de
   Mapear sin nada para mostrar. Cada list() bueno actualiza esa
   foto; si la llamada de red falla por falta de conexión, se usa la
   última foto buena, pisando cada mapeo con su propia caché
   individual si esta tiene algo más nuevo (ediciones locales que
   todavía no llegaron a figurar en ningún listado exitoso). Un error
   real del servidor (permisos, 500) NO cae a la caché — solo la
   falta de red hace ese fallback, para no esconder un problema real
   detrás de datos viejos.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';
import * as syncEngine from './sync-engine.js';
import * as lookupCatalog from './lookup-catalog.js';

const CACHE_PREFIX = 'gd.mapear.cache.';

function cacheKey(id) {
  return `${CACHE_PREFIX}${id}`;
}

function loadCache(id) {
  try {
    const raw = localStorage.getItem(cacheKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCache(id, entry) {
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify(entry));
  } catch (e) {
    console.error('[mapear/store] No se pudo persistir la caché local:', e.message);
  }
}

function clearCache(id) {
  try {
    localStorage.removeItem(cacheKey(id));
  } catch { /* nada que limpiar */ }
}

const LIST_CACHE_KEY = 'gd.mapear.listCache.v1';

function saveListCache(items) {
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('[mapear/store] No se pudo persistir el listado en caché:', e.message);
  }
}

function loadListCache() {
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function removeFromListCache(id) {
  const cached = loadListCache();
  if (!cached) return;
  saveListCache(cached.filter((m) => m.id !== id));
}

// fetch() rechaza con TypeError cuando no hay red — cualquier otro
// error ya es una respuesta real del servidor (permisos, 500, etc.),
// que no debe esconderse detrás de una caché vieja.
function isNetworkFailure(err) {
  return err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

function metaOf(mapeo) {
  const { codes, ...meta } = mapeo;
  return meta;
}

// Server (verdad) + lo que la caché local todavía no pudo mandar
// (altas con id temporal, o ediciones/bajas con un trabajo pendiente)
// — para no perder trabajo hecho offline al reabrir un mapeo ya
// sincronizado antes en este dispositivo.
function mergeAndCache(id, serverMapeo) {
  const cached = loadCache(id) || { codes: [] };
  const pendingLocalOnly = cached.codes.filter((c) => typeof c.id === 'string');
  const codes = serverMapeo.codes
    .map((c) => {
      const local = cached.codes.find((x) => x.id === c.id);
      if (local && local.syncStatus !== 'synced') {
        return { ...c, ...local, syncStatus: local.syncStatus };
      }
      // Sin edición local pendiente: clientId es el del último local
      // conocido si lo había, o el id real (ya estable para siempre)
      // si esta es la primera vez que se ve este código.
      return { ...c, clientId: local?.clientId ?? c.id, syncStatus: 'synced' };
    })
    .concat(pendingLocalOnly);
  const merged = { ...serverMapeo, codes };
  saveCache(id, { mapeo: metaOf(merged), codes: merged.codes });
  return merged;
}

// ---- Suscripción a cambios en segundo plano ----

const listeners = new Map(); // mapeoId -> Set<fn(codes)>

export function subscribe(mapeoId, cb) {
  if (!listeners.has(mapeoId)) listeners.set(mapeoId, new Set());
  listeners.get(mapeoId).add(cb);
  return () => listeners.get(mapeoId)?.delete(cb);
}

function notify(mapeoId) {
  const subs = listeners.get(mapeoId);
  if (!subs || !subs.size) return;
  const cache = loadCache(mapeoId);
  subs.forEach((cb) => cb(cache ? cache.codes : []));
}

syncEngine.onEvent((evt) => {
  const cache = loadCache(evt.mapeoId);
  if (!cache) return;

  if (evt.type === 'sending') {
    const entry = cache.codes.find((c) => c.id === evt.codeId);
    if (entry && entry.syncStatus !== 'synced') entry.syncStatus = 'syncing';
  } else if (evt.type === 'add-success') {
    // El servidor devuelve el mapeo completo — el código nuevo es el
    // único id real que todavía no conocíamos localmente.
    const knownIds = cache.codes.filter((c) => typeof c.id === 'number').map((c) => c.id);
    const newRow = evt.mapeo.codes.find((c) => !knownIds.includes(c.id));
    if (newRow) {
      syncEngine.remapId(evt.mapeoId, evt.codeId, newRow.id);
      const entry = cache.codes.find((c) => c.id === evt.codeId);
      if (entry) {
        entry.id = newRow.id;
        entry.description = newRow.description;
        entry.ean = newRow.ean;
        entry.scannedAt = newRow.scannedAt;
        entry.touchedAt = newRow.touchedAt;
        entry.syncStatus = 'synced';
      }
    }
  } else if (evt.type === 'update-success') {
    const entry = cache.codes.find((c) => c.id === evt.codeId);
    if (entry) entry.syncStatus = 'synced';
  } else if (evt.type === 'remove-success') {
    // Ya se sacó de la caché al pedir el borrado — nada más que hacer.
  } else if (evt.type === 'offline') {
    const entry = cache.codes.find((c) => c.id === evt.codeId);
    if (entry) entry.syncStatus = 'offline';
  } else if (evt.type === 'error') {
    if (evt.kind === 'add') {
      cache.codes = cache.codes.filter((c) => c.id !== evt.codeId);
    } else {
      const entry = cache.codes.find((c) => c.id === evt.codeId);
      if (entry) entry.syncStatus = 'offline';
    }
  }

  saveCache(evt.mapeoId, cache);
  notify(evt.mapeoId);
});

// ---- Mapeos (nivel mapeo — siempre red directa) ----

export async function list() {
  try {
    const { items } = await apiFetch('/api/mapeos');
    const merged = items.map((m) => mergeAndCache(m.id, m));
    saveListCache(merged);
    return merged;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    const cached = loadListCache();
    if (!cached) throw err;
    // Un mapeo puede tener, en su propia caché individual, algo más
    // nuevo que lo que había en la última foto del listado (se abrió
    // y se le agregó un código después del último list() bueno) — esa
    // caché propia gana si existe.
    return cached.map((m) => {
      const own = loadCache(m.id);
      return own ? { ...own.mapeo, codes: own.codes } : m;
    });
  }
}

export async function get(id) {
  let serverMapeo;
  try {
    const { mapeo } = await apiFetch(`/api/mapeos/${id}`);
    serverMapeo = mapeo;
  } catch (err) {
    if (err.message === 'NOT_FOUND') return null;
    // Sin red: si ya se abrió este mapeo antes en este dispositivo,
    // se sigue desde la última caché conocida en vez de dejar al
    // operario sin poder escanear.
    const cached = loadCache(id);
    if (cached) return { ...cached.mapeo, codes: cached.codes };
    throw err;
  }
  return mergeAndCache(id, serverMapeo);
}

export async function create(actor, title) {
  const { mapeo } = await apiFetch('/api/mapeos', { method: 'POST', body: { title } });
  saveCache(mapeo.id, { mapeo: metaOf(mapeo), codes: mapeo.codes.map((c) => ({ ...c, clientId: c.id, syncStatus: 'synced' })) });
  return mapeo;
}

export async function rename(id, title, actor) {
  const { mapeo } = await apiFetch(`/api/mapeos/${id}`, { method: 'PATCH', body: { title } });
  return mergeAndCache(id, mapeo);
}

export async function remove(id) {
  await apiFetch(`/api/mapeos/${id}`, { method: 'DELETE' });
  syncEngine.cancelMapeo(id);
  clearCache(id);
  removeFromListCache(id);
}

// ---- Códigos (offline-first: local primero, red en segundo plano) ----

export async function addCode(mapeoId, rawCode, actor) {
  const code = String(rawCode).trim();
  if (!code) throw new Error('EMPTY_CODE');

  const cache = loadCache(mapeoId) || { mapeo: { id: mapeoId }, codes: [] };
  const now = new Date().toISOString();
  const localId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const local = lookupCatalog.findLocal(code);
  const entry = {
    id: localId,
    clientId: localId,
    code,
    description: local?.descripcion || '',
    ean: local?.ean || '',
    quantity: 1,
    condition: null,
    expiryDate: null,
    roturaResponsible: null,
    customReason: '',
    scannedAt: now,
    touchedAt: now,
    syncStatus: 'syncing',
  };
  cache.codes = [...cache.codes, entry];
  cache.mapeo = { ...cache.mapeo, updatedAt: now };
  saveCache(mapeoId, cache);

  syncEngine.enqueueAdd(mapeoId, localId, code);
  return { ...cache.mapeo, codes: cache.codes };
}

export async function updateCode(mapeoId, codeId, patch, actor) {
  const cache = loadCache(mapeoId);
  if (!cache) throw new Error('NOT_FOUND');
  const entry = cache.codes.find((c) => c.id === codeId);
  if (!entry) throw new Error('NOT_FOUND');

  const now = new Date().toISOString();
  Object.assign(entry, patch, { touchedAt: now });
  if (entry.syncStatus === 'synced') entry.syncStatus = 'syncing';
  cache.mapeo = { ...cache.mapeo, updatedAt: now };
  saveCache(mapeoId, cache);

  syncEngine.enqueueUpdate(mapeoId, codeId, patch);
  return { ...cache.mapeo, codes: cache.codes };
}

export async function removeCode(mapeoId, codeId, actor) {
  const cache = loadCache(mapeoId);
  if (!cache) throw new Error('NOT_FOUND');

  cache.codes = cache.codes.filter((c) => c.id !== codeId);
  cache.mapeo = { ...cache.mapeo, updatedAt: new Date().toISOString() };
  saveCache(mapeoId, cache);

  syncEngine.enqueueRemove(mapeoId, codeId);
  return { ...cache.mapeo, codes: cache.codes };
}
