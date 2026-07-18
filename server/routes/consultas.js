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
   1500+ para uno grande): se agrupan por "pasillo" (el prefijo sin
   dígitos de cada ubicación, ej. "B" en "B400101" o "MFCA" en
   "MFCA780106" — confirmado con datos reales que un mismo grupo casi
   siempre vive en varios pasillos, ej. BEB1 está repartido en B, C, D
   y E) Y ADEMÁS por nivel (columna "piso": "01"/"1" es Picking, todo
   lo demás es Altura — confirmado con datos reales, ej. el grupo "PM"
   tiene el mismo pasillo repartido en 5 pisos distintos, del 01 al
   05). Mezclar picking y altura en un solo rango por pasillo daría un
   extremo de abajo/de arriba que en los hechos describe estanterías a
   distinta altura, no un rango caminable — por eso cada combinación
   pasillo+nivel manda su propio rango (orden natural, no alfabético
   puro — ver naturalCompare), nunca la lista completa. Más una sola
   ubicación sugerida, con su propio nivel.

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

// El "pasillo" de una ubicación es su prefijo sin dígitos ("B" en
// "B400101", "MFCA" en "MFCA780106") — nunca se asume que todo un
// grupo vive en un solo pasillo contiguo.
function aisleOf(ubicacion) {
  const m = String(ubicacion).match(/^\D+/);
  return m ? m[0] : '';
}

// piso "01"/"1"/"00" (o sin dato) es picking, a nivel de piso — todo
// lo demás (02, 03...) es altura, en la estantería, arriba.
function levelOf(piso) {
  const n = Number(piso);
  return !piso || Number.isNaN(n) || n <= 1 ? 'Picking' : 'Altura';
}

// Un rango por pasillo Y nivel (extremo de abajo/de arriba, orden
// natural) — nunca uno por pasillo a secas: mezclar picking y altura
// daría un rango que en los hechos describe estanterías a distinta
// altura, no algo caminable de punta a punta. `rows` es
// [{ubicacion, piso}, ...], nunca la lista completa de vuelta al front.
function aisleRanges(rows) {
  const byGroup = new Map();
  for (const { ubicacion, piso } of rows) {
    const key = `${aisleOf(ubicacion)}|${levelOf(piso)}`;
    if (!byGroup.has(key)) byGroup.set(key, { aisle: aisleOf(ubicacion), level: levelOf(piso), list: [] });
    byGroup.get(key).list.push(ubicacion);
  }
  return [...byGroup.values()]
    .map(({ aisle, level, list }) => {
      const sorted = list.slice().sort(naturalCompare);
      return { aisle, level, from: sorted[0], to: sorted[sorted.length - 1] };
    })
    .sort((a, b) => naturalCompare(a.aisle, b.aisle) || a.level.localeCompare(b.level));
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
      ranges: [],
      suggestedLocation: null,
      suggestedLevel: null,
    };

    if (product.group) {
      // Una fila por ubicación (nunca duplicada, aunque Coordenadas
      // pueda tener varias filas por posición) — se guarda el piso de
      // cada una porque hace falta para separar picking de altura.
      const candidatesByUbicacion = new Map();
      for (const r of coordenadasStore.getRowsForExport()) {
        if (r.tipo_producto !== product.group || !r.ubicacion) continue;
        if (!candidatesByUbicacion.has(r.ubicacion)) candidatesByUbicacion.set(r.ubicacion, r.piso);
      }
      const candidates = [...candidatesByUbicacion.entries()].map(([ubicacion, piso]) => ({ ubicacion, piso }));

      if (candidates.length) {
        product.ranges = aisleRanges(candidates);

        const occupancy = new Map();
        for (const row of inventoryStore.getRowsForExport()) {
          if (!row.ubicacion) continue;
          occupancy.set(row.ubicacion, (occupancy.get(row.ubicacion) || 0) + 1);
        }
        let best = null;
        for (const c of candidates) {
          const count = occupancy.get(c.ubicacion) || 0;
          if (!best || count < best.count) best = { ...c, count };
          if (best.count === 0) break; // ya no hay una más vacía posible
        }
        product.suggestedLocation = best.ubicacion;
        product.suggestedLevel = levelOf(best.piso);
      }
    }

    res.json({ ok: true, product });
  } catch (e) {
    console.error('[routes/consultas] lookup falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
