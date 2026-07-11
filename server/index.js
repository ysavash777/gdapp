// Bootstrap del servidor. La lógica vive en middleware/ y routes/.

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { PORT } = require('./config');
const { deviceRedirect } = require('./middleware/device');

const app = express();
app.use(express.json());
app.use(cookieParser());

// / → /desk | /app según dispositivo
app.use(deviceRedirect);

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// Estáticos
const PUBLIC = path.join(__dirname, '..', 'public');
app.use('/shared', express.static(path.join(PUBLIC, 'shared')));
app.use('/desk', express.static(path.join(PUBLIC, 'desk')));
app.use('/app', express.static(path.join(PUBLIC, 'app')));

// Fallback SPA: rutas internas de cada shell devuelven su index.html
app.get('/desk/*', (_req, res) => res.sendFile(path.join(PUBLIC, 'desk', 'index.html')));
app.get('/app/*', (_req, res) => res.sendFile(path.join(PUBLIC, 'app', 'index.html')));

app.listen(PORT, () => {
  console.log(`GDapp escuchando en http://localhost:${PORT}`);
});
