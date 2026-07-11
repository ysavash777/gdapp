// Detección de dispositivo por User-Agent.
// GET /  →  móvil/tablet: /app  ·  escritorio: /desk
// Se puede forzar con ?view=desk o ?view=app (útil para pruebas).

const MOBILE_RE = /android|iphone|ipad|ipod|mobile|windows phone|opera mini/i;

function deviceRedirect(req, res, next) {
  if (req.path !== '/') return next();

  const forced = req.query.view;
  if (forced === 'desk' || forced === 'app') {
    return res.redirect(302, `/${forced}`);
  }

  const ua = req.headers['user-agent'] || '';
  const isMobile = MOBILE_RE.test(ua);
  res.redirect(302, isMobile ? '/app' : '/desk');
}

module.exports = { deviceRedirect };
