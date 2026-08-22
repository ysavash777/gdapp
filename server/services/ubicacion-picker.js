/* ============================================================
   Elige la mejor ubicación de un código dentro de Referencia (ver
   store/inventory.store.js), para el detalle XLSX de Mapear cuando el
   operario prende "Incluir ubicación" (ver editor-view.js).

   Criterio pedido: preferir "almacenamiento" sobre "picking" — nunca
   "aduana" (no es un lugar real donde ir a buscar el producto), ni
   las ubicaciones "de paso"/no físicas (en_recibo, en_proceso,
   recupero, diferencias) ni los BIN* o Z* (posiciones temporales o de
   zonificación, no una ubicación real donde retirar mercadería). Si
   después de filtrar no queda ninguna fila con stock, "Sin stock".

   La columna de categoría en Referencia es "agrupacion" — sus valores
   reales (ALMACENAMIENTO / PICKING / ADUANA / MERMA / RECIBO /
   PROCESO) coinciden uno a uno con lo que acá se pide filtrar; es la
   que el pedido original nombra como "área".
   ============================================================ */

const AREA_COLUMN = 'agrupacion';
const EXCLUDED_AREA = 'aduana';
// Substring, no igualdad exacta: los datos reales traen variantes
// ("RECIBO_47" en vez de "en_recibo") — contains cubre ambas sin
// depender de que el nombre exacto no cambie nunca.
const EXCLUDED_UBICACION_SUBSTR = ['en_recibo', 'recibo', 'en_proceso', 'proceso', 'recupero', 'diferencias'];
const EXCLUDED_UBICACION_PREFIX = ['bin', 'z'];
const SIN_STOCK = 'Sin stock';

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function isValidRow(row) {
  const area = norm(row[AREA_COLUMN]);
  if (area === EXCLUDED_AREA) return false;
  const ubicacion = norm(row.ubicacion);
  if (!ubicacion) return false;
  if (EXCLUDED_UBICACION_SUBSTR.some((s) => ubicacion.includes(s))) return false;
  if (EXCLUDED_UBICACION_PREFIX.some((p) => ubicacion.startsWith(p))) return false;
  return (parseFloat(row.saldo) || 0) > 0;
}

// Entre varias filas del mismo área, la de más saldo — mejor apuesta
// de encontrar stock de verdad ahí.
function bestByArea(rows, area) {
  const matches = rows.filter((r) => norm(r[AREA_COLUMN]) === area);
  if (!matches.length) return null;
  matches.sort((a, b) => (parseFloat(b.saldo) || 0) - (parseFloat(a.saldo) || 0));
  return matches[0];
}

// `referenciaRows`: TODAS las filas de Referencia para un código (ver
// inventory.store.js#findAllByReferencia) — puede ser [] si el código
// no existe ahí.
function pickUbicacion(referenciaRows) {
  const valid = referenciaRows.filter(isValidRow);
  if (!valid.length) return SIN_STOCK;
  const almacenamiento = bestByArea(valid, 'almacenamiento');
  if (almacenamiento) return almacenamiento.ubicacion;
  const picking = bestByArea(valid, 'picking');
  if (picking) return picking.ubicacion;
  return SIN_STOCK;
}

module.exports = { pickUbicacion, SIN_STOCK };
