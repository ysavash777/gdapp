/* ============================================================
   Módulo App · Consultar grupo — capa de datos.

   Todavía no hay conexión a una base de productos real: findProduct
   siempre devuelve null (código no encontrado). Misma forma que
   tendrá el cliente real (async, un solo punto de entrada) — cuando
   exista server/routes/productos.js, solo se reescribe esta función,
   scanner-view.js no cambia.
   ============================================================ */

export async function findProduct(code) {
  return null;
}
