// Módulo App · Mapear — motor de sincronización en segundo plano.
// Cola (outbox) persistida en localStorage: cada alta/edición/baja se encola
// y se envía a /api/mapeos en orden, uno a la vez, mientras haya algo pendiente.
// Sigue drenando aunque se cierre el editor, y retoma al volver la conexión
// (evento 'online') o cada RETRY_MS como red de seguridad. store.js es el
// único consumidor (enqueueAdd/Update/Remove + onEvent).
//
// Límite conocido: sin coordinación entre pestañas (pensado para una sola
// pestaña activa por dispositivo). Un trabajo que se cae justo después de que
// el servidor ya lo aplicó se reintenta igual al recargar — puede duplicar
// como mucho ese registro; riesgo aceptado a cambio de no necesitar
// idempotencia en el servidor.

import { apiFetch } from '/shared/js/api.js';

const OUTBOX_KEY = 'gd.mapear.outbox.v1';
const RETRY_MS = 8000;

let outbox = loadOutbox();
// Un trabajo marcado "sending" de una sesión anterior (pestaña cerrada a
// mitad de un request): no se sabe si se aplicó, se trata como no enviado.
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
    // Cuota llena o storage deshabilitado: sigue en memoria, se pierde el respaldo en disco.
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

// fetch() rechaza con TypeError sin red; cualquier otro error es una respuesta real del servidor.
function isNetworkError(err) {
  return err instanceof TypeError || !navigator.onLine;
}

// ---- Encolar ----

export function enqueueAdd(mapeoId, codeId, code) {
  outbox.push({ jobId: cryptoId(), mapeoId, codeId, kind: 'add', code, sending: false });
  persist();
  scheduleFlush(0);
}

// Ediciones seguidas del mismo registro se combinan en un solo trabajo
// mientras no se haya empezado a enviar.
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

// Si el alta todavía no se envió, se descarta sin tocar la red, junto con
// cualquier edición encolada para el mismo id.
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

// Al confirmarse un alta, actualiza cualquier otro trabajo en cola que
// todavía apunte al id temporal para que apunte al id real.
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
