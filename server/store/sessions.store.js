// Repositorio de sesiones — Supabase (tabla `sessions`, proyecto
// "bodega-47-inventario"). create/getUserId/destroy son async.

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
