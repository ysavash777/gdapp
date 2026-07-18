/* ============================================================
   Espejo en Supabase de cada fuente de Copernico (proyecto
   "bodega-47-inventario"). Corre server-side, con la service_role
   key — nunca se envía al navegador. Las tablas tienen RLS activo
   sin políticas: hoy solo este proceso puede leer/escribir en ellas;
   el día que haga falta lectura pública (para el módulo de la app
   móvil, por ejemplo) se agrega una policy explícita, no se abre RLS
   por completo.

   replaceTable() reemplaza todo el contenido de la tabla (borra +
   inserta) en vez de hacer upsert: la API de Copernico no da ninguna
   clave estable entre corridas que sirva como clave de conflicto, así
   que un reemplazo completo es más simple y evita filas viejas
   huérfanas que ya no existen en Copernico.

   Si SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no están configuradas,
   todo esto queda como no-op silencioso — el motor sigue funcionando
   igual con el store local en disco, Supabase es un espejo adicional,
   no una dependencia dura.
   ============================================================ */

const { getClient, requireClient } = require('./supabase-client');

const BATCH_SIZE = 500; // PostgREST tiene límite de tamaño de payload — se inserta en tandas

function isConfigured() {
  return !!getClient();
}

// Reemplaza todo el contenido de `table` por `rows` — atómico desde
// el punto de vista de quien lee mientras tanto solo en el sentido de
// que el borrado y la inserción son la única forma disponible sin una
// clave de upsert; si el proceso se cae a mitad de camino, la tabla
// puede quedar vacía o a medio llenar hasta la corrida siguiente (que
// la vuelve a reemplazar entera).
async function replaceTable(table, rows) {
  const supabase = getClient();
  if (!supabase) return { skipped: true };

  const { error: delErr } = await supabase.from(table).delete().gte('id', 0);
  if (delErr) throw new Error(`No se pudo vaciar ${table}: ${delErr.message}`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`No se pudo insertar en ${table} (filas ${i}-${i + chunk.length}): ${error.message}`);
  }

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
// incompleta (esa es la señal de que ya no queda nada más).
async function loadTable(table) {
  const supabase = getClient();
  if (!supabase) return { skipped: true, rows: [] };

  const PAGE_SIZE = 1000;
  let rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`No se pudo leer ${table}: ${error.message}`);
    if (!data || !data.length) break;
    rows = rows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += data.length;
  }
  return { skipped: false, rows };
}

module.exports = { replaceTable, logSync, loadTable, isConfigured };
