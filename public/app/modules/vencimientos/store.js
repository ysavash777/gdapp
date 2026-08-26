// Módulo Vencimientos — cliente de /api/vencimientos. Sin caché
// offline-first: la lista cambia con cada corrida de Referencia y con
// cada validación de cualquier usuario, así que siempre se pide fresca.

import { apiFetch } from '/shared/js/api.js';

// Siempre ordenado por ubicación en el servidor; Pendiente/Validado es
// un filtro del cliente sobre esta misma lista (ver list-view.js).
export async function list() {
  const { items, excludedLocations, windowDays, retirarDays } = await apiFetch('/api/vencimientos');
  return { items, excludedLocations, windowDays, retirarDays };
}

// saldo/pedprov/unidadmedida viajan tal cual estaban en `item` al validar
// — el servidor los CONGELA ahí (ver validateItem en vencimientos.store.js)
// para que la validación no cambie si después Referencia se actualiza.
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
      saldo: item.saldo,
      pedprov: item.pedprov,
      unidadmedida: item.unidadmedida,
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

// Edita solo la observación de un ítem ya validado; nunca toca motivo/foto.
export async function updateObservacion(item, motivoDetalle) {
  await apiFetch('/api/vencimientos/validate', {
    method: 'PATCH',
    body: { bodega: item.bodega, caja: item.caja, ean: item.ean, motivoDetalle },
  });
}

export async function getSettings() {
  const { excludedLocations } = await apiFetch('/api/vencimientos/settings');
  return excludedLocations;
}

export async function updateSettings(excludedLocations) {
  await apiFetch('/api/vencimientos/settings', { method: 'PUT', body: { excludedLocations } });
}
