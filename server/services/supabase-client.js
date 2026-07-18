/* ============================================================
   Cliente Supabase compartido (proyecto "bodega-47-inventario").
   Un solo lugar donde se crea — server/services/supabase-sync.js y
   los stores que ya migraron (users, sessions, mapeos) lo usan en vez
   de crear cada uno su propia instancia. Usa la service_role key:
   nunca se envía al navegador, y es lo único que puede leer/escribir
   estas tablas porque todas tienen RLS activo sin políticas.
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client = null;
let warnedMissingConfig = false;

function getClient() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    if (!warnedMissingConfig) {
      console.warn('[supabase-client] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no configuradas.');
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

// Para los stores que sí dependen de Supabase (users/sessions/mapeos,
// a diferencia de inventory/coordenadas que tienen un caché local en
// disco de respaldo): sin config, es un error real, no un no-op.
function requireClient() {
  const supabase = getClient();
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

module.exports = { getClient, requireClient };
