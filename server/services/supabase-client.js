/* ============================================================
   Cliente Supabase compartido (proyecto "bodega-47-inventario").
   Usa la service_role key (nunca se envía al navegador) — todas las
   tablas tienen RLS activo sin políticas, solo este cliente entra.
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

// Para stores que dependen de Supabase (sin caché local de respaldo):
// sin config, es un error real, no un no-op.
function requireClient() {
  const supabase = getClient();
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

module.exports = { getClient, requireClient };
