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
   1500+ para uno grande): se agrupan por PASILLO (columna real
   "fila_piso" — pese al nombre confuso, es el pasillo, ej. "MFCA" o
   "B", no una fila numérica) Y NIVEL (columna "piso": "01"/"1" es
   Picking; cada piso de estantería de ahí en más es SU PROPIO
   "Nivel N", nunca un "Altura" genérico que los mezcle — confirmado
   con datos reales que el grupo "PM" reparte su mismo pasillo en 5
   pisos distintos, cada uno a una altura física real distinta), y
   cada combinación pasillo+nivel manda solo el extremo de abajo y el
   de arriba de su "módulo" (columna real "columna_piso" — el número
   de posición dentro del pasillo). Importante: el ANCHO de
   columna_piso varía por pasillo (2 dígitos para "B"/"PM", 3 para
   "MFCA" — confirmado con datos reales: "089"/"091"/"024") — por eso
   el rango usa esta columna directo, en vez de adivinar cuántos
   dígitos cortar de la ubicación completa por regex (ese enfoque
   anterior cortaba mal los módulos de 3 dígitos, ej. mostraba
   "MFCA09" en vez de "MFCA095"). Nunca la lista completa. Más hasta
   dos ubicaciones sugeridas (Picking/Altura), con la posición
   completa (ubicacion) sin tocar.

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

// piso "01"/"1"/"00" (o sin dato) es picking, a nivel de piso — cada
// piso de estantería (02, 03, 04, 05...) es SU PROPIO nivel, nunca un
// "Altura" genérico que los mezcle a todos: son alturas físicas
// distintas, cada una con su propia escalera/autoelevador.
function levelOf(piso) {
  const n = Number(piso);
  return !piso || Number.isNaN(n) || n <= 1 ? 'Picking' : `Nivel ${n}`;
}

// Picking siempre primero, después Nivel 2, 3, 4... en orden — nunca
// alfabético puro (que pondría "Nivel 10" antes de "Nivel 2").
function levelRank(level) {
  if (level === 'Picking') return 0;
  const n = Number(String(level).replace(/\D+/g, ''));
  return Number.isNaN(n) ? 99 : n;
}

// Un rango por pasillo (fila_piso) Y nivel (extremo de abajo/de
// arriba de columna_piso, comparado como número) — nunca uno por
// pasillo a secas, ni uno por pasillo+altura genérico: dos niveles de
// estantería distintos en el mismo pasillo (ej. Nivel 2 y Nivel 3)
// mandan cada uno su propio rango. `rows` es
// [{fila_piso, columna_piso, piso}, ...], nunca la lista completa de
// vuelta al front — y el ancho de columna_piso puede variar entre
// pasillos (2 dígitos vs 3), por eso se compara como número, nunca
// con un sort de texto plano.
function aisleRanges(rows) {
  const byGroup = new Map();
  for (const { fila_piso, columna_piso, piso } of rows) {
    const level = levelOf(piso);
    const key = `${fila_piso}|${level}`;
    if (!byGroup.has(key)) byGroup.set(key, { aisle: fila_piso, level, columnas: new Set() });
    byGroup.get(key).columnas.add(columna_piso);
  }
  return [...byGroup.values()]
    .map(({ aisle, level, columnas }) => {
      const sorted = [...columnas].sort((a, b) => Number(a) - Number(b));
      return { aisle, level, from: `${aisle}${sorted[0]}`, to: `${aisle}${sorted[sorted.length - 1]}` };
    })
    .sort((a, b) => (a.aisle < b.aisle ? -1 : a.aisle > b.aisle ? 1 : 0) || levelRank(a.level) - levelRank(b.level));
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
      // Dos sugerencias como máximo, una por tipo de nivel (Picking y
      // Altura combinada — no una por cada Nivel N exacto, esta es la
      // versión "gruesa" para decidir rápido si hace falta subir o
      // no) — nunca una sola, porque un producto con ambos tipos de
      // ubicación necesita las dos alternativas, no solo la más vacía
      // de las dos sin importar el tipo.
      suggestions: [],
    };

    if (product.group) {
      // Una fila por ubicación (nunca duplicada, aunque Coordenadas
      // pueda tener varias filas por posición) — se guardan piso,
      // fila_piso y columna_piso de cada una: piso separa picking de
      // altura, fila_piso/columna_piso son el pasillo y el módulo
      // reales (nunca se adivinan cortando la ubicación completa).
      const candidatesByUbicacion = new Map();
      for (const r of coordenadasStore.getRowsForExport()) {
        if (r.tipo_producto !== product.group || !r.ubicacion) continue;
        if (!candidatesByUbicacion.has(r.ubicacion)) {
          candidatesByUbicacion.set(r.ubicacion, { piso: r.piso, fila_piso: r.fila_piso, columna_piso: r.columna_piso });
        }
      }
      const candidates = [...candidatesByUbicacion.entries()].map(([ubicacion, meta]) => ({ ubicacion, ...meta }));

      if (candidates.length) {
        product.ranges = aisleRanges(candidates);

        const occupancy = new Map();
        for (const row of inventoryStore.getRowsForExport()) {
          if (!row.ubicacion) continue;
          occupancy.set(row.ubicacion, (occupancy.get(row.ubicacion) || 0) + 1);
        }

        function bestAmong(filterFn) {
          let best = null;
          for (const c of candidates) {
            if (!filterFn(c)) continue;
            const count = occupancy.get(c.ubicacion) || 0;
            if (!best || count < best.count) best = { ...c, count };
            if (best.count === 0) break; // ya no hay una más vacía posible
          }
          return best;
        }

        const bestPicking = bestAmong((c) => levelOf(c.piso) === 'Picking');
        const bestAltura = bestAmong((c) => levelOf(c.piso) !== 'Picking');
        if (bestPicking) product.suggestions.push({ level: 'Picking', location: bestPicking.ubicacion });
        if (bestAltura) product.suggestions.push({ level: 'Altura', location: bestAltura.ubicacion });
      }
    }

    res.json({ ok: true, product });
  } catch (e) {
    console.error('[routes/consultas] lookup falló:', e.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

module.exports = router;
