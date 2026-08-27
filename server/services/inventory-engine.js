/* ============================================================
   Motor de actualización de la base de datos (Copernico WMS).
   refresh(sourceKeys?) trae una o todas las fuentes (SOURCES); un
   login/logout por corrida (nunca uno por fuente, Copernico lo exige
   así). Cada fuente exitosa también se espeja en Supabase (best-effort,
   ver services/supabase-sync.js).

   Reglas duras:
   1. Este archivo nunca se auto-invoca: solo lo disparan la ruta
      POST /api/database/refresh y services/refresh-scheduler.js.
   2. Nunca dos refresh en simultáneo (lock en memoria + disco): si ya
      hay uno en curso, devuelve ALREADY_RUNNING. El lock persistido
      también detecta un refresh interrumpido por reinicio del proceso
      (sesión quedó tomada del lado de Copernico) y fuerza logout con
      el último uid conocido antes de reintentar login.
   3. El logout forzado solo necesita el id numérico de usuario (no un
      token vigente) — se guarda en known-uid.json para poder recuperar
      una sesión colgada aunque se haya perdido el lock de esa corrida.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const copernico = require('./copernico-client');
const inventoryStore = require('../store/inventory.store');
const coordenadasStore = require('../store/coordenadas.store');
const variablesStore = require('../store/variables.store');
const supabaseSync = require('./supabase-sync');

// Cada fuente: fetch, store local, tabla de Supabase a espejar.
// conflictKey: columnas con unique constraint natural en Supabase —
// sin esto, replaceTableDiff() no tiene forma segura de identificar la
// MISMA fila entre corridas y cae al reemplazo completo de siempre
// (ver supabase-sync.js). ubicacion es única en layout_coordenadas;
// en variables_logisticas hace falta el par (referencia, productoean)
// porque una misma referencia puede repetirse con distinto EAN (caso
// real confirmado: 7792170110704 aparece dos veces, un Gatorade con
// dos códigos de producto distintos).
const SOURCES = [
  { key: 'referencia', fetch: copernico.fetchReferencia, store: inventoryStore, supabaseTable: 'inventario_cajas', conflictKey: 'bodega,caja,ean' },
  { key: 'coordenadas', fetch: copernico.fetchCoordenadas, store: coordenadasStore, supabaseTable: 'layout_coordenadas', conflictKey: 'ubicacion' },
  { key: 'variables', fetch: copernico.fetchVariables, store: variablesStore, supabaseTable: 'variables_logisticas', conflictKey: 'referencia,productoean' },
];

const LOCK_FILE = path.join(__dirname, '..', 'data', 'refresh.lock');
// El uid del JWT es fijo para esta cuenta — se guarda aparte del lock
// (que sí se limpia en cada finally) y nunca se borra, para poder
// forzar logout (solo necesita el id, no token) aunque el lock se
// haya perdido.
const UID_FILE = path.join(__dirname, '..', 'data', 'known-uid.json');

let runningInMemory = false;
// Fuentes de la corrida en curso (null si no hay ninguna) — lo lee
// GET /status para que cada tarjeta muestre su propio progreso.
let runningKeysInMemory = null;

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

function getRunningKeys() {
  return runningKeysInMemory;
}

// Al arrancar el proceso: no toca Copernico, solo hidrata desde
// Supabase la última corrida buena de cada fuente.
async function hydrate() {
  await Promise.all(SOURCES.map((src) => src.store.hydrateFromSupabase()));
}

// Un único reintento: si Copernico dice sesión ya activa, se fuerza su
// cierre (uid del lock interrumpido, o el último conocido) y se prueba
// login una vez más. Si vuelve a fallar, se propaga tal cual.
async function loginWithRecovery() {
  try {
    const session = await copernico.login(config.COPERNICO_EMAIL, config.COPERNICO_PASSWORD);
    rememberUid(session.uid);
    return session;
  } catch (err) {
    if (err.code !== 'ALREADY_LOGGED_IN') throw err;

    const stale = readLock();
    const recoveryUid = stale?.uid ?? readKnownUid(); // ?? no ||: uid 0 sería válido
    if (recoveryUid != null) {
      await copernico.logout(stale?.token, recoveryUid);
    }
    const session = await copernico.login(config.COPERNICO_EMAIL, config.COPERNICO_PASSWORD);
    rememberUid(session.uid);
    return session;
  }
}

// sourceKeys: opcional, ej. ['referencia'] — el login/logout sigue
// siendo uno solo igual que con la corrida masiva. Sin el parámetro,
// corren TODAS.
async function refresh(sourceKeys) {
  if (runningInMemory) {
    return { ok: false, error: 'ALREADY_RUNNING' };
  }

  const sources = sourceKeys ? SOURCES.filter((s) => sourceKeys.includes(s.key)) : SOURCES;
  if (!sources.length) {
    return { ok: false, error: 'UNKNOWN_SOURCE' };
  }

  const startedAt = Date.now();
  runningInMemory = true;
  runningKeysInMemory = sources.map((s) => s.key);
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
        // Lock queda escrito hasta el logout final (incluso si alguna
        // consulta falla) para que una corrida futura detecte y libere
        // la sesión si el proceso se cae en el medio.
        writeLock({ token: session.token, uid: session.uid, startedAt });

        // Una fuente que falla no frena a las demás. perSource guarda el
        // meta "pelado" de cada store (mismo objeto que GET /status);
        // replaceAll() deja status:'ok', recordError() deja 'error'.
        const perSource = {};
        for (const src of sources) {
          const sourceStartedAt = Date.now();
          try {
            // Capturado ANTES de replaceAll() (que pisa la foto vieja en
            // memoria) — es lo único contra lo que se puede diffear fila a
            // fila para el espejo en Supabase (ver replaceTableDiff).
            const previousRows = src.store.getRowsForExport();
            const rawRows = await src.fetch(session.token, config.COPERNICO_BODEGA);
            perSource[src.key] = src.store.replaceAll(rawRows, {
              bodega: config.COPERNICO_BODEGA,
              durationMs: Date.now() - sourceStartedAt,
            });
            console.log(`[inventory-engine] ${src.key}: ${Date.now() - sourceStartedAt}ms · filas: ${rawRows.length}`);

            // Espejo en Supabase es best-effort: no afecta el status de
            // la tarjeta (eso refleja solo si Copernico respondió bien).
            // Se mide aparte de durationMs porque la barra de progreso
            // del desk necesita el tiempo real de punta a punta.
            const supabaseStartedAt = Date.now();
            try {
              const syncResult = await supabaseSync.replaceTableDiff(src.supabaseTable, previousRows, src.store.getRowsForExport(), { conflictKey: src.conflictKey });
              const mirrorDurationMs = Date.now() - supabaseStartedAt;
              if (syncResult.skipped) {
                console.log(`[inventory-engine] ${src.key} → Supabase: omitido (sin configurar).`);
              } else {
                await supabaseSync.logSync(src.key, { status: 'ok', rowCount: rawRows.length, durationMs: mirrorDurationMs });
                console.log(`[inventory-engine] ${src.key} → Supabase (${src.supabaseTable}): ${mirrorDurationMs}ms · cambiadas: ${syncResult.upserted ?? rawRows.length} · borradas: ${syncResult.deleted ?? 0}`);
                src.store.recordMirror(true, null, mirrorDurationMs);
              }
            } catch (supaErr) {
              const mirrorDurationMs = Date.now() - supabaseStartedAt;
              await supabaseSync.logSync(src.key, { status: 'error', errorMessage: supaErr.message, durationMs: mirrorDurationMs });
              console.error(`[inventory-engine] ${src.key} → Supabase falló:`, supaErr.message);
              src.store.recordMirror(false, supaErr.message, mirrorDurationMs);
            }
          } catch (err) {
            console.log(`[inventory-engine] ${src.key}: falló a los ${Date.now() - sourceStartedAt}ms · error: ${err.code || 'FETCH_FAILED'}`);
            perSource[src.key] = src.store.recordError({ code: err.code || 'FETCH_FAILED', message: err.message });
            await supabaseSync.logSync(src.key, { status: 'error', errorCode: err.code || 'FETCH_FAILED', errorMessage: err.message });
          }
        }

        console.log(`[inventory-engine] login: ${loggedInAt - startedAt}ms · total: ${Date.now() - startedAt}ms`);
        result = { ok: Object.values(perSource).some((m) => m.status !== 'error'), sources: perSource };
      }
    }
  } finally {
    // Logout corre siempre (libera la licencia) y no oculta el resultado
    // real de la corrida. Si falla, a propósito NO se borra el lock:
    // sin él, loginWithRecovery() no tendría con qué uid forzar el
    // cierre de esta sesión colgada en la próxima corrida.
    const loggedOut = session ? await copernico.logout(session.token, session.uid) : true;
    if (loggedOut) writeLock(null);
    runningInMemory = false;
    runningKeysInMemory = null;
  }

  // Falla a nivel login: se refleja en las fuentes pedidas para que
  // ninguna tarjeta quede mostrando "sin datos" en vez del error real.
  if (!result.sources) {
    for (const src of sources) src.store.recordError({ code: result.error, message: result.message });
  }
  return result;
}

module.exports = { refresh, isRunning, getRunningKeys, hydrate };
