/* ============================================================
   Módulo App · Vencimientos — cliente de /api/vencimientos.
   A diferencia de Mapear, no hay caché offline-first: esta lista
   cambia con cada corrida de "Actualizar DB" (Referencia) y con cada
   validación de cualquier usuario — siempre se pide fresca. "Los
   avances son online" es justamente el punto: no tiene sentido
   guardar una foto local que puede quedar vieja en minutos.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';

// Siempre ordenado por ubicación (el servidor ya no acepta otro orden
// — Pendiente/Validado es un FILTRO del cliente sobre esta lista, ver
// list-view.js).
export async function list() {
  const { items, excludedLocations, windowDays, retirarDays } = await apiFetch('/api/vencimientos');
  return { items, excludedLocations, windowDays, retirarDays };
}

// fotoBase64 (data URL) es obligatoria cuando motivo === 'faltante' —
// el servidor la exige igual, esto solo evita un viaje de red al pedo
// si por algún motivo se llama sin ella.
export async function validate(item, motivo, motivoDetalle, fotoBase64) {
  await apiFetch('/api/vencimientos/validate', {
    method: 'POST',
    body: {
      bodega: item.bodega,
      caja: item.caja,
      ean: item.ean,
      referencia: item.referencia,
      ubicacion: item.ubicacion,
      descripcion: item.descripcion,
      fv: item.fv,
      motivo,
      motivoDetalle,
      fotoBase64,
    },
  });
}

export async function clearValidation(item) {
  await apiFetch('/api/vencimientos/validate', {
    method: 'DELETE',
    body: { bodega: item.bodega, caja: item.caja, ean: item.ean },
  });
}

export async function getSettings() {
  const { excludedLocations } = await apiFetch('/api/vencimientos/settings');
  return excludedLocations;
}

export async function updateSettings(excludedLocations) {
  await apiFetch('/api/vencimientos/settings', { method: 'PUT', body: { excludedLocations } });
}
