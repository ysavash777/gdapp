/* ============================================================
   Módulo App · Mapear — capa de datos (hoy en memoria).

   Misma forma que tendría un cliente contra la API real: todas las
   funciones son async y devuelven objetos ya "limpios" (clonados).
   El día que exista server/routes/mapeos.js + server/store/mapeos.store.js
   (con el escaneo validando el código contra esa base), solo se
   reemplaza el cuerpo de estas funciones por llamadas a apiFetch (ver
   /shared/js/api.js) — list-view.js y editor-view.js no cambian,
   porque ya trabajan contra esta interfaz.

   Un mapeo no tiene estado "finalizado": se puede reabrir, renombrar
   y seguir editando su contenido (agregar, corregir o borrar códigos)
   todas las veces que haga falta. Cada mutación recibe quién la hizo
   (username) para poder mostrar creador/último editor en el listado.
   ============================================================ */

let mapeos = [];
let nextMapeoId = 1;
let nextCodeId = 1;

function cloneCode(c) {
  return { ...c };
}

function cloneMapeo(m) {
  return { ...m, codes: m.codes.map(cloneCode) };
}

export async function list() {
  return mapeos.map(cloneMapeo).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function get(id) {
  const m = mapeos.find((x) => x.id === id);
  return m ? cloneMapeo(m) : null;
}

export async function create(actor) {
  const now = Date.now();
  const id = nextMapeoId++;
  const mapeo = {
    id,
    title: `Mapeo #${id}`,
    createdAt: now,
    createdBy: actor || null,
    updatedAt: now,
    updatedBy: actor || null,
    codes: [],
  };
  mapeos.unshift(mapeo);
  return cloneMapeo(mapeo);
}

export async function rename(id, title, actor) {
  const mapeo = mapeos.find((x) => x.id === id);
  if (!mapeo) throw new Error('NOT_FOUND');
  const trimmed = String(title).trim();
  if (trimmed) mapeo.title = trimmed;
  mapeo.updatedAt = Date.now();
  mapeo.updatedBy = actor || mapeo.updatedBy;
  return cloneMapeo(mapeo);
}

export async function remove(id) {
  mapeos = mapeos.filter((x) => x.id !== id);
}

// La cantidad, condición y descripción quedan con valores por
// defecto/vacíos al escanear — se completan después (en el momento o
// más tarde) sin frenar el ritmo de un escaneo masivo. La descripción
// hoy se escribe a mano; cuando el escaneo valide contra una base
// real, ese campo puede llegar completo desde ahí.
export async function addCode(mapeoId, rawCode, actor) {
  const mapeo = mapeos.find((x) => x.id === mapeoId);
  if (!mapeo) throw new Error('NOT_FOUND');
  const code = String(rawCode).trim();
  if (!code) throw new Error('EMPTY_CODE');
  const entry = {
    id: nextCodeId++,
    code,
    description: '',
    quantity: 1,
    condition: null,
    scannedAt: Date.now(),
  };
  mapeo.codes.push(entry);
  mapeo.updatedAt = Date.now();
  mapeo.updatedBy = actor || mapeo.updatedBy;
  return cloneMapeo(mapeo);
}

export async function updateCode(mapeoId, codeId, patch, actor) {
  const mapeo = mapeos.find((x) => x.id === mapeoId);
  if (!mapeo) throw new Error('NOT_FOUND');
  const entry = mapeo.codes.find((c) => c.id === codeId);
  if (!entry) throw new Error('NOT_FOUND');
  Object.assign(entry, patch);
  mapeo.updatedAt = Date.now();
  mapeo.updatedBy = actor || mapeo.updatedBy;
  return cloneMapeo(mapeo);
}

export async function removeCode(mapeoId, codeId, actor) {
  const mapeo = mapeos.find((x) => x.id === mapeoId);
  if (!mapeo) throw new Error('NOT_FOUND');
  mapeo.codes = mapeo.codes.filter((c) => c.id !== codeId);
  mapeo.updatedAt = Date.now();
  mapeo.updatedBy = actor || mapeo.updatedBy;
  return cloneMapeo(mapeo);
}
