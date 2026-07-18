/* ============================================================
   Módulo App · Consultar grupo — capa de datos.

   Cliente de /api/consultas/lookup (server/routes/consultas.js):
   busca la referencia escaneada en Variables y, si tiene grupo real,
   cruza contra Coordenadas para traer un rango de ubicaciones y una
   sugerida — todo el cálculo pesado (recorrer miles de filas de
   Coordenadas/Referencia) corre del lado del servidor, esto solo
   pide el resultado ya armado.
   ============================================================ */

import { apiFetch } from '/shared/js/api.js';

export async function findProduct(code) {
  const { product } = await apiFetch(`/api/consultas/lookup?code=${encodeURIComponent(code)}`);
  return product;
}
