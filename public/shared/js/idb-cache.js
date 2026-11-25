// Caché de datos GRANDES (catálogos de productos) en IndexedDB.
//
// Por qué no localStorage: el tope es ~5 millones de caracteres por sitio, y
// los dos catálogos de productos (~35.000 filas cada uno) ya suman ~5,5
// millones. Con el almacenamiento lleno, localStorage.setItem() falla EN
// SILENCIO y deja de guardar lo importante (la cola de envío y los códigos de
// un mapeo): se escribía una cantidad/motivo, no se registraba, y al reabrir
// el SKU aparecía sin datos. IndexedDB tiene cientos de MB de margen.
//
// Migración: si todavía hay una copia vieja en localStorage, se lee, se pasa
// a IndexedDB y se borra de localStorage (libera el espacio de inmediato).
// Si el navegador no tiene IndexedDB, cae a localStorage como antes.

const DB_NAME = 'gd-cache';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('NO_IDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB_OPEN_FAILED'));
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IDB_ABORTED'));
  });
}

function removeLegacy(key) {
  try { localStorage.removeItem(key); } catch { /* nada que limpiar */ }
}

// Devuelve el array guardado, o null si no hay nada.
export async function loadBig(key) {
  try {
    const value = await idbGet(key);
    if (value) {
      removeLegacy(key); // por si quedó una copia vieja ocupando lugar
      return value;
    }
  } catch { /* sin IndexedDB: se intenta la copia vieja */ }

  let legacy = null;
  try {
    const raw = localStorage.getItem(key);
    legacy = raw ? JSON.parse(raw) : null;
  } catch { /* copia ilegible */ }
  if (!legacy) return null;

  try {
    await idbSet(key, legacy);
    removeLegacy(key);
  } catch { /* se queda en localStorage, como antes */ }
  return legacy;
}

export async function saveBig(key, value) {
  try {
    await idbSet(key, value);
    removeLegacy(key);
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Sin IndexedDB y sin lugar en localStorage: sigue en memoria, no sobrevive un reload.
      console.error('[shared/idb-cache] No se pudo persistir', key, e.message);
    }
  }
}
