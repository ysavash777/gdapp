/* ============================================================
   Orden de ubicaciones del depósito (recorrido físico).

   Estructura: ZONA + MÓDULO + NIVEL + POSICIÓN, ej. REF 015 01 08 =
   "REF0150108" y REF 45 01 08 = "REF450108". El módulo viene a veces con
   cero a la izquierda (015) y a veces sin él (45), así que comparar el
   texto tal cual DESORDENABA: el "0" de REF015 lo mandaba antes que
   REF45, y desde REF45 la sugerencia volvía a saltar a otros módulos.
   Acá el módulo se compara COMO NÚMERO (15 < 45), y después nivel y
   posición.

   Formas reales (de Referencia):
     6 dígitos  B280401      módulo 2 + nivel 2 + pos 2
     7 dígitos  REF0150108   módulo 3 + nivel 2 + pos 2
     8+ dígitos REF04601002  módulo 3 + resto (nivel/pos, mismo largo
                             dentro de un módulo, se compara como texto)
   Lo que no encaja (Z09-1, RECUPERO, EN_PROCESO…) cae a un orden
   "natural" (números dentro del texto como números) y va después.
   ============================================================ */

const SHAPE = /^([A-Za-z_]*?)(\d+)$/;

function parse(ubicacion) {
  const text = String(ubicacion ?? '').trim();
  const m = text.match(SHAPE);
  if (!m || !m[1]) return null; // sin zona o sin dígitos finales: no es de esta forma
  const [, zone, digits] = m;
  let module = digits;
  let rest = '';
  let nivel = null;
  if (digits.length >= 8) {
    module = digits.slice(0, 3);
    rest = digits.slice(3);
    // 8 dígitos: nivel de 2 (REF 046 01 002); 9: nivel de 3 (REF 041 001 001).
    nivel = Number(rest.slice(0, digits.length === 8 ? 2 : 3));
  } else if (digits.length >= 6) {
    module = digits.slice(0, -4);
    rest = digits.slice(-4);
    nivel = Number(rest.slice(0, 2));
  }
  return { zone: zone.toUpperCase(), module: Number(module), rest, nivel };
}

// Piso = NIVEL 1. Todo lo demás (niveles 2+, y lo que no tiene nivel
// reconocible, como RECUPERO) es "altura".
function isPiso(ubicacion) {
  return parse(ubicacion)?.nivel === 1;
}

// Recorrido del depósito: primero todo el piso (alfabético), después la altura
// (alfabético). Es el orden de Sugerido y de la lista "Alfabético".
function compareRecorrido(a, b) {
  const pa = isPiso(a) ? 0 : 1;
  const pb = isPiso(b) ? 0 : 1;
  return pa !== pb ? pa - pb : compareUbicacion(a, b);
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function compareUbicacion(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (pa && pb) {
    if (pa.zone !== pb.zone) return pa.zone < pb.zone ? -1 : 1;
    if (pa.module !== pb.module) return pa.module - pb.module;
    if (pa.rest !== pb.rest) return pa.rest < pb.rest ? -1 : 1;
    return 0;
  }
  if (pa && !pb) return -1; // las "raras" (RECUPERO, Z09-1…) al final
  if (!pa && pb) return 1;
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

module.exports = { compareUbicacion, compareRecorrido, isPiso };
