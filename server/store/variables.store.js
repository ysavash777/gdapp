/* ============================================================
   Repositorio de la fuente "Variables" (server/data/variables.json).
   Instancia de create-data-source-store.js — ver ese archivo para la
   lógica real (genérica, comparte forma con inventory.store.js /
   coordenadas.store.js). Lo único propio de Variables es el manejo de
   la columna "dun" (abajo): el resto de los métodos son los genéricos
   de la fábrica, reexportados tal cual.
   ============================================================ */

const store = require('./create-data-source-store')('variables', 'variables_logisticas');

// La columna "dun" trae, en un solo string, TODOS los códigos de
// bulto de un producto (caja, pallet...) además de su unidad — varios,
// separados por ", ", cada uno como "CODIGO:MULTIPLO" (confirmado con
// datos reales, ej. "7791905002598:1, 17791905002595:12": son DOS
// códigos que escanean al MISMO producto — uno la unidad, el otro una
// caja de 12). El ":multiplo" nunca se usa ni se muestra en ningún
// lado — ni acá ni en el cliente (routes/catalog.js, routes/mapeos.js)
// — solo separa el código real, que es lo único que importa para
// reconocer el producto al escanear.
function parseDunCodes(rawDun) {
  if (!rawDun) return [];
  return String(rawDun)
    .split(',')
    .map((part) => part.trim().split(':')[0].trim())
    .filter(Boolean);
}

// Un código escaneado puede ser la referencia del producto o
// cualquiera de sus códigos de bulto en "dun" (un operario puede
// escanear la unidad o la caja indistintamente y tiene que reconocer
// el mismo producto) — reemplaza a findBy('referencia', code) en todo
// lugar donde antes solo se comparaba contra esa columna
// (routes/consultas.js, store/mapeos.store.js).
function findByCode(code) {
  const needle = String(code ?? '').trim().toLowerCase();
  if (!needle) return null;
  return store.getRowsForExport().find((r) => {
    if (String(r.referencia ?? '').trim().toLowerCase() === needle) return true;
    return parseDunCodes(r.dun).some((d) => d.toLowerCase() === needle);
  }) || null;
}

module.exports = { ...store, parseDunCodes, findByCode };
