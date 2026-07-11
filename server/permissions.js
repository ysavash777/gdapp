/* ============================================================
   Catálogo de permisos (módulos asignables por usuario).
   'scope' distingue módulos del WEB (/desk) de herramientas de la
   APP (/app) — el frontend de cada shell filtra por su propio scope.
   Cuando exista base de datos, esto puede venir de una tabla de
   configuración; mientras tanto es la única fuente de verdad.
   ============================================================ */

const CATALOG = [
  { key: 'usuarios', label: 'Usuarios', scope: 'web' },
  { key: 'mapeos', label: 'Mapeos', scope: 'web' },
  { key: 'basesdatos', label: 'Bases de datos', scope: 'web' },
  { key: 'mapear', label: 'Mapear', scope: 'app' },
  { key: 'negadas', label: 'Negadas', scope: 'app' },
  { key: 'vacios', label: 'Vacíos', scope: 'app' },
  { key: 'consultas', label: 'Consultas', scope: 'app' },
];

module.exports = { CATALOG };
