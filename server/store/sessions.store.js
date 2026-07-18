/* ============================================================
   Repositorio de sesiones — Supabase (tabla `sessions`, proyecto
   "bodega-47-inventario"). Antes vivía en memoria (Map) y se perdía
   en cada restart del servidor (forzando relogueo apenas Render
   reiniciaba el proceso, aunque no hubiera pasado nada); misma forma
   de API que antes (create/getUserId/destroy), solo que ahora son
   async — routes/auth.js y middleware/auth.js ya las llaman con await.
   ============================================================ */

const crypto = require('crypto');
const { requireClient } = require('../services/supabase-client');

async function create(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const supabase = requireClient();
  const { error } = await supabase.from('sessions').insert({ token, user_id: userId });
  if (error) throw error;
  return token;
}

async function getUserId(token) {
  const supabase = requireClient();
  const { data, error } = await supabase.from('sessions').select('user_id').eq('token', token).maybeSingle();
  if (error) throw error;
  return data ? data.user_id : null;
}

async function destroy(token) {
  const supabase = requireClient();
  await supabase.from('sessions').delete().eq('token', token);
}

module.exports = { create, getUserId, destroy };
