/* ============================================================
   Repositorio de sesiones (en memoria).
   Token opaco -> userId. Cuando exista base de datos/Redis, solo
   se reemplaza el cuerpo de estas funciones.
   ============================================================ */

const crypto = require('crypto');

const tokenToUserId = new Map();

function create(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  tokenToUserId.set(token, userId);
  return token;
}

function getUserId(token) {
  return tokenToUserId.get(token) || null;
}

function destroy(token) {
  tokenToUserId.delete(token);
}

module.exports = { create, getUserId, destroy };
