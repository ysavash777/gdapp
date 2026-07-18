/* ============================================================
   Autorización — traduce la cookie de sesión en req.user.
   requireAuth: exige sesión válida.
   requireAdmin: exige sesión válida con role 'admin'.
   requirePermission(key): exige sesión válida con ese permiso en su
   lista — usado por rutas de herramientas específicas (ej. 'basesdatos').

   sessions.store.js y users.store.js viven en Supabase, así que estas
   consultas son async — un error de red/DB acá se traduce a 401 en
   vez de tirar abajo el proceso (mejor pedir que se vuelva a loguear
   que devolver un 500 críptico).
   ============================================================ */

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

function requirePermission(key) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!(req.user.permissions || []).includes(key)) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireAdmin, requirePermission };
