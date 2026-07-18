/* ============================================================
   Repositorio de usuarios — Supabase (tabla `users`, proyecto
   "bodega-47-inventario"). Antes vivía en memoria (Map) y se perdía
   en cada restart del servidor; misma forma de API que antes
   (list/findById/findByUsername/create/update/updatePassword/remove),
   solo que ahora todas son async — routes/ ya las llama con await.
   ============================================================ */

const crypto = require('crypto');
const { requireClient } = require('../services/supabase-client');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    avatar: row.avatar,
    permissions: row.permissions || [],
  };
}

function toPublic(user) {
  if (!user) return null;
  const { passwordHash, ...pub } = user;
  return pub;
}

async function list({ q = '', page = 1, pageSize = 20 } = {}) {
  const supabase = requireClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('users').select('*', { count: 'exact' });
  if (q.trim()) query = query.ilike('username', `%${q.trim()}%`);
  const { data, count, error } = await query.order('id').range(from, to);
  if (error) throw error;

  return { items: data.map((r) => toPublic(rowToUser(r))), total: count ?? 0, page, pageSize };
}

async function findById(id) {
  const supabase = requireClient();
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return rowToUser(data);
}

async function findByUsername(username) {
  const supabase = requireClient();
  const { data, error } = await supabase.from('users').select('*').ilike('username', username).maybeSingle();
  if (error) throw error;
  return rowToUser(data);
}

async function create({ username, password, role = 'user', avatar = 1, permissions = [] }) {
  if (!username || !password) throw new Error('MISSING_FIELDS');
  if (await findByUsername(username)) throw new Error('USERNAME_TAKEN');

  const supabase = requireClient();
  const { data, error } = await supabase
    .from('users')
    .insert({ username, password_hash: hashPassword(password), role, avatar, permissions })
    .select()
    .single();
  if (error) throw error;
  return toPublic(rowToUser(data));
}

async function update(id, patch) {
  const user = await findById(id);
  if (!user) return null;

  const updates = {};
  if (patch.username && patch.username.toLowerCase() !== user.username.toLowerCase()) {
    if (await findByUsername(patch.username)) throw new Error('USERNAME_TAKEN');
    updates.username = patch.username;
  }
  if (patch.role) updates.role = patch.role;
  if (patch.avatar) updates.avatar = patch.avatar;
  if (Array.isArray(patch.permissions)) updates.permissions = patch.permissions;

  if (Object.keys(updates).length === 0) return toPublic(user);

  const supabase = requireClient();
  const { data, error } = await supabase.from('users').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return toPublic(rowToUser(data));
}

async function updatePassword(id, password) {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('users')
    .update({ password_hash: hashPassword(password) })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return data.length > 0;
}

async function remove(id) {
  const supabase = requireClient();
  const { data, error } = await supabase.from('users').delete().eq('id', id).select('id');
  if (error) throw error;
  return data.length > 0;
}

module.exports = {
  list,
  findById,
  findByUsername,
  create,
  update,
  updatePassword,
  remove,
  toPublic,
  verifyPassword,
};
