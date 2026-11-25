// API de catálogo liviano: existencia de producto (referencia,
// descripcion, ean) para que Mapear y Consultar grupo validen un
// código escaneado sin ir a la red por cada escaneo. Fuente:
// Variables, sin "grupo" (eso solo lo usa el autocompletado de
// Mapear, ver /api/mapeos/lookup-catalog).
// Sin requireAuth a propósito: Consultar grupo es de acceso libre sin
// cuenta (PUBLIC_TOOLS en app/app.js) y también consume esta ruta.

const express = require('express');
const router = express.Router();
const variablesStore = require('../store/variables.store');

// GET /api/catalog/lookup — arrays en vez de objetos para ahorrar
// payload (14000+ filas). Una fila por referencia y una más por cada
// código "dun" (parseDunCodes en variables.store.js), así
// existsLocal(code) del cliente reconoce también códigos de bulto.
router.get('/lookup', (_req, res) => {
  try {
    const items = [];
    for (const r of variablesStore.getRowsForExport()) {
      if (!r.referencia) continue;
      const row = [r.referencia, r.descripcion || '', r.productoean || ''];
      items.push(row);
      // 4º elemento (solo en filas de DUN): la referencia REAL del producto,
      // para que el cliente muestre siempre la referencia y no el DUN escaneado.
      for (const dunCode of variablesStore.parseDunCodes(r.dun)) {
        if (dunCode && dunCode !== r.referencia) items.push([dunCode, row[1], row[2], r.referencia]);
      }
    }
    // 'no-cache' fuerza revalidar por ETag (no "no cachear"): 304 sin
    // cuerpo si el catálogo no cambió desde la última descarga.
    res.set('Cache-Control', 'no-cache');
    res.json({ ok: true, items });
  } catch (e) {
    console.error('[routes/catalog] lookup falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
