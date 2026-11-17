// Aviso de "bases de datos sin actualizar": el servidor las refresca solo,
// de lunes a sábado de 6:00 a 22:00 (hora Argentina), una vez por hora en
// punto (server/services/refresh-scheduler.js). Si pasó más que eso sin que
// se actualicen — sin licencias de Copernico, caída, etc. — se enciende un
// badge "!" sobre la ruedita de configuración para que el usuario reintente.
//
// "Más de 1 hora" se mide contra la ÚLTIMA corrida que el scheduler debió
// hacer, no contra "hace 60 min" a secas: de noche y los domingos no hay
// corridas, y no tiene sentido avisar que está "vieja" a las 23:00 si la de
// las 22:00 salió bien.

import { fetchStatus } from '/shared/js/db-refresh.js';

// Argentina no tiene horario de verano: UTC-3 fijo todo el año.
const AR_OFFSET_MS = -3 * 60 * 60 * 1000;
const START_HOUR = 6;
const END_HOUR = 22;
const HOUR_MS = 60 * 60 * 1000;
// Una corrida real tarda 1-2 min (más con Coordenadas/Variables): sin este
// margen, el badge parpadearía unos minutos cada hora, en plena actualización.
const GRACE_MS = 10 * 60 * 1000;
// Fuentes que el scheduler refresca solo (ver AUTO_SOURCE_KEYS).
const AUTO_KEYS = ['referencia', 'coordenadas', 'variables'];

// Último horario programado (Date) a `now` o antes, o null si no hay en los últimos 8 días.
export function lastScheduledSlot(now = new Date()) {
  const shifted = new Date(now.getTime() + AR_OFFSET_MS); // getUTC* = hora de Argentina
  shifted.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    const day = shifted.getUTCDay(); // 0 = domingo
    const hour = shifted.getUTCHours();
    if (day !== 0 && hour >= START_HOUR && hour <= END_HOUR) {
      return new Date(shifted.getTime() - AR_OFFSET_MS);
    }
    shifted.setTime(shifted.getTime() - HOUR_MS);
  }
  return null;
}

export function isStale(lastUpdatedList, now = new Date()) {
  const slot = lastScheduledSlot(now);
  if (!slot) return false;
  if (now.getTime() < slot.getTime() + GRACE_MS) return false; // la corrida de este horario todavía puede estar en curso
  return lastUpdatedList.some((iso) => !iso || new Date(iso).getTime() < slot.getTime());
}

// Requiere el permiso 'basesdatos' (la ruta lo exige). Ante cualquier error
// (sin conexión, etc.) no avisa: un badge falso es peor que ninguno.
export async function checkDbStale() {
  try {
    const data = await fetchStatus();
    if (data.running) return false; // ya se está actualizando
    const list = AUTO_KEYS.map((k) => data.sources?.[k]?.lastUpdatedAt ?? null);
    return isStale(list);
  } catch {
    return false;
  }
}
