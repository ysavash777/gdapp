/* ============================================================
   Cliente HTTP de bajo nivel contra la API de Copernico WMS.
   Solo sabe hablar con la API (login/consultar/logout) — reintentos y
   locks viven en services/inventory-engine.js.
   ============================================================ */

const LOGIN_URL = 'https://services.copernicowms.com/users/api/login';
const LOGOUT_URL = 'https://services.copernicowms.com/users/api/logout';
const REFERENCIA_URL = 'https://services.copernicowms.com/backweb25/inventario/obtenerrefsxcaja';
const COORDENADAS_URL = 'https://services.copernicowms.com/backweb25/layout/coordenadas';
const VARIABLES_URL = 'https://services.copernicowms.com/backweb25/logisticsvars';

// Sin timeout, un fetch que Copernico deja colgado nunca falla ni se
// resuelve — el motor quedaría "corriendo" para siempre (ALREADY_RUNNING).
const LOGIN_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 90_000; // referencia mueve ~10 MB, a veces tarda
const LOGOUT_TIMEOUT_MS = 15_000;

// code: LICENSE_LIMIT / ALREADY_LOGGED_IN / INVALID_CREDENTIALS /
// LOGIN_FAILED / FETCH_FAILED / NETWORK — permite reaccionar distinto
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

// undici a veces envuelve el TimeoutError real dentro de `cause` en vez
// de lanzarlo directo — hay que mirar ambos lugares para no dejarlo
// pasar como error genérico sin clasificar.
function isTimeoutError(e) {
  return e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError' || e?.code === 23;
}

function decodeUid(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.id ?? payload.uid ?? payload.userId ?? null;
  } catch {
    return null;
  }
}

// La API no documenta códigos de error propios — se clasifica por el
// texto del mensaje (siempre en español).
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
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
    // .json() vive dentro del mismo try: la señal de abort también
    // debe cubrir la lectura del cuerpo, no solo el fetch().
    data = await resp.json();
  } catch (e) {
    throw new CopernicoError(isTimeoutError(e) ? 'TIMEOUT' : 'NETWORK', e.message);
  }

  if (!resp.ok) {
    const message = data.message || data.detail || `HTTP ${resp.status}`;
    throw new CopernicoError(classifyLoginError(message), message);
  }

  const token = extractToken(data);
  if (!token) throw new CopernicoError('LOGIN_FAILED', 'No se encontró el token en la respuesta de login.');

  return { token, uid: decodeUid(token) };
}

// Compartido por los endpoints de "dataset completo" — mismo timeout
// cubriendo la descarga entera y heurística para hallar el array real
// dentro de la respuesta, la envuelva o no en {data:[...]} etc.
async function fetchDataset(label, url, token, bodega) {
  let resp, data;
  try {
    resp = await fetch(`${url}?bodega=${encodeURIComponent(bodega)}`, {
      method: 'GET',
      headers: { Accept: 'application/json, */*', Authorization: token },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new CopernicoError('FETCH_FAILED', `Error ${resp.status} al consultar ${label}.`);
    data = await resp.json();
  } catch (e) {
    if (e instanceof CopernicoError) throw e;
    throw new CopernicoError(isTimeoutError(e) ? 'TIMEOUT' : 'NETWORK', e.message);
  }
  if (Array.isArray(data)) return data;
  for (const key of ['data', 'result', 'results', 'rows', 'items', 'registros']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  for (const k in data) if (Array.isArray(data[k])) return data[k];
  return [];
}

function fetchReferencia(token, bodega) {
  return fetchDataset('referencia', REFERENCIA_URL, token, bodega);
}

function fetchCoordenadas(token, bodega) {
  return fetchDataset('coordenadas', COORDENADAS_URL, token, bodega);
}

function fetchVariables(token, bodega) {
  return fetchDataset('variables', VARIABLES_URL, token, bodega);
}

// Nunca lanza: un logout fallido no debe tirar abajo el resultado de la corrida.
async function logout(token, uid) {
  if (uid == null) return false; // no !uid: un uid de 0 sería válido
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
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = { login, fetchReferencia, fetchCoordenadas, fetchVariables, logout, CopernicoError };
