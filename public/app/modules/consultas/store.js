// Cliente de /api/consultas/lookup (server/routes/consultas.js).
// El cálculo pesado corre en el servidor; esto solo pide el resultado armado.

import { apiFetch } from '/shared/js/api.js';

export async function findProduct(code) {
  const { product } = await apiFetch(`/api/consultas/lookup?code=${encodeURIComponent(code)}`);
  return product;
}
