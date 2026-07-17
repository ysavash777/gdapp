/* ============================================================
   Cliente HTTP de bajo nivel contra la API de Copernico WMS.
   Solo sabe hablar con la API (login/consultar referencia/logout) —
   no sabe nada de reintentos, locks ni de cómo se guardan los datos;
   eso vive en services/inventory-engine.js.

   Corre en el servidor (Node), nunca en el navegador: así las
   credenciales del usuario consultor no salen de acá, y no hay
   problema de CORS al llamar a services.copernicowms.com.
   ============================================================ */

const LOGIN_URL = 'https://services.copernicowms.com/users/api/login';
const LOGOUT_URL = 'https://services.copernicowms.com/users/api/logout';
const REFERENCIA_URL = 'https://services.copernicowms.com/backweb25/inventario/obtenerrefsxcaja';

// Error "tipado": code es uno de LICENSE_LIMIT / ALREADY_LOGGED_IN /
// INVALID_CREDENTIALS / LOGIN_FAILED / FETCH_FAILED / NETWORK — así
// el motor y la API interna pueden reaccionar distinto a cada caso
// sin parsear texto en más de un lugar.
class CopernicoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function extractToken(obj) {
  const CANDIDATES = ['token', 'access_token', 'accessToken', 'jwt', 'access'];
  for (const k of CANDIDATES) {
    if (typeof obj?.[k] === 'string' && obj[k].startsWith('ey')) return obj[k];
  }
  for (const k in obj) {
    if (obj[k] && typeof obj[k] === 'object') {
      for (const k2 of CANDIDATES) {
        if (typeof obj[k][k2] === 'string' && obj[k][k2].startsWith('ey')) return obj[k][k2];
      }
    }
  }
  return null;
}

function decodeUid(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.id ?? payload.uid ?? payload.userId ?? null;
  } catch {
    return null;
  }
}

// La API no documenta códigos de error propios — clasificamos por el
// texto del mensaje (siempre en español) para poder distinguir "no
// hay licencias" de "ya hay una sesión activa" y reaccionar distinto
// a cada caso en el motor.
function classifyLoginError(message) {
  const m = (message || '').toLowerCase();
  if (/licenc/.test(m)) return 'LICENSE_LIMIT';
  if (/(sesi[oó]n).*(activ|conectad|abiert)|ya.*conectad|otro dispositivo/.test(m)) return 'ALREADY_LOGGED_IN';
  if (/credencial|contrase|usuario o|incorrect/.test(m)) return 'INVALID_CREDENTIALS';
  return 'LOGIN_FAILED';
}

async function login(email, password) {
  let resp, data;
  try {
    resp = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password, plataforma: 'Copernico WMS' }),
    });
  } catch (e) {
    throw new CopernicoError('NETWORK', e.message);
  }
  data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const message = data.message || data.detail || `HTTP ${resp.status}`;
    throw new CopernicoError(classifyLoginError(message), message);
  }

  const token = extractToken(data);
  if (!token) throw new CopernicoError('LOGIN_FAILED', 'No se encontró el token en la respuesta de login.');

  return { token, uid: decodeUid(token) };
}

async function fetchReferencia(token, bodega) {
  let resp;
  try {
    resp = await fetch(`${REFERENCIA_URL}?bodega=${encodeURIComponent(bodega)}`, {
      method: 'GET',
      headers: { Accept: 'application/json, */*', Authorization: token },
    });
  } catch (e) {
    throw new CopernicoError('NETWORK', e.message);
  }
  if (!resp.ok) {
    throw new CopernicoError('FETCH_FAILED', `Error ${resp.status} al consultar referencia.`);
  }
  const data = await resp.json();
  if (Array.isArray(data)) return data;
  for (const key of ['data', 'result', 'results', 'rows', 'items', 'registros']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  for (const k in data) if (Array.isArray(data[k])) return data[k];
  return [];
}

// Se llama siempre al terminar una corrida (haya salido bien o mal la
// consulta) para no dejar la licencia ocupada — por eso nunca lanza:
// un logout que falla no debe tirar abajo el resultado de la corrida.
async function logout(token, uid) {
  if (!uid) return false;
  try {
    const resp = await fetch(LOGOUT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Authorization: token || '',
        Origin: 'https://www.copernicowms.com',
        Referer: 'https://www.copernicowms.com/',
      },
      body: JSON.stringify({ id: Number(uid) }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = { login, fetchReferencia, logout, CopernicoError };
