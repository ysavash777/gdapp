/* ============================================================
   Espejo en Supabase de cada fuente de Copernico. Server-side, con
   service_role key; RLS activo sin políticas.

   replaceTable() reemplaza todo el contenido de la tabla (Copernico
   no da clave estable entre corridas): inserta TODO lo nuevo primero,
   marcado con una "generación" (synced_at compartido por la corrida),
   y recién al final borra lo anterior a esa generación. Así, si la
   corrida se corta a mitad de camino, la tabla nunca queda con menos
   filas que antes (a lo sumo con un resto nuevo sin terminar, que la
   corrida siguiente limpia sola). Cada escritura reintenta con
   backoff — la mayoría de los cortes son transitorios.

   Sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, todo queda como no-op
   silencioso: Supabase es un espejo adicional, no una dependencia dura.
   ============================================================ */

const { getClient, requireClient } = require('./supabase-client');

const BATCH_SIZE = 500; // PostgREST tiene límite de tamaño de payload — se inserta en tandas
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 800;

function isConfigured() {
  return !!getClient();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Backoff lineal (800ms, 1600ms, 2400ms) antes de tirar el error real.
async function withRetries(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
    }
  }
  throw new Error(`${label} (tras ${MAX_ATTEMPTS} intentos): ${lastErr.message}`);
}

// `conflictKey` (columnas separadas por coma, ej. "bodega,caja,ean") es
// solo para tablas con unique constraint natural aparte del id: insertar
// la generación nueva ANTES de borrar la vieja choca con esa constraint
// en cuanto una fila nueva repite esa clave (el caso normal, corrida a
// corrida). Bug real ya corregido: inventario_cajas tiene UNIQUE(bodega,
// caja, ean) y sin esto cada corrida fallaba silenciosamente (best-effort,
// no se ve en la tarjeta del desk), dejando Supabase clavado en la
// última corrida buena hasta el próximo restart. Con conflictKey se usa
// upsert en vez de insert — nunca colisiona.
async function replaceTable(table, rows, { conflictKey } = {}) {
  const supabase = getClient();
  if (!supabase) return { skipped: true };

  const generation = new Date().toISOString();
  const stamped = rows.map((r) => ({ ...r, synced_at: generation }));

  for (let i = 0; i < stamped.length; i += BATCH_SIZE) {
    const chunk = stamped.slice(i, i + BATCH_SIZE);
    await withRetries(async () => {
      const { error } = conflictKey
        ? await supabase.from(table).upsert(chunk, { onConflict: conflictKey })
        : await supabase.from(table).insert(chunk);
      if (error) throw new Error(error.message);
    }, `No se pudo ${conflictKey ? 'upsertear' : 'insertar'} en ${table} (filas ${i}-${i + chunk.length})`);
  }

  // Recién acá se borra lo viejo, con lo nuevo ya confirmado adentro.
  await withRetries(async () => {
    const { error } = await supabase.from(table).delete().lt('synced_at', generation);
    if (error) throw new Error(error.message);
  }, `No se pudo limpiar ${table} tras el reemplazo`);

  return { skipped: false, rowCount: rows.length };
}

// Clave compuesta (ej. bodega+caja+ean) como string estable, para poder
// usarla como key de Map — el separador es un carácter de control que
// nunca aparece en datos reales de Copernico.
function rowKey(row, keyCols) {
  return keyCols.map((c) => String(row[c] ?? '')).join('');
}

// Representación canónica de una fila (claves ordenadas) para comparar
// contenido exacto entre corridas — nunca aproximado: cualquier campo
// distinto, aunque sea uno solo, cuenta como "cambió".
function canonicalRow(row) {
  const sorted = {};
  for (const key of Object.keys(row).sort()) sorted[key] = row[key] ?? null;
  return JSON.stringify(sorted);
}

