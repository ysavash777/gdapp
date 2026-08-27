// Repositorio de "Programación remota" — busca un producto escaneado
// contra "Referencia" (inventory.store.js) para mostrar todas las
// ubicaciones con stock, y arma el "job" que la extensión de Chrome de
// carga masiva consume vía Supabase Realtime para autocompletar
// "Programar Conteo" en Copernico.
//
// Puente con la extensión (tablas en Supabase, ver supabase-client.js):
//   - carga_masiva_sessions: heartbeat de cada empleado con la extensión
//     activa — listSesiones() filtra por "online" (umbral 20s, igual que
//     la extensión).
//   - carga_masiva_jobs: la extensión está suscripta por realtime a los
//     INSERT filtrados por target_id_empleado — insertar acá alcanza
//     para que el conteo se autocomplete del otro lado.

const inventoryStore = require('./inventory.store');
const variablesStore = require('./variables.store');
const { requireClient } = require('../services/supabase-client');

// Sesión sin heartbeat en los últimos 20s = desconectada (mismo umbral
// que la extensión/PWA original).
const SESSION_STALE_MS = 20000;

// El mismo producto puede llegar con variantes de código (UPC-A de 12
// dígitos vs EAN-13 con 0 adelante, ceros a la izquierda recortados) —
// se generan todas las variantes razonables y se buscan juntas.
function buildCodeCandidates(codigoRaw) {
  const trimmed = String(codigoRaw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  const set = new Set([trimmed]);
  if (digits) {
    set.add(digits);
    set.add(digits.replace(/^0+(?=\d)/, '')); // sin ceros a la izquierda
    if (digits.length === 12) set.add(`0${digits}`); // UPC-A -> EAN-13
    if (digits.length === 13 && digits[0] === '0') set.add(digits.slice(1)); // EAN-13 -> UPC-A
    if (digits.length === 11) set.add(`0${digits}`);
  }
  set.delete('');
  return [...set];
}

function toRow(r) {
  return {
    ean: r.ean || null,
    referencia: r.referencia || r.barcode || null,
    descripcion: r.descripcion || null,
    ubicacion: r.ubicacion || null,
    fv: r.fv || null,
    pedprov: String(r.pedprov || '').trim() || null,
    saldo: r.saldo != null && r.saldo !== '' ? Number(r.saldo) : null,
  };
}

function sortByUbicacion(rows) {
  return rows.sort((a, b) => String(a.ubicacion || '').localeCompare(String(b.ubicacion || ''), 'es'));
}

// Todas las ubicaciones con stock del código escaneado — match EXACTO
// contra "referencia" (nunca "contiene": un código que solo aparece
// como substring de otra referencia no es el mismo producto). Las
// variantes de buildCodeCandidates no relajan esto — siguen siendo
// comparaciones exactas, solo contra distintas formas válidas del
// mismo código de barras (UPC-A/EAN-13/ceros a la izquierda).
//
// El código escaneado puede ser un DUN (bulto, ver parseDunCodes en
// variables.store.js) — Referencia (inventario_cajas) no conoce el
// DUN, solo la referencia/EAN de unidad, así que se resuelve primero
// contra Variables. Si no es un DUN conocido, findByCode ya lo intenta
// como referencia directa y no cambia nada.
function buscarProducto(codigoRaw) {
  const dunMatch = variablesStore.findByCode(codigoRaw);
  const resolvedCode = dunMatch?.referencia || codigoRaw;
  const candidates = buildCodeCandidates(resolvedCode);
  if (!candidates.length) return [];
  const wanted = new Set(candidates.map((c) => c.toLowerCase()));

  const all = inventoryStore.getRowsForExport();
  const exact = all.filter((r) => wanted.has(String(r.referencia ?? '').trim().toLowerCase()));
  return sortByUbicacion(exact.map(toRow));
}

// Solo empleados con heartbeat reciente (desconectados no reciben el job).
async function listSesiones() {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('carga_masiva_sessions')
    .select('id_empleado,nombre,modal_open,updated_at')
    .order('nombre', { ascending: true });
  if (error) throw error;

  const now = Date.now();
  return (data || [])
    .filter((s) => now - new Date(s.updated_at).getTime() < SESSION_STALE_MS)
    .map((s) => ({ idEmpleado: s.id_empleado, nombre: s.nombre, modalOpen: !!s.modal_open }));
}

// `records` es [{ codigo, ubicacion }]. Copernico recibe dos listas
// separadas (ubicaciones/articulos, sin emparejar) porque así las espera
// "Nuevo Conteo" — el emparejamiento es solo para la confirmación del
// usuario al armar la lista.
async function programarConteo(records, targetIdEmpleado) {
  if (!Array.isArray(records) || !records.length) throw new Error('EMPTY_RECORDS');
  if (!targetIdEmpleado) throw new Error('MISSING_TARGET');

  // Nunca confiar en un id que mande el cliente: se valida contra la
  // misma lista de sesiones online, para no encolar a nombre de alguien
  // no conectado realmente.
  const sesiones = await listSesiones();
  if (!sesiones.some((s) => String(s.idEmpleado) === String(targetIdEmpleado))) {
    throw new Error('INVALID_TARGET');
  }

  const ubicaciones = [...new Set(records.map((r) => r.ubicacion).filter(Boolean))].join(',');
  const articulos = [...new Set(records.map((r) => r.codigo).filter(Boolean))].join(',');
  if (!ubicaciones || !articulos) throw new Error('EMPTY_RECORDS');

  const supabase = requireClient();
  const { error } = await supabase.from('carga_masiva_jobs').insert({
    ubicaciones,
    articulos,
    target_id_empleado: Number(targetIdEmpleado),
  });
  if (error) throw error;
}

module.exports = { buscarProducto, listSesiones, programarConteo };
