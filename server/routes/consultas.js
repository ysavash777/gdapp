/* ============================================================
   API de Consultar grupo — de solo lectura, sin nada que guardar:
   cada escaneo dispara una búsqueda y devuelve una ficha. Exige el
   permiso 'consultas'.

   Al escanear una referencia, se busca en Variables (mismo catálogo
   que usa Mapear) para saber su grupo/familia ("codgrupoprm") y, si
   tiene uno real (ni vacío ni "SIN GRUPO" — ese valor cubre 8000+
   productos en la base real y cruzarlo daría un rango sin sentido),
   se cruza contra Coordenadas: ahí el grupo/familia es la columna
   "tipo_producto" (confirmado con datos reales — los mismos códigos
   BEB1/FMFCCU/DES2/etc. aparecen en ambas fuentes). El front nunca
   recibe la lista completa de ubicaciones de un grupo (puede ser
   1500+ para uno grande): solo el extremo de abajo y el de arriba
   (orden natural, no alfabético puro — ver naturalCompare) para
   mostrar un rango compacto, y una sola ubicación sugerida.

   La "más vacía" se calcula contra Referencia: se cuenta cuántas filas
   (cajas/posiciones ocupadas) tiene cada ubicación candidata ahí — la
   que tiene menos (o ninguna) es la sugerida. No es la cantidad física
   real de espacio libre (eso no está en ninguna fuente conectada),
   es la mejor aproximación disponible con los datos que sí tenemos.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const variablesStore = require('../store/variables.store');
const coordenadasStore = require('../store/coordenadas.store');
const inventoryStore = require('../store/inventory.store');

router.use(requirePermission('consultas'));

// Orden "natural": separa cada ubicación en tramos de letras/números y
// compara los tramos numéricos como número, no como texto — sin esto,
// "E5001" quedaría después de "E50010" en un sort de string plano
// (confirmado con datos reales: dentro de un mismo grupo conviven
// ubicaciones de distinto largo, ej. "FMFCAU" tiene códigos de 10 y
// 11 caracteres).
function naturalCompare(a, b) {
  const ta = String(a).match(/\d+|\D+/g) || [];
  const tb = String(b).match(/\d+|\D+/g) || [];
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const xa = ta[i] ?? '';
    const xb = tb[i] ?? '';
    if (xa === xb) continue;
    const na = Number(xa);
    const nb = Number(xb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return xa < xb ? -1 : 1;
  }
  return 0;
}

// GET /api/consultas/lookup?code=...
router.get('/lookup', (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ ok: false, error: 'EMPTY_CODE' });

    const match = variablesStore.findBy('referencia', code);
    if (!match) return res.json({ ok: true, product: null });

    const grupo = match.codgrupoprm || '';
    const product = {
      description: match.descripcion || '',
      ean: match.productoean || '',
      group: grupo && grupo !== 'SIN GRUPO' ? grupo : '',
      rangeFrom: null,
      rangeTo: null,
      suggestedLocation: null,
    };

    if (product.group) {
      const ubicaciones = [...new Set(
        coordenadasStore.getRowsForExport()
          .filter((r) => r.tipo_producto === product.group)
          .map((r) => r.ubicacion)
          .filter(Boolean)
      )].sort(naturalCompare);

      if (ubicaciones.length) {
        product.rangeFrom = ubicaciones[0];
        product.rangeTo = ubicaciones[ubicaciones.length - 1];

        const occupancy = new Map();
        for (const row of inventoryStore.getRowsForExport()) {
          if (!row.ubicacion) continue;
          occupancy.set(row.ubicacion, (occupancy.get(row.ubicacion) || 0) + 1);
        }
        let best = null;
        for (const u of ubicaciones) {
          const count = occupancy.get(u) || 0;
          if (!best || count < best.count) best = { ubicacion: u, count };
          if (best.count === 0) break; // ya no hay una más vacía posible
        }
        product.suggestedLocation = best.ubicacion;
      }
    }

    res.json({ ok: true, product });
  } catch (e) {
    console.error('[routes/consultas] lookup falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
