// API de Consultar grupo — solo lectura, cada escaneo busca y devuelve
// una ficha. SIN requireAuth/requirePermission a propósito: en /app es
// la única herramienta pública (PUBLIC_TOOLS en app.js, uso sin
// cuenta desde el depósito); el permiso 'consultas' solo aplica al
// equivalente del desk. (Antes exigía permiso incondicional y
// cualquiera sin sesión recibía 401 acá, viéndose como base caída.)
//
// Flujo: busca el código en Variables (findByCode/parseDunCodes en
// variables.store.js) para obtener el grupo/familia ("codgrupoprm";
// vacío o "SIN GRUPO" no cruza — cubre 8000+ productos y daría un
// rango sin sentido). Cruza contra Coordenadas, donde el grupo es la
// columna "tipo_producto". Nunca se manda al front la lista completa
// de ubicaciones (puede ser 1500+): se agrupan por PASILLO (columna
// "fila_piso", pese al nombre) y NIVEL (columna "piso": 01/1 es
// Picking, cada piso de estantería siguiente es su propio "Nivel N").
// Cada pasillo+nivel manda solo el extremo de abajo/arriba de su
// "módulo" (columna "columna_piso" — su ANCHO varía por pasillo, 2
// dígitos vs 3, por eso se usa la columna directo y no un recorte por
// regex de la ubicación completa, que cortaba mal los módulos de 3
// dígitos). Además hasta dos sugerencias (Picking/Altura).
//
// La "más vacía" se aproxima contando filas ocupadas en Referencia
// por ubicación candidata (no es espacio físico real, es la mejor
// aproximación disponible).

const express = require('express');
const router = express.Router();
const variablesStore = require('../store/variables.store');
const coordenadasStore = require('../store/coordenadas.store');
const inventoryStore = require('../store/inventory.store');

// piso 01/1/00 (o sin dato) es Picking; cada piso siguiente es su
// propio "Nivel N" (nunca una "Altura" genérica que los mezcle).
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

// Un rango por pasillo+nivel (extremos de columna_piso, comparados
// como número porque el ancho varía entre pasillos: 2 dígitos vs 3).
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

    const match = variablesStore.findByCode(code);
    if (!match) return res.json({ ok: true, product: null });

    const grupo = match.codgrupoprm || '';
    const product = {
      // El código escaneado puede ser un DUN (bulto) — se manda la
      // referencia REAL del producto para mostrar, nunca el DUN (que
      // es solo una facilidad de escaneo, no debe verse en la interfaz).
      referencia: match.referencia || '',
      description: match.descripcion || '',
      ean: match.productoean || '',
      group: grupo && grupo !== 'SIN GRUPO' ? grupo : '',
      ranges: [],
      // Máximo dos: una por Picking, una por Altura combinada.
      suggestions: [],
    };

    if (product.group) {
      // Una fila por ubicación, sin duplicar aunque Coordenadas tenga
      // varias filas por posición.
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
            if (best.count === 0) break; // ya no puede haber una más vacía
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
