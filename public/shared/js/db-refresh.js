// Lógica compartida de actualización de bases de datos (Copernico WMS),
// usada por desk/modules/basesdatos.js y app/modules/settings.js para no
// duplicar la cuenta de estimación de tiempo en ambos lados.

import { apiFetch } from './api.js';

const DEFAULT_ESTIMATE_MS = 30_000;

export function fetchStatus() {
  return apiFetch('/api/database/status');
}

// sourceKey: omitido = corrida masiva (todas las fuentes); con valor,
// solo esa (ver POST /api/database/refresh).
export function triggerRefresh(sourceKey) {
  return apiFetch('/api/database/refresh', { method: 'POST', body: sourceKey ? { source: sourceKey } : {} });
}

// Duración real (durationMs + mirrorDurationMs) de la última corrida buena de `key`.
// Si nunca corrió, estima proporcional al rowCount contra otra fuente con dato real;
// si ninguna fuente tiene dato real, usa DEFAULT_ESTIMATE_MS.
export function estimateSourceMs(sourcesMeta, key) {
  const s = sourcesMeta[key];
  if (s?.durationMs) return s.durationMs + (s.mirrorDurationMs || 0);

  const known = Object.values(sourcesMeta).find((s2) => s2?.durationMs && s2.rowCount);
  if (known && s?.rowCount) {
    return Math.round((known.durationMs + (known.mirrorDurationMs || 0)) * (s.rowCount / known.rowCount));
  }
  return DEFAULT_ESTIMATE_MS;
}

// Suma de estimateSourceMs() para cada key — total estimado de una corrida masiva.
export function estimateTotalMs(sourcesMeta, keys) {
  return keys.reduce((total, key) => total + estimateSourceMs(sourcesMeta, key), 0);
}
