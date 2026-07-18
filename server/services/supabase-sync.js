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

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const BATCH_SIZE = 500; // PostgREST tiene límite de tamaño de payload — se inserta en tandas

let client = null;
let warnedMissingConfig = false;

function getClient() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    if (!warnedMissingConfig) {
      console.warn('[supabase-sync] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no configuradas — se omite el espejo en Supabase.');
      warnedMissingConfig = true;
    }
    return null;
  }
  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

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

module.exports = { replaceTable, logSync, isConfigured };
