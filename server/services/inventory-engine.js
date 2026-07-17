/* ============================================================
   Motor de actualización de la base de datos (referencia Copernico).

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
        // escrito hasta el logout final, incluso si el fetch falla,
        // para que una corrida futura pueda detectar y liberar esta
        // sesión si el proceso se cae en el medio.
        writeLock({ token: session.token, uid: session.uid, startedAt });

        try {
          const rawRows = await copernico.fetchReferencia(session.token, config.COPERNICO_BODEGA);
          const fetchedAt = Date.now();
          const meta = inventoryStore.replaceAll(rawRows, {
            bodega: config.COPERNICO_BODEGA,
            durationMs: fetchedAt - startedAt,
          });
          // Diagnóstico de dónde se va el tiempo — la duración total
          // depende casi por completo del login+consulta contra el
          // servidor de Copernico (fuera de nuestro control); esto lo
          // deja visible en los logs en vez de ser una suposición.
          console.log(
            `[inventory-engine] login: ${loggedInAt - startedAt}ms · consulta: ${fetchedAt - loggedInAt}ms · total: ${fetchedAt - startedAt}ms · filas: ${rawRows.length}`
          );
          result = { ok: true, meta };
        } catch (err) {
          console.log(`[inventory-engine] login: ${loggedInAt - startedAt}ms · consulta falló a los: ${Date.now() - loggedInAt}ms · error: ${err.code || 'FETCH_FAILED'}`);
          result = { ok: false, error: err.code || 'FETCH_FAILED', message: err.message };
        }
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

  if (!result.ok) inventoryStore.recordError({ code: result.error, message: result.message });
  return result;
}

module.exports = { refresh, isRunning };
