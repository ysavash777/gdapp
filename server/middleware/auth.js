// Autorización — traduce la cookie de sesión en req.user.
// requireAuth: sesión válida. requireAdmin: sesión + role 'admin'.
// requirePermission(...keys): sesión + al menos uno de esos permisos
// (varias claves porque una ruta puede servir tanto al scope 'app'
// como a su equivalente 'web', ej. mapear/mapeos — ver permissions.js).
// sessions/users store viven en Supabase: un error de red/DB acá se
// traduce a 401, no a un 500.

const sessions = require('../store/sessions.store');
const usersStore = require('../store/users.store');

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies.sid;
    const userId = token ? await sessions.getUserId(token) : null;
    const user = userId ? await usersStore.findById(userId) : null;
    if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    req.user = usersStore.toPublic(user);
    next();
  } catch (e) {
    console.error('[middleware/auth] requireAuth falló:', e.message);
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    next();
  });
}

function requirePermission(...keys) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      const perms = req.user.permissions || [];
      if (!keys.some((key) => perms.includes(key))) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireAdmin, requirePermission };
