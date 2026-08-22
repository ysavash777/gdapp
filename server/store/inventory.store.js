/* ============================================================
   Repositorio de la fuente "Referencia" (server/data/inventory.json).
   Instancia de create-data-source-store.js — ver ese archivo para la
   lógica real (genérica, comparte forma con coordenadas.store.js).
   ============================================================ */

const store = require('./create-data-source-store')('inventory', 'inventario_cajas');

// A diferencia de findBy() (un solo match), un mismo código de
// producto vive en VARIAS filas de Referencia — una por cada
// ubicación/caja donde hay stock — así que acá hacen falta todas, no
// la primera que aparezca. Lo usa mapeo-export.js (ver
// services/ubicacion-picker.js) para elegir la mejor ubicación de
// cada código de un mapeo.
function findAllByReferencia(code) {
  const needle = String(code ?? '').trim().toLowerCase();
  if (!needle) return [];
  return store.getRowsForExport().filter((r) => String(r.referencia ?? '').trim().toLowerCase() === needle);
}

module.exports = { ...store, findAllByReferencia };
