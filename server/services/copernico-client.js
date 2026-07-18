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
const COORDENADAS_URL = 'https://services.copernicowms.com/backweb25/layout/coordenadas';

// Sin esto, un fetch que Copernico deja "colgado" sin responder nunca
// falla ni se resuelve — el motor quedaría marcado como "corriendo"
// para siempre, bloqueando cualquier intento futuro (ALREADY_RUNNING)
// hasta reiniciar el proceso a mano. Con el límite, como mucho se
// espera esto y se libera la corrida para poder reintentar.
const LOGIN_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 90_000; // la consulta de referencia mueve ~10 MB y a veces tarda más de lo esperado del lado de Copernico
const LOGOUT_TIMEOUT_MS = 15_000;

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

// undici (el fetch de Node) a veces envuelve el AbortError/TimeoutError
// real dentro de `cause` en vez de lanzarlo directo — hay que mirar
// ambos lugares para no dejarlo pasar como un error genérico sin
// clasificar (ver el bug real que esto arregló: el .catch de abajo
// solo envolvía el fetch(), no la lectura del cuerpo de la respuesta,
// así que un timeout a mitad de la descarga de ~10 MB se escapaba
// crudo, sin pasar por CopernicoError).
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
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
    // Misma señal de abort cubre leer el cuerpo — por eso el .json()
    // también vive dentro de este try, no solo el fetch(). Sin un
    // .catch acá: si el cuerpo no es JSON válido o se corta a mitad
    // de camino, es un error real que hay que clasificar, no algo
    // para disimular con un objeto vacío.
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

// Lógica compartida por cualquier endpoint de "traer un dataset
// completo" (referencia, coordenadas, y las que vengan) — mismo
// timeout que cubre la descarga entera (no solo la conexión inicial,
// ver el comentario de login() sobre por qué el .json() vive dentro
// del try) y misma heurística para encontrar el array real dentro de
// la respuesta, sea que la API lo devuelva pelado o envuelto en
// {data:[...]} / {result:[...]} / etc.
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

// Se llama siempre al terminar una corrida (haya salido bien o mal la
// consulta) para no dejar la licencia ocupada — por eso nunca lanza:
// un logout que falla no debe tirar abajo el resultado de la corrida.
async function logout(token, uid) {
  if (uid == null) return false; // != !uid: un uid de 0 sería válido y no debe tratarse como "sin uid"
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

module.exports = { login, fetchReferencia, fetchCoordenadas, logout, CopernicoError };
