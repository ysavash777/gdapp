/* ============================================================
   Módulo App · Vencimientos — cliente de /api/vencimientos.
   A diferencia de Mapear, no hay caché offline-first: esta lista
   cambia con cada corrida de "Actualizar DB" (Referencia) y con cada
   validación de cualquier usuario — siempre se pide fresca. "Los
   avances son online" es justamente el punto: no tiene sentido
   guardar una foto local que puede quedar vieja en minutos.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';

export async function list(sortBy) {
  const { items, excludedLocations, windowDays, retirarDays } = await apiFetch(`/api/vencimientos?sortBy=${sortBy}`);
  return { items, excludedLocations, windowDays, retirarDays };
}

export async function validate(item, motivo, motivoDetalle) {
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
