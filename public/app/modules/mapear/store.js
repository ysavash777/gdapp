/* ============================================================
   Módulo App · Mapear — capa de datos (hoy en memoria).

   Misma forma que tendría un cliente contra la API real: todas las
   funciones son async y devuelven objetos ya "limpios" (clonados).
   El día que exista server/routes/mapeos.js + server/store/mapeos.store.js,
   solo se reemplaza el cuerpo de estas funciones por llamadas a
   apiFetch (ver /shared/js/api.js) — list-view.js y scanner-view.js
   no cambian, porque ya trabajan contra esta interfaz.
   ============================================================ */

let mapeos = [];
let nextId = 1;

function clone(m) {
  return { ...m, codes: m.codes.map((c) => ({ ...c })) };
}

export async function list() {
  return mapeos.map(clone).sort((a, b) => b.createdAt - a.createdAt);
}

export async function get(id) {
  const m = mapeos.find((x) => x.id === id);
  return m ? clone(m) : null;
}

export async function create() {
  const mapeo = { id: nextId++, createdAt: Date.now(), finishedAt: null, codes: [] };
  mapeos.unshift(mapeo);
  return clone(mapeo);
}

export async function addCode(id, rawCode) {
  const mapeo = mapeos.find((x) => x.id === id);
  if (!mapeo) throw new Error('NOT_FOUND');
  const code = String(rawCode).trim();
  if (!code) throw new Error('EMPTY_CODE');
  const duplicate = mapeo.codes.some((c) => c.code === code);
  mapeo.codes.push({ code, scannedAt: Date.now(), duplicate });
  return clone(mapeo);
}

export async function finish(id) {
  const mapeo = mapeos.find((x) => x.id === id);
  if (!mapeo) throw new Error('NOT_FOUND');
  mapeo.finishedAt = Date.now();
  return clone(mapeo);
}
