/* ============================================================
   Repositorio de usuarios (en memoria).
   Misma forma de API que tendrá la capa de base de datos real:
   list/findById/findByUsername/create/update/updatePassword/remove.
   Cuando se conecte la BD, solo se reemplaza el cuerpo de estas
   funciones — routes/ y el frontend no cambian.
   ============================================================ */

const crypto = require('crypto');

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

// Índices: byId para O(1) lookup por id, idByUsername para O(1) por username.
const byId = new Map();
const idByUsername = new Map();
let nextId = 1;

function seed(username, password, role, avatar, permissions) {
  const id = nextId++;
  const user = { id, username, passwordHash: hashPassword(password), role, avatar, permissions };
  byId.set(id, user);
  idByUsername.set(username.toLowerCase(), id);
  return user;
}

seed('admin', 'admin1234', 'admin', 1, ['usuarios', 'mapeos', 'basesdatos']);
seed('operador', 'operador1234', 'user', 3, ['mapeos']);
seed('consulta', 'consulta1234', 'user', 5, ['basesdatos']);

function toPublic(user) {
  const { passwordHash, ...pub } = user;
  return pub;
}

function list({ q = '', page = 1, pageSize = 20 } = {}) {
  const term = q.trim().toLowerCase();
  let items = Array.from(byId.values());
  if (term) items = items.filter((u) => u.username.toLowerCase().includes(term));
  const total = items.length;
  const start = (page - 1) * pageSize;
  const items_ = items.slice(start, start + pageSize).map(toPublic);
  return { items: items_, total, page, pageSize };
}

function findById(id) {
  return byId.get(id) || null;
}

function findByUsername(username) {
  const id = idByUsername.get(String(username).toLowerCase());
  return id ? byId.get(id) : null;
}

function create({ username, password, role = 'user', avatar = 1, permissions = [] }) {
  if (!username || !password) throw new Error('MISSING_FIELDS');
  if (findByUsername(username)) throw new Error('USERNAME_TAKEN');
  const id = nextId++;
  const user = { id, username, passwordHash: hashPassword(password), role, avatar, permissions };
  byId.set(id, user);
  idByUsername.set(username.toLowerCase(), id);
  return toPublic(user);
}

function update(id, patch) {
  const user = byId.get(id);
  if (!user) return null;

  if (patch.username && patch.username.toLowerCase() !== user.username.toLowerCase()) {
    if (findByUsername(patch.username)) throw new Error('USERNAME_TAKEN');
    idByUsername.delete(user.username.toLowerCase());
    user.username = patch.username;
    idByUsername.set(user.username.toLowerCase(), id);
  }
  if (patch.role) user.role = patch.role;
  if (patch.avatar) user.avatar = patch.avatar;
  if (Array.isArray(patch.permissions)) user.permissions = patch.permissions;

  return toPublic(user);
}

function updatePassword(id, password) {
  const user = byId.get(id);
  if (!user) return false;
  user.passwordHash = hashPassword(password);
  return true;
}

function remove(id) {
  const user = byId.get(id);
  if (!user) return false;
  byId.delete(id);
  idByUsername.delete(user.username.toLowerCase());
  return true;
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
