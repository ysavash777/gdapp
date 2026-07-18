/* ============================================================
   Espejo en Supabase de cada fuente de Copernico (proyecto
   "bodega-47-inventario"). Corre server-side, con la service_role
   key — nunca se envía al navegador. Las tablas tienen RLS activo
   sin políticas: hoy solo este proceso puede leer/escribir en ellas;
   el día que haga falta lectura pública (para el módulo de la app
   móvil, por ejemplo) se agrega una policy explícita, no se abre RLS
   por completo.

   replaceTable() reemplaza todo el contenido de la tabla — la API de
   Copernico no da ninguna clave estable entre corridas que sirva como
   clave de conflicto, así que un reemplazo completo es más simple y
   evita filas viejas huérfanas que ya no existen en Copernico. A
   diferencia de un borrar-y-luego-insertar clásico (lo que había
   antes, y dejaba la tabla a medio llenar para siempre si una tanda
   fallaba a mitad de camino — el bug real detrás de "6500 filas de
   Referencia" cuando debían ser 11000+), este primero inserta TODO lo
   nuevo (marcado con una misma "generación", el timestamp `synced_at`
   compartido por toda la corrida) y solo borra lo viejo al final, ya
   con lo nuevo confirmado adentro. Si la corrida se corta a mitad de
   camino, la tabla NUNCA queda con menos filas que antes — en el peor
   caso queda con lo viejo completo más un resto nuevo sin terminar
   (de más, nunca de menos), que la corrida siguiente limpia sola al
   volver a borrar todo lo anterior a su propia generación. Cada
   escritura además reintenta unas pocas veces con backoff antes de
   darse por vencida — la mayoría de estos cortes son transitorios
   (una tanda de 500 filas que no llega a responder a tiempo), no
   errores reales de datos.

   Si SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no están configuradas,
   todo esto queda como no-op silencioso — el motor sigue funcionando
   igual con el store local en disco, Supabase es un espejo adicional,
   no una dependencia dura.
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

// Reintenta una operación con backoff lineal (800ms, 1600ms, 2400ms)
// antes de tirar el error real — mover 10+ MB en varias tandas contra
// una red inestable es sensible a cortes puntuales que no tienen nada
// que ver con los datos en sí.
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

async function replaceTable(table, rows) {
  const supabase = getClient();
  if (!supabase) return { skipped: true };

  const generation = new Date().toISOString();
  const stamped = rows.map((r) => ({ ...r, synced_at: generation }));

  for (let i = 0; i < stamped.length; i += BATCH_SIZE) {
    const chunk = stamped.slice(i, i + BATCH_SIZE);
    await withRetries(async () => {
      const { error } = await supabase.from(table).insert(chunk);
      if (error) throw new Error(error.message);
    }, `No se pudo insertar en ${table} (filas ${i}-${i + chunk.length})`);
  }

  // Recién acá se borra lo viejo — todo lo nuevo de esta corrida ya
  // está confirmado adentro, así que esto nunca deja la tabla con
  // menos filas de las que tenía antes de empezar.
  await withRetries(async () => {
    const { error } = await supabase.from(table).delete().lt('synced_at', generation);
    if (error) throw new Error(error.message);
  }, `No se pudo limpiar ${table} tras el reemplazo`);

  return { skipped: false, rowCount: rows.length };
}

// Historial de corridas — una fila por fuente por corrida, éxito o
// error. Nunca lanza: registrar el log no debe tirar abajo el motor.
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

// Lee toda la tabla tal cual está en Supabase — lo usa cada store al
// arrancar el proceso para recuperar la última corrida buena aunque
// el caché en disco local se haya perdido (deploys nuevos en Render
// no conservan `server/data/*.json` de una instancia a la siguiente).
//
// PostgREST (la API que usa Supabase) nunca devuelve más de PAGE_SIZE
// filas en un solo select, sin importar cuántas haya en la tabla — sin
// paginar acá, una tabla real de miles de filas (ej. Referencia) se
// leía siempre truncada a las primeras PAGE_SIZE, como si esa fuera
// toda la base. Se pagina con .range() hasta que una página vuelve
// incompleta (esa es la señal de que ya no queda nada más) — con
// .order('id') explícito, porque sin un orden fijo Postgres no
// garantiza que dos páginas consecutivas no se salten o repitan filas,
// y cada página se reintenta con backoff por el mismo motivo que
// replaceTable(): un corte de red a mitad de la lectura no debe
// hacer parecer que la base "solo tiene" las filas ya leídas hasta
// ahí.
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

module.exports = { replaceTable, logSync, loadTable, isConfigured };
