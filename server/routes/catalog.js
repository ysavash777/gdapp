/* ============================================================
   API de catálogo liviano — existencia de producto (referencia,
   descripcion, ean) para que Mapear y Consultar grupo puedan validar
   un código escaneado ANTES de abrir cualquier ventana, sin ir a la
   red por cada escaneo. Fuente: Variables (mismo catálogo que ya usa
   Mapear en /api/mapeos/lookup-catalog, pero sin "grupo": ese dato
   solo lo necesita el autocompletado de Mapear, no la validación de
   existencia). Cualquier usuario autenticado puede pedirlo — no es
   dato sensible ni exclusivo de una herramienta puntual, así que no
   exige un permiso de módulo específico (a diferencia de /api/mapeos
   y /api/consultas).
   Sin requireAuth a propósito: lo consume también Consultar grupo
   (app/modules/consultas), que es de acceso libre sin cuenta (ver
   PUBLIC_TOOLS en app/app.js y el mismo criterio en routes/consultas.js)
   — si esta ruta exigiera sesión, un usuario sin cuenta escaneando en
   Consultar grupo se hubiera quedado sin poder validar existencia
   contra nada (mapear/lookup-catalog.js, que sí exige sesión, sigue
   aparte porque solo lo usa Mapear, que nunca es de acceso libre).
   ============================================================ */

const express = require('express');
const router = express.Router();
const variablesStore = require('../store/variables.store');

// GET /api/catalog/lookup — arrays en vez de objetos: con 14000+
// filas, no repetir las claves por fila ahorra buena parte del
// payload (mismo criterio que /api/mapeos/lookup-catalog).
router.get('/lookup', (_req, res) => {
  try {
    const items = variablesStore.getRowsForExport()
      .filter((r) => r.referencia)
      .map((r) => [r.referencia, r.descripcion || '', r.productoean || '']);
    res.json({ ok: true, items });
  } catch (e) {
    console.error('[routes/catalog] lookup falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
