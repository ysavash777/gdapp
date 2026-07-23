/* ============================================================
   Fábrica de repositorios para cada fuente de datos de Copernico
   (referencia, coordenadas, y las que vengan después) — misma forma
   exacta para todas: en memoria + espejo en disco, columnas
   genéricas (cada API trae sus propias claves, sin esquema fijo),
   paginado+búsqueda, y un status de tres estados para el ícono de
   la tarjeta en el desk (empty/ok/error).

   Cuando exista Supabase, replaceAll() es el único método que
   cambia por fuente: en vez de guardar en este proceso, hace el
   upsert por lotes contra la tabla real — list()/getMeta() pueden
   seguir leyendo de acá como caché local. El resto de la app no se
   entera del cambio porque sigue llamando a esta misma interfaz.
   ============================================================ */

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
  // status: 'empty' (nunca se corrió con éxito) | 'ok' (última corrida
  // OK) | 'error' (la última corrida falló — rowCount/lastUpdatedAt
  // quedan con el último dato bueno que haya, si lo hay, para no
  // perderlo solo porque el intento más reciente no salió).
  let meta = {
    status: 'empty',
    lastUpdatedAt: null,
    rowCount: 0,
    bodega: null,
    columns: [],
    durationMs: null,
    lastError: null,
    // Independiente de `status`: ese refleja si COPERNICO contestó
    // bien, este si el espejo en SUPABASE (lo único que sobrevive un
    // restart/deploy en Render) también lo logró — pueden discrepar
    // (ver el bug real de inventario_cajas en services/supabase-sync.js,
    // donde Copernico contestaba bien pero el espejo fallaba SIEMPRE,
    // en silencio, hasta que un restart mostraba datos viejos de la nada).
    mirrorStatus: 'unknown',
    mirrorError: null,
    // Tiempo real del espejo en Supabase de la última corrida (éxito o
    // error) — junto con durationMs (que es solo Copernico), es lo que
    // usa el estimador de la barra de progreso (shared/js/db-refresh.js)
    // para calcular cuánto va a tardar de punta a punta, en vez de
    // adivinar un número fijo igual para todas las fuentes.
    mirrorDurationMs: null,
  };

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

  // Reemplaza todo el set de datos por el resultado de una corrida
  // nueva — atómico desde el punto de vista de los lectores: hasta
  // que esta función termina, list()/getMeta() sigue devolviendo los
  // datos anteriores (nunca un estado a medio actualizar).
  function replaceAll(rawRows, { bodega, durationMs } = {}) {
    const newRows = rawRows.map(normalizeRow);
    const newHaystacks = newRows.map(buildHaystack);
    const columns = newRows.length
      ? Object.keys(newRows[0]).filter((k) => k !== '_row_id')
      : [];

    rows = newRows;
    haystacks = newHaystacks;
    // `...meta` primero: preserva mirrorStatus/mirrorError/
    // mirrorDurationMs de la corrida anterior hasta que recordMirror()
    // los actualice de nuevo (pasa unos cientos de ms después, para la
    // misma fuente) — sin esto, quedaban en `undefined` (ni siquiera el
    // 'unknown' inicial) durante esa ventana.
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

  // Registra que la corrida más reciente falló, sin tocar los datos
  // de la última corrida exitosa (si hay) — el card de estado pasa a
  // "error" para avisar que hay que reintentar, pero no se pierde lo
  // que ya estaba cargado.
  function recordError(error) {
    meta = {
      ...meta,
      status: 'error',
      lastError: { code: error?.code || 'UNKNOWN', message: error?.message || null, at: new Date().toISOString() },
    };
    persist();
    return meta;
  }

  // Se llama una vez al arrancar el proceso (ver server/index.js). El
  // caché en disco (restore(), arriba) solo sobrevive un restart local
  // — en Render cada deploy es un contenedor nuevo sin ese archivo, así
  // que sin esto la tarjeta queda "vacía" hasta que alguien aprieta
  // "Actualizar DB" a mano, aunque Supabase ya tenga la última corrida
  // buena. Si el disco ya trajo algo (restore() encontró el archivo),
  // no pisa nada — Supabase es el respaldo, no la fuente de verdad
  // mientras el proceso esté vivo.
  async function hydrateFromSupabase() {
    if (meta.status !== 'empty' || !supabaseTable) return;
    try {
      const { skipped, rows: dbRows } = await supabaseSync.loadTable(supabaseTable);
      if (skipped || !dbRows.length) return;
      // El horario real de la corrida es `synced_at` de las filas (todas
      // comparten el mismo valor, puesto por replaceTable) — replaceAll()
      // por sí sola pondría "ahora" como lastUpdatedAt, que en un
      // hidratado es la hora del deploy/login, no la de la última
      // corrida real contra Copernico.
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

  // Búsqueda exacta (case-insensitive, sin espacios) por una columna
  // ya saneada — la usa Mapear para completar la descripción de un
  // código recién escaneado comparando contra la columna "referencia"
  // de esta misma fuente (ver store/mapeos.store.js).
  function findBy(column, value) {
    const needle = String(value ?? '').trim().toLowerCase();
    if (!needle) return null;
    return rows.find((r) => String(r[column] ?? '').trim().toLowerCase() === needle) || null;
  }

  function getMeta() {
    return { ...meta };
  }

  // Lo llama inventory-engine.js después de cada intento de espejar
  // esta fuente en Supabase (éxito o error) — no se persiste a disco:
  // es información de esta corrida puntual, no del último dato bueno.
  function recordMirror(ok, error, durationMs) {
    meta = {
      ...meta,
      mirrorStatus: ok ? 'ok' : 'error',
      mirrorError: ok ? null : (error || 'UNKNOWN'),
      mirrorDurationMs: durationMs ?? meta.mirrorDurationMs,
    };
    return meta;
  }

  // Filas ya saneadas (mismas claves que las columnas reales de la
  // tabla en Supabase), sin el _row_id interno — lo usa el motor para
  // espejar la corrida actual allá. No pagina: quien lo llama ya sabe
  // que puede ser un array grande, y solo se usa server-side.
  function getRowsForExport() {
    return rows.map(({ _row_id, ...rest }) => rest);
  }

  // Paginado + búsqueda de substring en cualquier columna — nunca
  // devuelve más de `pageSize` filas, así el navegador jamás tiene
  // que cargar miles de filas en memoria de una sola vez.
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
