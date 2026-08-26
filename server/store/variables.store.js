// Repositorio de la fuente "Variables" (server/data/variables.json).
// Instancia de create-data-source-store.js; lo único propio es el
// manejo de la columna "dun" (abajo).

const store = require('./create-data-source-store')('variables', 'variables_logisticas');

// "dun" trae varios códigos de bulto separados por ", ", cada uno como
// "CODIGO:MULTIPLO" (ej. "7791905002598:1, 17791905002595:12" = dos
// códigos que escanean al mismo producto, uno la unidad y otro una caja
// de 12). El multiplo nunca se usa, solo se extrae el código.
function parseDunCodes(rawDun) {
  if (!rawDun) return [];
  return String(rawDun)
    .split(',')
    .map((part) => part.trim().split(':')[0].trim())
    .filter(Boolean);
}

// Un código escaneado puede ser la referencia del producto o cualquiera
// de sus códigos de bulto en "dun" (unidad o caja deben reconocer el
// mismo producto).
function findByCode(code) {
  const needle = String(code ?? '').trim().toLowerCase();
  if (!needle) return null;
  return store.getRowsForExport().find((r) => {
    if (String(r.referencia ?? '').trim().toLowerCase() === needle) return true;
    return parseDunCodes(r.dun).some((d) => d.toLowerCase() === needle);
  }) || null;
}

module.exports = { ...store, parseDunCodes, findByCode };
