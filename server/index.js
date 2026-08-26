// Bootstrap del servidor. La lógica vive en middleware/ y routes/.

const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { PORT } = require('./config');
const { deviceRedirect } = require('./middleware/device');
const inventoryEngine = require('./services/inventory-engine');
const refreshScheduler = require('./services/refresh-scheduler');
const vencimientoResetScheduler = require('./services/vencimiento-reset-scheduler');

const app = express();
// Gzip para toda respuesta por encima del umbral por defecto (~1KB) —
// el catálogo de productos (shared/js/product-catalog.js) pesa ~1MB
// en JSON crudo y comprime muy bien.
app.use(compression());
// 4mb (el default es 100kb) para la foto base64 de un ítem "faltante"
// en Vencimientos (ver routes/vencimientos.js).
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// / → /desk | /app según dispositivo
app.use(deviceRedirect);

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/database', require('./routes/database'));
app.use('/api/mapeos', require('./routes/mapeos'));
app.use('/api/consultas', require('./routes/consultas'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/vencimientos', require('./routes/vencimientos'));
app.use('/api/vacios', require('./routes/vacios'));

// Estáticos — sin hash en el nombre de archivo, así que max-age corto
// (1h) para JS/CSS evita servir versiones viejas mucho tiempo tras un
// deploy. Las imágenes cambian rarísima vez, así que llevan más margen.
const PUBLIC = path.join(__dirname, '..', 'public');
const STATIC_MAX_AGE_MS = 60 * 60 * 1000; // 1h
const IMAGE_MAX_AGE_S = 7 * 24 * 60 * 60; // 7 días
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|ico)$/i;
const staticOptions = {
  maxAge: STATIC_MAX_AGE_MS,
  setHeaders(res, filePath) {
    if (IMAGE_EXT.test(filePath)) res.setHeader('Cache-Control', `public, max-age=${IMAGE_MAX_AGE_S}`);
  },
};
app.use('/shared', express.static(path.join(PUBLIC, 'shared'), staticOptions));
app.use('/desk', express.static(path.join(PUBLIC, 'desk'), staticOptions));
app.use('/app', express.static(path.join(PUBLIC, 'app'), staticOptions));

// Fallback SPA: rutas internas de cada shell devuelven su index.html
app.get('/desk/*', (_req, res) => res.sendFile(path.join(PUBLIC, 'desk', 'index.html')));
app.get('/app/*', (_req, res) => res.sendFile(path.join(PUBLIC, 'app', 'index.html')));

// Antes de aceptar tráfico: trae de Supabase la última corrida buena
// de cada fuente, porque el caché en disco no sobrevive un deploy.
inventoryEngine.hydrate()
  .catch((e) => console.error('[index] Hidratación inicial desde Supabase falló:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`GDapp escuchando en http://localhost:${PORT}`);
      refreshScheduler.start();
      vencimientoResetScheduler.start();
    });
  });
