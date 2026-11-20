/* ============================================================
   Elige la mejor ubicación de un código dentro de Referencia (ver
   store/inventory.store.js), para el detalle XLSX de Mapear.

   Preferir "almacenamiento" sobre "picking"; excluir "aduana", las
   ubicaciones no físicas (en_recibo, en_proceso, recupero,
   diferencias) y las que empiezan con BIN o Z (temporales o de zonificación). Sin
   ninguna fila válida con stock: "Sin stock". Columna de categoría en
   Referencia: "agrupacion".
   ============================================================ */

const AREA_COLUMN = 'agrupacion';
const EXCLUDED_AREA = 'aduana';
// Substring, no igualdad exacta: los datos reales traen variantes (ej. "RECIBO_47").
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

// Aviso al registrar un código en Mapear (ver editor-view.js): Recupero
// y Diferencias no son inválidas como Aduana/BIN/Z, pero es stock
// "descolocado" que vale la pena marcar. Orden fijo: Recupero primero.
// Cajas del mismo código en la misma ubicación se consolidan sumando saldo.
const ALERT_UBICACIONES = ['recupero', 'diferencias'];

function stockAlerts(referenciaRows) {
  const alerts = [];
  for (const name of ALERT_UBICACIONES) {
    const matches = referenciaRows.filter((r) => norm(r.ubicacion) === name);
    if (!matches.length) continue;
    const qty = matches.reduce((sum, r) => sum + (parseFloat(r.saldo) || 0), 0);
    if (qty <= 0) continue;
    alerts.push({ ubicacion: name.toUpperCase(), qty, unit: String(matches[0].unidadmedida ?? '').trim() });
  }
  return alerts;
}

// Detalle del XLSX: cada caja (una línea por caja, SIN consolidar — hace
// falta el número de caja) que el código tiene en Recupero/Diferencias.
// Esas ubicaciones siguen contando como "sin stock" para elegir la
// ubicación (ver pickUbicacion), pero se listan acá para que no se pierdan.
// Orden fijo: Recupero primero. Texto, ej.: "RECUPERO · Caja 1234 · 5 UN".
function stockCajasDetalle(referenciaRows) {
  const lines = [];
  for (const name of ALERT_UBICACIONES) {
    for (const r of referenciaRows) {
      if (norm(r.ubicacion) !== name) continue;
      const qty = parseFloat(r.saldo) || 0;
      if (qty <= 0) continue;
      const unit = String(r.unidadmedida ?? '').trim();
      const caja = String(r.caja ?? '').trim();
      lines.push(`${name.toUpperCase()} · Caja ${caja || 's/n'} · ${qty}${unit ? ` ${unit}` : ''}`);
    }
  }
  return lines.join('\n');
}

module.exports = { pickUbicacion, stockAlerts, stockCajasDetalle, SIN_STOCK };
