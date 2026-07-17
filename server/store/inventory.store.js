/* ============================================================
   Repositorio del inventario "referencia" traído de Copernico WMS.

   Hoy vive en memoria + un espejo en disco (server/data/inventory.json)
   para sobrevivir un restart sin tener que golpear la API de vuelta.
   Cuando exista Supabase, replaceAll() es el único método que cambia:
   en vez de guardar en este proceso, hace el upsert por lotes contra
   la tabla real — list()/getMeta() pueden seguir leyendo de acá como
   caché local, o delegar también; el resto de la app (rutas, UI) no
   se entera del cambio porque sigue llamando a esta misma interfaz.

   Filas genéricas: la API de referencia trae ~30 columnas y no
   sabemos de antemano cuáles — en vez de mapear a un esquema fijo
   (que se rompería si Copernico agrega/renombra una columna), cada
   fila guarda todas las claves que trajo la API, saneadas para ser
   un nombre de columna válido en Supabase (snake_case, sin acentos
   ni caracteres raros). meta.columns lista el set real descubierto
   en la última corrida.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'inventory.json');

let rows = [];       // [{ _row_id, ...columnas saneadas }]
let haystacks = [];  // haystacks[i] = texto en minúsculas de rows[i], para buscar rápido
let meta = { lastUpdatedAt: null, rowCount: 0, bodega: null, columns: [], durationMs: null };

function sanitizeKey(key) {
  return String(key)
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos (tras NFD)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'col';
}

function normalizeRow(raw, index) {
  const out = { _row_id: index };
  for (const key in raw) {
    const value = raw[key];
    out[sanitizeKey(key)] = value == null ? null : value;
  }
  return out;
}

function buildHaystack(row) {
  return Object.values(row).filter((v) => v != null).join(' ').toLowerCase();
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ meta, rows }));
    fs.renameSync(tmpFile, DATA_FILE); // rename es atómico: nunca queda un archivo a medio escribir
  } catch (e) {
    // Persistir en disco es un "nice to have" (sobrevivir un restart);
    // si falla (disco lleno, permisos), la corrida en memoria sigue
    // siendo válida — no tiene sentido tirar abajo el refresh por esto.
    console.error('[inventory.store] No se pudo persistir en disco:', e.message);
  }
}

function restore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    rows = saved.rows || [];
    meta = saved.meta || meta;
    haystacks = rows.map(buildHaystack);
  } catch (e) {
    console.error('[inventory.store] No se pudo restaurar el caché en disco:', e.message);
  }
}
restore();

// Reemplaza todo el set de datos por el resultado de una corrida
// nueva — atómico desde el punto de vista de los lectores: hasta que
// esta función termina, list()/getMeta() sigue devolviendo los datos
// anteriores (nunca un estado a medio actualizar).
function replaceAll(rawRows, { bodega, durationMs } = {}) {
  const newRows = rawRows.map(normalizeRow);
  const newHaystacks = newRows.map(buildHaystack);
  const columns = newRows.length
    ? Object.keys(newRows[0]).filter((k) => k !== '_row_id')
    : [];

  rows = newRows;
  haystacks = newHaystacks;
  meta = {
    lastUpdatedAt: new Date().toISOString(),
    rowCount: rows.length,
    bodega: bodega ?? meta.bodega,
    columns,
    durationMs: durationMs ?? null,
  };
  persist();
  return meta;
}

function getMeta() {
  return { ...meta };
}

// Paginado + búsqueda de substring en cualquier columna — nunca
// devuelve más de `pageSize` filas, así el navegador jamás tiene que
// cargar las 12.000 en memoria de una sola vez.
function list({ q = '', page = 1, pageSize = 50, sortBy = null, sortDir = 1 } = {}) {
  const term = q.trim().toLowerCase();
  let indices = rows.map((_, i) => i);

  if (term) {
    indices = indices.filter((i) => haystacks[i].includes(term));
  }

  if (sortBy && rows[0] && sortBy in rows[0]) {
    indices.sort((ia, ib) => {
      const a = rows[ia][sortBy];
      const b = rows[ib][sortBy];
      const an = parseFloat(a), bn = parseFloat(b);
      const cmp = (a != null && b != null && !isNaN(an) && !isNaN(bn))
        ? an - bn
        : String(a ?? '').localeCompare(String(b ?? ''), 'es');
      return cmp * sortDir;
    });
  }

  const total = indices.length;
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * safePageSize;

  const items = indices.slice(start, start + safePageSize).map((i) => rows[i]);

  return { items, total, page: safePage, pageSize: safePageSize, totalPages };
}

module.exports = { replaceAll, getMeta, list };
