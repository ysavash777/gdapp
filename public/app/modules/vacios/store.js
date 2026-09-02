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

// Directorio completo de Copernico por nombre — para elegir el
// contador (no requiere que tenga la extensión abierta).
export async function buscarContadores(q) {
  const { empleados } = await apiFetch(`/api/vacios/empleados?q=${encodeURIComponent(q)}`);
  return empleados;
}

// records: [{ codigo, ubicacion }]. Devuelve originClientId para
// poder consultar el resultado (obtenerResultado) hasta que la
// extensión termine de procesarlo.
export async function programarConteo(records, targetIdEmpleado, contadorIdEmpleado) {
  const { originClientId } = await apiFetch('/api/vacios/programar', {
    method: 'POST',
    body: { records, targetIdEmpleado, contadorIdEmpleado },
  });
  return originClientId;
}

// null mientras la extensión todavía no procesó el job.
export async function obtenerResultado(originClientId) {
  const { resultado } = await apiFetch(`/api/vacios/resultado?originClientId=${encodeURIComponent(originClientId)}`);
  return resultado;
}
