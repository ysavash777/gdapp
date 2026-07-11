/* ============================================================
   Catálogo de permisos (módulos disponibles para asignar).
   Cuando exista base de datos, esto puede venir de una tabla de
   configuración; mientras tanto es la única fuente de verdad.
   ============================================================ */

const CATALOG = [
  { key: 'usuarios', label: 'Usuarios' },
  { key: 'mapeos', label: 'Mapeos' },
  { key: 'basesdatos', label: 'Bases de datos' },
];

module.exports = { CATALOG };
