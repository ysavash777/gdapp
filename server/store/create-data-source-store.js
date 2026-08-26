// Fábrica de repositorios para cada fuente de datos de Copernico
// (referencia, coordenadas, etc): en memoria + espejo en disco, columnas
// genéricas, paginado+búsqueda, y status de tres estados (empty/ok/error).

const fs = require('fs');
const path = require('path');
const supabaseSync = require('../services/supabase-sync');

const DATA_DIR = path.join(__dirname, '..', 'data');

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

function createDataSourceStore(name, supabaseTable) {
  const DATA_FILE = path.join(DATA_DIR, `${name}.json`);

  let rows = [];
  let haystacks = [];
  // status: 'empty' | 'ok' | 'error' (rowCount/lastUpdatedAt quedan con
  // el último dato bueno aunque la corrida más reciente haya fallado).
  let meta = {
    status: 'empty',
    lastUpdatedAt: null,
    rowCount: 0,
    bodega: null,
    columns: [],
    durationMs: null,
    lastError: null,
    // mirrorStatus es independiente de `status`: refleja si el espejo en
    // Supabase (lo único que sobrevive un restart/deploy) también salió
    // bien, pueden discrepar (bug real: Copernico OK pero espejo
    // fallando en silencio — ver services/supabase-sync.js).
    mirrorStatus: 'unknown',
    mirrorError: null,
    // Duración real del espejo (durationMs es solo Copernico) — la usa
    // el estimador de la barra de progreso en shared/js/db-refresh.js.
    mirrorDurationMs: null,
  };

  function persist() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmpFile = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify({ meta, rows }));
      fs.renameSync(tmpFile, DATA_FILE); // rename es atómico
    } catch (e) {
      // Persistir es "nice to have" (sobrevivir un restart); si falla,
      // la corrida en memoria sigue siendo válida.
      console.error(`[${name}.store] No se pudo persistir en disco:`, e.message);
    }
  }

  function restore() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      rows = saved.rows || [];
      meta = { ...meta, ...(saved.meta || {}) };
      haystacks = rows.map(buildHaystack);
    } catch (e) {
      console.error(`[${name}.store] No se pudo restaurar el caché en disco:`, e.message);
    }
  }
  restore();

  // Reemplaza todo el set de datos — atómico para los lectores: hasta que
  // termina, list()/getMeta() siguen devolviendo los datos anteriores.
  function replaceAll(rawRows, { bodega, durationMs } = {}) {
    const newRows = rawRows.map(normalizeRow);
    const newHaystacks = newRows.map(buildHaystack);
    const columns = newRows.length
      ? Object.keys(newRows[0]).filter((k) => k !== '_row_id')
      : [];

    rows = newRows;
    haystacks = newHaystacks;
    // `...meta` primero: preserva mirrorStatus/mirrorError/mirrorDurationMs
    // hasta que recordMirror() los actualice (llega unos ms después).
    meta = {
      ...meta,
      status: 'ok',
      lastUpdatedAt: new Date().toISOString(),
      rowCount: rows.length,
      bodega: bodega ?? meta.bodega,
      columns,
      durationMs: durationMs ?? null,
      lastError: null,
    };
    persist();
    return meta;
  }

  // Registra que la corrida falló sin tocar los datos de la última
  // corrida exitosa (si hay).
  function recordError(error) {
    meta = {
      ...meta,
      status: 'error',
      lastError: { code: error?.code || 'UNKNOWN', message: error?.message || null, at: new Date().toISOString() },
    };
    persist();
    return meta;
  }

  // Se llama al arrancar (server/index.js). El caché en disco no sobrevive
  // un deploy en Render (contenedor nuevo), así que sin esto la tarjeta
  // queda "vacía" hasta un refresh manual aunque Supabase tenga datos
  // buenos. Si restore() ya trajo algo del disco, no pisa nada.
  async function hydrateFromSupabase() {
    if (meta.status !== 'empty' || !supabaseTable) return;
    try {
      const { skipped, rows: dbRows } = await supabaseSync.loadTable(supabaseTable);
      if (skipped || !dbRows.length) return;
      // `synced_at` (mismo valor en todas las filas) es el horario real de
      // la corrida — replaceAll() sola pondría "ahora" como lastUpdatedAt,
      // que en un hidratado sería la hora del deploy, no la de Copernico.
      const realSyncedAt = dbRows.reduce((max, r) => (r.synced_at && r.synced_at > max ? r.synced_at : max), '');
      const cleaned = dbRows.map(({ id, synced_at, ...rest }) => rest);
      replaceAll(cleaned);
      if (realSyncedAt) {
        meta = { ...meta, lastUpdatedAt: realSyncedAt };
        persist();
      }
      console.log(`[${name}.store] Hidratado desde Supabase: ${cleaned.length} filas (corrida real: ${realSyncedAt || 'desconocida'}).`);
    } catch (e) {
      console.error(`[${name}.store] No se pudo hidratar desde Supabase:`, e.message);
    }
  }

  // Búsqueda exacta (case-insensitive, sin espacios) por columna saneada.
  function findBy(column, value) {
    const needle = String(value ?? '').trim().toLowerCase();
    if (!needle) return null;
    return rows.find((r) => String(r[column] ?? '').trim().toLowerCase() === needle) || null;
  }

  function getMeta() {
    return { ...meta };
  }

  // No se persiste a disco: es info de la corrida puntual, no del último dato bueno.
  function recordMirror(ok, error, durationMs) {
    meta = {
      ...meta,
      mirrorStatus: ok ? 'ok' : 'error',
      mirrorError: ok ? null : (error || 'UNKNOWN'),
      mirrorDurationMs: durationMs ?? meta.mirrorDurationMs,
    };
    return meta;
  }

  // Filas saneadas sin _row_id interno; no pagina (uso server-side).
  function getRowsForExport() {
    return rows.map(({ _row_id, ...rest }) => rest);
  }

  // Paginado + búsqueda de substring en cualquier columna.
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

  return { replaceAll, recordError, recordMirror, getMeta, getRowsForExport, list, hydrateFromSupabase, findBy };
}

module.exports = createDataSourceStore;
