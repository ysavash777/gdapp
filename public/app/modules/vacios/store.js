// Módulo Programación remota — cliente de /api/vacios.

import { apiFetch } from '/shared/js/api.js';

// Todas las ubicaciones con stock del código (EAN o referencia)
// escaneado/tipeado — el usuario elige una entre estas.
export async function buscarProducto(codigo) {
  const { rows } = await apiFetch(`/api/vacios/lookup?codigo=${encodeURIComponent(codigo)}`);
  return rows;
}

// Empleados con la extensión de carga masiva activa ahora mismo.
export async function listSesiones() {
  const { sesiones } = await apiFetch('/api/vacios/sesiones');
  return sesiones;
}

// records: [{ codigo, ubicacion }]
export async function programarConteo(records, targetIdEmpleado) {
  await apiFetch('/api/vacios/programar', {
    method: 'POST',
    body: { records, targetIdEmpleado },
  });
}
