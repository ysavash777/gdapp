/* ============================================================
   Repositorio de Vencimientos — cruza la fuente "Referencia"
   (server/store/inventory.store.js, espejo de Copernico) con el
   estado de validación de cada ítem (Supabase, tabla
   `vencimiento_validaciones`) y la configuración de ubicaciones
   excluidas (`vencimiento_settings`).

   A propósito NO usa "gestioninv"/"diasvigenciaz" (columnas de
   Copernico con su propio criterio de vencido/próximo) — se calculan
   los días a vencer acá mismo, a partir de "fv" (fecha de vencimiento,
   formato DD/MM/AAAA), comparada contra HOY: es el criterio propio
   pedido explícitamente, no el de la fuente externa.

   Clave de un ítem: bodega+caja+ean (el mismo UNIQUE natural que ya
   tiene `inventario_cajas` en Supabase, ver services/supabase-sync.js)
   — sobrevive a que Referencia se refresque entera (reemplaza todas
   las filas) siempre que el mismo producto siga en la misma caja.
   ============================================================ */

const inventoryStore = require('./inventory.store');
const { requireClient } = require('../services/supabase-client');

const WINDOW_DAYS = 15; // alcance del módulo: todo lo que venza dentro de esta ventana (o ya vencido)
const RETIRAR_DAYS = 4; // "si el producto tiene 4 días o menos, hay que solicitar retirar"
const DEFAULT_EXCLUDED = ['RECUPERO', 'DIFERENCIAS', 'Z', 'BIN'];

function itemKey(bodega, caja, ean) {
  return `${bodega}|${caja}|${ean}`;
}

// "01/02/2027" -> Date (mediodía local, para que el redondeo de días
// nunca dependa de la hora en que corre el servidor).
function parseFv(fv) {
  const m = String(fv || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), 12);
}

function daysUntil(fv, today) {
  const d = parseFv(fv);
  if (!d) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((d - t) / 86400000);
}

// 'vencido' (días negativos) / 'retirar' (0 a RETIRAR_DAYS) / 'proximo'
// (el resto de la ventana) — las dos primeras comparten la urgencia de
// "solicitar retirar" (isRetirar), separadas solo para el rótulo.
function severityOf(days) {
  if (days < 0) return 'vencido';
  if (days <= RETIRAR_DAYS) return 'retirar';
  return 'proximo';
}

function normalizePrefixes(list) {
  return (Array.isArray(list) ? list : DEFAULT_EXCLUDED)
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean);
}

function isExcludedLocation(ubicacion, prefixes) {
  const up = String(ubicacion || '').trim().toUpperCase();
  if (!up) return false;
  return prefixes.some((p) => up.startsWith(p));
}

// ---- Configuración (ubicaciones excluidas) ----

async function getSettings() {
  const supabase = requireClient();
  const { data, error } = await supabase.from('vencimiento_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return {
    excludedLocations: normalizePrefixes(data?.excluded_locations),
    updatedBy: data?.updated_by || null,
    updatedAt: data?.updated_at || null,
  };
}

async function updateSettings(excludedLocations, actor) {
  const supabase = requireClient();
  const cleaned = normalizePrefixes(excludedLocations);
  const { error } = await supabase
    .from('vencimiento_settings')
    .update({ excluded_locations: cleaned, updated_by: actor || null, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
  return { excludedLocations: cleaned };
}

// ---- Validaciones ----

async function getValidationsMap() {
  const supabase = requireClient();
  const { data, error } = await supabase.from('vencimiento_validaciones').select('*');
  if (error) throw error;
  const map = new Map();
  for (const row of data) {
    map.set(itemKey(row.bodega, row.caja, row.ean), {
      motivo: row.motivo,
      motivoDetalle: row.motivo_detalle,
      validatedBy: row.validated_by,
      validatedAt: row.validated_at,
    });
  }
  return map;
}

async function validateItem({ bodega, caja, ean, referencia, ubicacion, descripcion, fv, motivo, motivoDetalle, actor }) {
  if (!bodega || !caja || !ean) throw new Error('MISSING_KEY');
  if (!['ok', 'vencido', 'faltante', 'otro'].includes(motivo)) throw new Error('INVALID_MOTIVO');

  const supabase = requireClient();
  const { error } = await supabase.from('vencimiento_validaciones').upsert({
    bodega, caja, ean,
    referencia: referencia || null,
    ubicacion: ubicacion || null,
    descripcion: descripcion || null,
    fv: fv || null,
    motivo,
    motivo_detalle: motivo === 'otro' ? (motivoDetalle || '').trim() || null : null,
    validated_by: actor || null,
    validated_at: new Date().toISOString(),
  }, { onConflict: 'bodega,caja,ean' });
  if (error) throw error;
}

// Deja un ítem sin validar otra vez (revertir un error de tildado).
async function clearValidation(bodega, caja, ean) {
  const supabase = requireClient();
  const { error } = await supabase.from('vencimiento_validaciones')
    .delete().eq('bodega', bodega).eq('caja', caja).eq('ean', ean);
  if (error) throw error;
}

// ---- Listado combinado ----

// sortBy: 'urgencia' (días ascendente, más urgente primero) o
// 'ubicacion' (A-Z, para el recorrido físico) — en ambos casos el
// criterio secundario es el otro campo, así el orden es siempre
// determinístico.
async function list({ sortBy = 'urgencia' } = {}) {
  const [settings, validations] = await Promise.all([getSettings(), getValidationsMap()]);
  const today = new Date();
  const rows = inventoryStore.getRowsForExport();

  const items = [];
  for (const r of rows) {
    const days = daysUntil(r.fv, today);
    if (days === null || days > WINDOW_DAYS) continue;
    if (isExcludedLocation(r.ubicacion, settings.excludedLocations)) continue;
    if (!r.caja || !r.ean) continue;

    const key = itemKey(r.bodega, r.caja, r.ean);
    const validation = validations.get(key) || null;
    items.push({
      key,
      bodega: r.bodega,
      caja: r.caja,
      ean: r.ean,
      referencia: r.referencia || r.barcode || null,
      ubicacion: r.ubicacion || null,
      descripcion: r.descripcion || null,
      // Copernico manda el saldo como número o como string con ceros de
      // relleno ("144.0000") — Number() lo deja limpio (144, o 144.25 si
      // de verdad hay fracción) para que el front nunca tenga que
      // recortar ceros a mano.
      saldo: r.saldo != null && r.saldo !== '' ? Number(r.saldo) : null,
      unidadmedida: String(r.unidadmedida || '').trim() || null,
      fv: r.fv || null,
      days,
      severity: severityOf(days),
      isRetirar: days <= RETIRAR_DAYS,
      validated: !!validation,
      motivo: validation?.motivo || null,
      motivoDetalle: validation?.motivoDetalle || null,
      validatedBy: validation?.validatedBy || null,
      validatedAt: validation?.validatedAt || null,
    });
  }

  items.sort((a, b) => {
    if (sortBy === 'ubicacion') {
      const cmp = String(a.ubicacion || '').localeCompare(String(b.ubicacion || ''), 'es');
      return cmp !== 0 ? cmp : a.days - b.days;
    }
    return a.days !== b.days ? a.days - b.days : String(a.ubicacion || '').localeCompare(String(b.ubicacion || ''), 'es');
  });

  return { items, excludedLocations: settings.excludedLocations, windowDays: WINDOW_DAYS, retirarDays: RETIRAR_DAYS };
}

module.exports = {
  list,
  validateItem,
  clearValidation,
  getSettings,
  updateSettings,
  itemKey,
  WINDOW_DAYS,
  RETIRAR_DAYS,
};
