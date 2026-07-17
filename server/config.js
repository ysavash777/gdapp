// Carga server/.env a mano (sin dependencia nueva: Node no lee .env
// solo salvo con --env-file, y no queremos atar el arranque a un flag
// de CLI). Nunca sobreescribe una variable ya presente en el entorno
// real (Docker/CI/producción siempre gana sobre el archivo).
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Credenciales del usuario "consultor" contra la API de Copernico
  // WMS — solo viven en el servidor (server/.env, gitignored): el
  // motor de actualización de la base de datos las usa para
  // login/consultar/logout, nunca se envían al navegador.
  COPERNICO_EMAIL: process.env.COPERNICO_EMAIL || '',
  COPERNICO_PASSWORD: process.env.COPERNICO_PASSWORD || '',
  COPERNICO_BODEGA: process.env.COPERNICO_BODEGA || '47',
};