// Espejo incremental: en vez de resubir la tabla entera en cada corrida
// (lo que hacía replaceTable, cara en egress con fuentes de miles de
// filas que cambian poco de una hora a la otra), compara `newRows`
// contra `previousRows` (la foto en memoria de ANTES de esta corrida,
// ver inventory-engine.js) y solo upsertea lo que de verdad cambió de
// contenido, y borra lo que ya no está.
//
// Sin `conflictKey` no hay forma segura de identificar la MISMA fila
// entre corridas (Copernico no da id estable) — en ese caso cae a
// replaceTable() de siempre, nunca intenta diffear a ciegas.
//
// El borrado es fila por fila por clave exacta (nunca un filtro
// armado a mano con las claves) — más lento si se dan de baja muchas
// filas de golpe, pero sin riesgo de borrar de más por un error de
// construcción de query.
async function replaceTableDiff(table, previousRows, newRows, { conflictKey } = {}) {
  const supabase = getClient();
  if (!supabase) return { skipped: true };
  if (!conflictKey) return replaceTable(table, newRows, { conflictKey });

  const keyCols = conflictKey.split(',');
  const prevByKey = new Map(previousRows.map((r) => [rowKey(r, keyCols), r]));
  const newByKey = new Map(newRows.map((r) => [rowKey(r, keyCols), r]));

  const toUpsert = [];
  for (const [key, row] of newByKey) {
    const prev = prevByKey.get(key);
    if (!prev || canonicalRow(prev) !== canonicalRow(row)) toUpsert.push(row);
  }
  const toDelete = [...prevByKey.entries()].filter(([k]) => !newByKey.has(k)).map(([, row]) => row);

  const generation = new Date().toISOString();
  const stamped = toUpsert.map((r) => ({ ...r, synced_at: generation }));
  for (let i = 0; i < stamped.length; i += BATCH_SIZE) {
    const chunk = stamped.slice(i, i + BATCH_SIZE);
    await withRetries(async () => {
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictKey });
      if (error) throw new Error(error.message);
    }, `No se pudo upsertear en ${table} (filas ${i}-${i + chunk.length})`);
  }

  const DELETE_CONCURRENCY = 10;
  let cursor = 0;
  async function deleteWorker() {
    while (cursor < toDelete.length) {
      const row = toDelete[cursor++];
      await withRetries(async () => {
        let q = supabase.from(table).delete();
        keyCols.forEach((col) => { q = q.eq(col, row[col]); });
        const { error } = await q;
        if (error) throw new Error(error.message);
      }, `No se pudo borrar de ${table} la fila ${rowKey(row, keyCols)}`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DELETE_CONCURRENCY, toDelete.length) }, deleteWorker)
  );

  return { skipped: false, rowCount: newRows.length, upserted: toUpsert.length, deleted: toDelete.length };
}

// Historial de corridas. Nunca lanza: el log no debe tirar abajo el motor.
async function logSync(source, { status, rowCount, durationMs, errorCode, errorMessage }) {
  const supabase = getClient();
  if (!supabase) return;
  try {
    await supabase.from('sync_log').insert({
      source,
      status,
      row_count: rowCount ?? null,
      duration_ms: durationMs ?? null,
      error_code: errorCode ?? null,
      error_message: errorMessage ?? null,
    });
  } catch (e) {
    console.error('[supabase-sync] No se pudo registrar en sync_log:', e.message);
  }
}

// Lee toda la tabla — lo usa cada store al arrancar para recuperar la
// última corrida buena si el caché local en disco se perdió.
// PostgREST nunca devuelve más de PAGE_SIZE filas por select, así que
// se pagina con .range() hasta que una página vuelve incompleta, con
// .order('id') explícito (sin orden fijo, Postgres no garantiza que
// páginas consecutivas no se salten o repitan filas).
async function loadTable(table) {
  const supabase = getClient();
  if (!supabase) return { skipped: true, rows: [] };

  const PAGE_SIZE = 1000;
  let rows = [];
  let from = 0;
  for (;;) {
    const data = await withRetries(async () => {
      const { data, error } = await supabase.from(table).select('*').order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      return data;
    }, `No se pudo leer ${table} (desde la fila ${from})`);
    if (!data || !data.length) break;
    rows = rows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += data.length;
  }
  return { skipped: false, rows };
}

module.exports = { replaceTable, replaceTableDiff, logSync, loadTable, isConfigured };
