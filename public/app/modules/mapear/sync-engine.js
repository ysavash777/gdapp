/* ============================================================
   Módulo App · Mapear — motor de sincronización en segundo plano.

   Cola de trabajos (outbox) persistida en localStorage: cada alta,
   edición o baja de un código se encola acá y se intenta enviar a
   /api/mapeos en orden, uno a la vez — nunca en paralelo, para no
   saturar el servidor ni arriesgar dos escrituras concurrentes sobre
   el mismo mapeo — y solo mientras haya algo pendiente: sin trabajos
   en cola no queda ningún timer corriendo.

   Sigue drenando la cola aunque se cierre el editor (vive mientras el
   módulo esté cargado, es decir mientras dure la pestaña) y retoma
   sola al recuperar conexión (evento 'online') o, como red de
   seguridad para el caso en que ese evento no llegue a disparar, cada
   RETRY_MS mientras siga habiendo algo sin enviar.

   store.js es el único consumidor: encola trabajos con enqueueAdd/
   enqueueUpdate/enqueueRemove y escucha sus resultados vía onEvent
   para reflejarlos en su caché local — este archivo no sabe qué es
   un "código" ni un "mapeo", solo ejecuta HTTP contra la forma ya
   conocida de /api/mapeos y guarda el estado de la cola.

   Límite conocido: la cola vive en localStorage sin coordinación
   entre pestañas — pensado para una sola pestaña activa por
   dispositivo (el uso real: un operario, un celular, un mapeo a la
   vez). Un trabajo que se cae justo después de que el servidor ya lo
   aplicó (crash a mitad de la respuesta) se reintenta igual al
   recargar — puede duplicar como mucho ese único registro; se acepta
   ese riesgo puntual a cambio de no necesitar claves de idempotencia
   en el servidor.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';

const OUTBOX_KEY = 'gd.mapear.outbox.v1';
const RETRY_MS = 8000;

let outbox = loadOutbox();
// Un trabajo que quedó marcado "sending" de una sesión anterior (la
// pestaña se cerró a mitad de un request) no sabemos si en verdad se
// aplicó o no — se trata como no enviado y se reintenta desde cero.
outbox.forEach((j) => { j.sending = false; });

let processing = false;
let flushTimer = null;
const listeners = new Set();

function loadOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch (e) {
    // Cuota llena o storage deshabilitado (modo privado): la cola
    // sigue funcionando en memoria para esta sesión, solo se pierde
    // el respaldo en disco si se cierra la pestaña a mitad de camino.
    console.error('[mapear/sync-engine] No se pudo persistir la cola:', e.message);
  }
}

function cryptoId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function onEvent(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(evt) {
  listeners.forEach((cb) => cb(evt));
}

// fetch() rechaza con TypeError cuando no hay red (offline, DNS caído,
// etc.) — cualquier otro error ya es una respuesta real del servidor
// (4xx/5xx, con su propio código en err.message vía apiFetch).
function isNetworkError(err) {
  return err instanceof TypeError || !navigator.onLine;
}

// ---- Encolar ----

export function enqueueAdd(mapeoId, codeId, code) {
  outbox.push({ jobId: cryptoId(), mapeoId, codeId, kind: 'add', code, sending: false });
  persist();
  scheduleFlush(0);
}

// Varias ediciones seguidas del mismo registro (cantidad, motivo,
// fecha) se combinan en un solo trabajo mientras no se haya empezado
// a enviar — así no sale un request por cada campo tocado.
export function enqueueUpdate(mapeoId, codeId, patch) {
  const existing = outbox.find((j) => j.kind === 'update' && j.mapeoId === mapeoId && j.codeId === codeId && !j.sending);
  if (existing) {
    existing.patch = { ...existing.patch, ...patch };
  } else {
    outbox.push({ jobId: cryptoId(), mapeoId, codeId, kind: 'update', patch, sending: false });
  }
  persist();
  scheduleFlush(0);
}

// Si el alta de este código todavía no se envió, no hace falta tocar
// la red en absoluto: se descarta junto con cualquier edición
// encolada para el mismo id, como si nunca hubiera salido del
// dispositivo.
export function enqueueRemove(mapeoId, codeId) {
  const pendingAdd = outbox.find((j) => j.kind === 'add' && j.mapeoId === mapeoId && j.codeId === codeId && !j.sending);
  if (pendingAdd) {
    outbox = outbox.filter((j) => !(j.mapeoId === mapeoId && j.codeId === codeId && !j.sending));
    persist();
    return;
  }
  outbox = outbox.filter((j) => !(j.mapeoId === mapeoId && j.codeId === codeId && j.kind === 'update' && !j.sending));
  outbox.push({ jobId: cryptoId(), mapeoId, codeId, kind: 'remove', sending: false });
  persist();
  scheduleFlush(0);
}

// El id local (temporal, string) de un alta se reemplaza por el id
// real que asigna el servidor apenas esa alta se confirma — cualquier
// otro trabajo que todavía la esté esperando en la cola (una edición,
// una baja) se actualiza para apuntar al id real, sin que quien
// encoló ese trabajo tenga que saber que el id cambió.
export function remapId(mapeoId, oldId, newId) {
  let changed = false;
  outbox.forEach((j) => {
    if (j.mapeoId === mapeoId && j.codeId === oldId) {
      j.codeId = newId;
      changed = true;
    }
  });
  if (changed) persist();
}

// Se llama al borrar un mapeo entero: nada de lo que quedó en cola
// para él tiene ya destino donde aplicarse.
export function cancelMapeo(mapeoId) {
  const before = outbox.length;
  outbox = outbox.filter((j) => j.mapeoId !== mapeoId);
  if (outbox.length !== before) persist();
}

// ---- Drenaje ----

function scheduleFlush(delay) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function flush() {
  if (processing) return;
  if (!outbox.length) return; // nada pendiente: el motor queda inactivo hasta el próximo enqueue, no se reprograma nada

  if (!navigator.onLine) {
    outbox.forEach((j) => emit({ type: 'offline', mapeoId: j.mapeoId, codeId: j.codeId, kind: j.kind }));
    scheduleFlush(RETRY_MS);
    return;
  }

  const job = outbox[0];
  job.sending = true;
  processing = true;
  emit({ type: 'sending', mapeoId: job.mapeoId, codeId: job.codeId, kind: job.kind });

  try {
    const data = await send(job);
    outbox.shift();
    persist();
    emit({ type: `${job.kind}-success`, mapeoId: job.mapeoId, codeId: job.codeId, kind: job.kind, mapeo: data.mapeo });
  } catch (err) {
    if (isNetworkError(err)) {
      job.sending = false;
      persist();
      emit({ type: 'offline', mapeoId: job.mapeoId, codeId: job.codeId, kind: job.kind });
      processing = false;
      scheduleFlush(RETRY_MS);
      return;
    }
    // Error real del servidor (ej. el mapeo o el código ya no
    // existen): este trabajo nunca va a poder aplicarse tal cual, así
    // que se descarta en vez de reintentarlo para siempre.
    outbox.shift();
    persist();
    emit({ type: 'error', mapeoId: job.mapeoId, codeId: job.codeId, kind: job.kind, error: err });
  }

  processing = false;
  if (outbox.length) scheduleFlush(0);
}

function send(job) {
  if (job.kind === 'add') {
    return apiFetch(`/api/mapeos/${job.mapeoId}/codes`, { method: 'POST', body: { code: job.code } });
  }
  if (job.kind === 'update') {
    return apiFetch(`/api/mapeos/${job.mapeoId}/codes/${job.codeId}`, { method: 'PATCH', body: job.patch });
  }
  return apiFetch(`/api/mapeos/${job.mapeoId}/codes/${job.codeId}`, { method: 'DELETE' });
}

// Apenas vuelve la red, se intenta de una en vez de esperar el
// próximo RETRY_MS entero.
window.addEventListener('online', () => scheduleFlush(0));

// Si quedó algo pendiente de una sesión anterior (pestaña cerrada u
// offline a medio sincronizar), se reintenta apenas se carga el
// módulo.
if (outbox.length) scheduleFlush(0);
