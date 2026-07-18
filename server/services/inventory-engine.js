/* ============================================================
   Motor de actualización de la base de datos (Copernico WMS).

   Un solo botón dispara TODAS las fuentes configuradas (ver SOURCES
   más abajo): un login, una consulta por fuente en secuencia, un
   solo logout — nunca un login por fuente. Si una fuente falla, las
   demás igual se intentan (ya se pagó el costo de la licencia con el
   login); el resultado final trae el detalle de cada una por separado
   para que cada tarjeta del desk muestre su propio estado.

   Reglas duras de este archivo:
   1. NUNCA se auto-invoca. No hay setInterval, setTimeout recurrente
      ni cron acá — el único disparador es refresh(), llamado por la
      ruta POST /api/database/refresh, que a su vez solo se llama
      cuando alguien toca el botón "Actualizar DB" en el desk. Si en
      algún momento se quiere un refresh periódico, eso es una
      decisión de producto explícita — no algo que este motor decida
      por su cuenta.
   2. Nunca corren dos refresh en simultáneo (lock en memoria +
      persistido en disco): si refresh() se llama mientras ya hay uno
      en curso, se devuelve ALREADY_RUNNING de inmediato, sin encolar
      ni reintentar — evita gastar una licencia de más o pisar datos
      a medio escribir. El lock persistido detecta además el caso de
      que el proceso se haya reiniciado con un refresh a medio hacer
      (el motor habría quedado "trabado" del lado de Copernico con la
      licencia tomada) — en ese caso, el primer paso es forzar un
      logout con el último uid conocido antes de reintentar el login.
   3. El "logout forzado" no necesita un token vigente: la API de
      Copernico solo pide el id numérico de usuario (ver el botón
      "Cerrar sesión en Copernico" del prototipo original). Ese id es
      el mismo siempre para esta cuenta, así que se guarda una vez y
      para siempre en known-uid.json apenas se ve — permite recuperar
      una sesión colgada incluso si quedó así antes de que este motor
      existiera, sin depender de que el lock de una corrida puntual
      todavía tenga el dato.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const copernico = require('./copernico-client');
const inventoryStore = require('../store/inventory.store');
const coordenadasStore = require('../store/coordenadas.store');

// Cada fuente sabe cómo pedirse (fetch) y dónde guardarse (store) —
// agregar una nueva (Variables, Líneas picking...) es sumar una
// entrada acá, nada más de este archivo cambia.
const SOURCES = [
  { key: 'referencia', fetch: copernico.fetchReferencia, store: inventoryStore },
  { key: 'coordenadas', fetch: copernico.fetchCoordenadas, store: coordenadasStore },
];

const LOCK_FILE = path.join(__dirname, '..', 'data', 'refresh.lock');
// El id numérico de usuario que devuelve el JWT no es propio de una
// sesión — es el mismo siempre para esta cuenta. Por eso se guarda
// aparte del lock de corrida (que se limpia en cada finally) y nunca
// se borra: es lo único que permite forzar un logout "desde afuera"
// (POST /users/api/logout solo necesita ese id, no un token vigente)
// cuando la sesión activa quedó colgada de antes de que este archivo
// existiera o de una corrida cuyo lock ya se perdió.
const UID_FILE = path.join(__dirname, '..', 'data', 'known-uid.json');

let runningInMemory = false;

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeLock(state) {
  try {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    if (state) fs.writeFileSync(LOCK_FILE, JSON.stringify(state));
    else fs.rmSync(LOCK_FILE, { force: true });
  } catch (e) {
    console.error('[inventory-engine] No se pudo actualizar el lock en disco:', e.message);
  }
}

function readKnownUid() {
  try {
    return JSON.parse(fs.readFileSync(UID_FILE, 'utf8')).uid ?? null;
  } catch {
    return null;
  }
}

function rememberUid(uid) {
  if (uid == null) return;
  try {
    fs.mkdirSync(path.dirname(UID_FILE), { recursive: true });
    fs.writeFileSync(UID_FILE, JSON.stringify({ uid }));
  } catch (e) {
    console.error('[inventory-engine] No se pudo guardar el uid conocido:', e.message);
  }
}

function isRunning() {
  return runningInMemory;
}

// Login con un único reintento acotado: si Copernico dice que ya hay
// una sesión activa, se fuerza su cierre con el id de usuario más
// confiable que tengamos a mano (primero el del lock de la corrida
// interrumpida más reciente, si existe; si no, el último uid conocido
// de cualquier login exitoso anterior) y se prueba login una sola vez
// más. Nunca más de un reintento — si vuelve a fallar, se informa el
// error tal cual, sin insistir de nuevo.
async function loginWithRecovery() {
  try {
    const session = await copernico.login(config.COPERNICO_EMAIL, config.COPERNICO_PASSWORD);
    rememberUid(session.uid);
    return session;
  } catch (err) {
    if (err.code !== 'ALREADY_LOGGED_IN') throw err;

    const stale = readLock();
    // ?? en vez de || : un uid real de 0 es improbable pero sería un
    // valor válido, y || lo descartaría por "falsy" como si no hubiera
    // ninguno guardado.
    const recoveryUid = stale?.uid ?? readKnownUid();
    if (recoveryUid != null) {
      await copernico.logout(stale?.token, recoveryUid);
    }
    const session = await copernico.login(config.COPERNICO_EMAIL, config.COPERNICO_PASSWORD);
    rememberUid(session.uid);
    return session;
  }
}

async function refresh() {
  if (runningInMemory) {
    return { ok: false, error: 'ALREADY_RUNNING' };
  }

  const startedAt = Date.now();
  runningInMemory = true;
  let session = null;
  let result;

  try {
    if (!config.COPERNICO_EMAIL || !config.COPERNICO_PASSWORD) {
      result = { ok: false, error: 'MISSING_CREDENTIALS' };
    } else {
      try {
        session = await loginWithRecovery();
      } catch (err) {
        result = { ok: false, error: err.code || 'LOGIN_FAILED', message: err.message };
      }

      if (session) {
        const loggedInAt = Date.now();
        // A partir de acá ya consumimos una licencia — el lock queda
        // escrito hasta el logout final, incluso si alguna consulta
        // falla, para que una corrida futura pueda detectar y liberar
        // esta sesión si el proceso se cae en el medio.
        writeLock({ token: session.token, uid: session.uid, startedAt });

        // Una fuente que falla no frena a las demás — ya se pagó el
        // costo de la licencia con este login, así que tiene sentido
        // intentar todas antes de soltarla. Cada una registra su
        // propio resultado en su propio store (por eso cada tarjeta
        // del desk puede estar en un estado distinto a la vez).
        // `sources` siempre guarda el meta "pelado" de cada store (el
        // mismo objeto que devuelve GET /status) — nunca envuelto en
        // {ok, meta}/{ok, error}. Como replaceAll() deja status:'ok' y
        // recordError() deja status:'error', el propio meta ya dice
        // si esa fuente salió bien, sin necesitar una forma distinta
        // en la respuesta de refresh() vs. la de status().
        const perSource = {};
        for (const src of SOURCES) {
          const sourceStartedAt = Date.now();
          try {
            const rawRows = await src.fetch(session.token, config.COPERNICO_BODEGA);
            perSource[src.key] = src.store.replaceAll(rawRows, {
              bodega: config.COPERNICO_BODEGA,
              durationMs: Date.now() - sourceStartedAt,
            });
            console.log(`[inventory-engine] ${src.key}: ${Date.now() - sourceStartedAt}ms · filas: ${rawRows.length}`);
          } catch (err) {
            console.log(`[inventory-engine] ${src.key}: falló a los ${Date.now() - sourceStartedAt}ms · error: ${err.code || 'FETCH_FAILED'}`);
            perSource[src.key] = src.store.recordError({ code: err.code || 'FETCH_FAILED', message: err.message });
          }
        }

        console.log(`[inventory-engine] login: ${loggedInAt - startedAt}ms · total: ${Date.now() - startedAt}ms`);
        result = { ok: Object.values(perSource).some((m) => m.status !== 'error'), sources: perSource };
      }
    }
  } finally {
    // El logout corre siempre, pase lo que pase arriba — es lo que
    // libera la licencia. Un logout fallido no debe ocultar el
    // resultado real de la corrida (ok o el error que ya se detectó).
    //
    // Si el logout falla, a propósito NO se borra el lock: sin él, la
    // próxima corrida no tendría con qué uid/token forzar el cierre de
    // esta sesión colgada en loginWithRecovery(), y quedaría reintentando
    // login a ciegas para siempre contra una licencia que nunca se libera.
    const loggedOut = session ? await copernico.logout(session.token, session.uid) : true;
    if (loggedOut) writeLock(null);
    runningInMemory = false;
  }

  // Falla a nivel login (nunca se llegó a intentar ninguna fuente):
  // se refleja en TODAS las fuentes configuradas, para que ninguna
  // tarjeta quede mostrando "sin datos" cuando en realidad la
  // corrida sí se intentó y falló.
  if (!result.sources) {
    for (const src of SOURCES) src.store.recordError({ code: result.error, message: result.message });
  }
  return result;
}

module.exports = { refresh, isRunning };
