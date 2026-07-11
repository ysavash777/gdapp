/* ============================================================
   Autorización — traduce la cookie de sesión en req.user.
   requireAuth: exige sesión válida.
   requireAdmin: exige sesión válida con role 'admin'.
   ============================================================ */

const sessions = require('../store/sessions.store');
const usersStore = require('../store/users.store');

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.sid;
  const userId = token && sessions.getUserId(token);
  const user = userId && usersStore.findById(userId);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  req.user = usersStore.toPublic(user);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
