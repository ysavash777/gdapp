/* ============================================================
   GDapp · Lógica compartida de actualización de bases de datos
   (Copernico WMS) — la consumen desk/modules/basesdatos.js y
   app/modules/settings.js, cada uno con su propia UI/polling, pero
   con la MISMA forma de pedir el estado/disparar la corrida y, sobre
   todo, la MISMA cuenta para estimar cuánto va a tardar — duplicar
   esa cuenta en dos archivos es el tipo de cosa que un día se corrige
   en uno y se olvida en el otro.

   fetchStatus()/triggerRefresh() son wrappers finos de la API
   (GET/POST /api/database/*). estimateSourceMs()/estimateTotalMs() son
   el estimador real: usan durationMs (Copernico) + mirrorDurationMs
   (Supabase) de la ÚLTIMA corrida buena de cada fuente — tiempo
   MEDIDO, no adivinado — porque son los dos tramos que de verdad
   consumen tiempo en una corrida (ver inventory-engine.js). Si una
   fuente puntual nunca corrió (sin durationMs todavía), se estima
   proporcional al peso en filas contra cualquier otra fuente que sí
   tenga un dato real (más preciso que un número fijo igual para
   todas: Coordenadas trae ~20000 filas y Referencia ~11000, tardan
   distinto). Solo si NINGUNA fuente tiene nunca un dato real (recién
   instalada, jamás se corrió "Actualizar DB") se usa un número fijo
   como último recurso — no hay nada contra qué calcular todavía.
   ============================================================ */

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

// Tiempo real de punta a punta de la ÚLTIMA corrida buena de `key`
// (Copernico + espejo en Supabase) — o, si nunca corrió, una
// estimación proporcional al peso en filas contra otra fuente
// conocida dentro de `sourcesMeta`.
export function estimateSourceMs(sourcesMeta, key) {
  const s = sourcesMeta[key];
  if (s?.durationMs) return s.durationMs + (s.mirrorDurationMs || 0);

  const known = Object.values(sourcesMeta).find((s2) => s2?.durationMs && s2.rowCount);
  if (known && s?.rowCount) {
    return Math.round((known.durationMs + (known.mirrorDurationMs || 0)) * (s.rowCount / known.rowCount));
  }
  return DEFAULT_ESTIMATE_MS;
}

// Suma de estimateSourceMs() para cada key en `keys` — lo usa la
// corrida masiva (todas las fuentes activas) para calibrar cuánto
// tarda el total, no solo una.
export function estimateTotalMs(sourcesMeta, keys) {
  return keys.reduce((total, key) => total + estimateSourceMs(sourcesMeta, key), 0);
}
