// Catálogo de permisos (módulos asignables por usuario). 'scope'
// distingue módulos del WEB (/desk) de herramientas de la APP (/app).

const CATALOG = [
  { key: 'usuarios', label: 'Usuarios', scope: 'web' },
  { key: 'mapeos', label: 'Mapeos', scope: 'web' },
  { key: 'basesdatos', label: 'Bases de datos', scope: 'web' },
  { key: 'mapear', label: 'Mapear', scope: 'app' },
  { key: 'vencimientos', label: 'Vencimientos', scope: 'app' },
  { key: 'vacios', label: 'Programación remota', scope: 'app' },
  { key: 'consultas', label: 'Consultas', scope: 'app' },
];

module.exports = { CATALOG };
