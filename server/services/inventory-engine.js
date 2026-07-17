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
   ============================================================ */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const copernico = require('./copernico-client');
const inventoryStore = require('../store/inventory.store');

const LOCK_FILE = path.join(__dirname, '..', 'data', 'refresh.lock');

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

function isRunning() {
  return runningInMemory;
}

// Login con un único reintento acotado: si Copernico dice que ya hay
// una sesión activa (por ejemplo porque un refresh anterior se cortó
// a mitad de camino sin llegar a hacer logout), usamos el uid que
// haya quedado registrado en el lock persistido para forzar el cierre
// de esa sesión colgada y probar login una sola vez más. Nunca más de
// un reintento — si vuelve a fallar, se informa el error tal cual.
async function loginWithRecovery() {
  try {
    return await copernico.login(config.COPERNICO_EMAIL, config.COPERNICO_PASSWORD);
  } catch (err) {
    if (err.code !== 'ALREADY_LOGGED_IN') throw err;

    const stale = readLock();
    if (stale?.uid) {
      await copernico.logout(stale.token, stale.uid);
    }
    // Un solo reintento — si la sesión activa es de otro dispositivo
    // real (no una nuestra colgada), esto vuelve a fallar y se informa
    // como tal, sin insistir de nuevo.
    return await copernico.login(config.COPERNICO_EMAIL, config.COPERNICO_PASSWORD);
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
        // A partir de acá ya consumimos una licencia — el lock queda
        // escrito hasta el logout final, incluso si el fetch falla,
        // para que una corrida futura pueda detectar y liberar esta
        // sesión si el proceso se cae en el medio.
        writeLock({ token: session.token, uid: session.uid, startedAt });

        try {
          const rawRows = await copernico.fetchReferencia(session.token, config.COPERNICO_BODEGA);
          const meta = inventoryStore.replaceAll(rawRows, {
            bodega: config.COPERNICO_BODEGA,
            durationMs: Date.now() - startedAt,
          });
          result = { ok: true, meta };
        } catch (err) {
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
