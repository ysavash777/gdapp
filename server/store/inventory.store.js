// Repositorio de la fuente "Referencia" (server/data/inventory.json).
// Instancia de create-data-source-store.js (lógica genérica).

const store = require('./create-data-source-store')('inventory', 'inventario_cajas');

// A diferencia de findBy() (un solo match), un código de producto puede
// estar en varias filas (una por ubicación/caja) — acá se devuelven todas.
// Usado por ubicacion-picker.js para elegir la mejor ubicación de un código.
function findAllByReferencia(code) {
  const needle = String(code ?? '').trim().toLowerCase();
  if (!needle) return [];
  return store.getRowsForExport().filter((r) => String(r.referencia ?? '').trim().toLowerCase() === needle);
}

module.exports = { ...store, findAllByReferencia };
