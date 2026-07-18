/* ============================================================
   Módulo App · Mapear — capa de datos.

   Cliente de /api/mapeos (server/routes/mapeos.js + store/mapeos.store.js,
   Supabase) — antes vivía entero en un array en memoria del navegador
   y se perdía todo al recargar la página; ahora el servidor es la
   única fuente real y esto solo llama a su API.

   Mismas funciones y misma firma que el store en memoria que
   reemplaza (incluido el parámetro `actor`, aunque ya no se envía: el
   servidor lo fija desde la sesión autenticada) — list-view.js y
   editor-view.js no cambian, porque ya trabajan contra esta interfaz.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';

export async function list() {
  const { items } = await apiFetch('/api/mapeos');
  return items;
}

export async function get(id) {
  try {
    const { mapeo } = await apiFetch(`/api/mapeos/${id}`);
    return mapeo;
  } catch (err) {
    if (err.message === 'NOT_FOUND') return null;
    throw err;
  }
}

export async function create(actor, title) {
  const { mapeo } = await apiFetch('/api/mapeos', { method: 'POST', body: { title } });
  return mapeo;
}

export async function rename(id, title, actor) {
  const { mapeo } = await apiFetch(`/api/mapeos/${id}`, { method: 'PATCH', body: { title } });
  return mapeo;
}

export async function remove(id) {
  await apiFetch(`/api/mapeos/${id}`, { method: 'DELETE' });
}

export async function addCode(mapeoId, rawCode, actor) {
  const { mapeo } = await apiFetch(`/api/mapeos/${mapeoId}/codes`, { method: 'POST', body: { code: rawCode } });
  return mapeo;
}

export async function updateCode(mapeoId, codeId, patch, actor) {
  const { mapeo } = await apiFetch(`/api/mapeos/${mapeoId}/codes/${codeId}`, { method: 'PATCH', body: patch });
  return mapeo;
}

export async function removeCode(mapeoId, codeId, actor) {
  const { mapeo } = await apiFetch(`/api/mapeos/${mapeoId}/codes/${codeId}`, { method: 'DELETE' });
  return mapeo;
}
