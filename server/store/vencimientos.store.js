// Repositorio de Vencimientos — cruza la fuente "Referencia"
// (inventory.store.js) con el estado de validación de cada ítem
// (Supabase, tabla `vencimiento_validaciones`) y la config de
// ubicaciones excluidas (`vencimiento_settings`).
//
// A propósito NO usa "gestioninv"/"diasvigenciaz" (columnas de Copernico
// con su propio criterio) — los días a vencer se calculan acá a partir
// de "fv" (DD/MM/AAAA) vs HOY, con criterio propio.
//
// Clave de un ítem: bodega+caja+ean (mismo UNIQUE natural que
// `inventario_cajas` en Supabase) — sobrevive a que Referencia se
// refresque entera, mientras el producto siga en la misma caja.

const inventoryStore = require('./inventory.store');
const { compareRecorrido, isPiso } = require('../services/ubicacion-sort');
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

async function fetchValidationRows() {
  const supabase = requireClient();
  const { data, error } = await supabase.from('vencimiento_validaciones').select('*');
  if (error) throw error;
  return data;
}

// Sube la foto obligatoria de un ítem "faltante" (data URL base64) al
// bucket público 'vencimiento-fotos' y devuelve su URL pública.
async function uploadPhoto(fotoBase64, key) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(fotoBase64 || '');
  if (!match) throw new Error('INVALID_PHOTO');
  const [, mime, b64] = match;
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const buffer = Buffer.from(b64, 'base64');
  const path = `${key.replace(/\|/g, '-')}-${Date.now()}.${ext}`;

  const supabase = requireClient();
  const { error } = await supabase.storage.from('vencimiento-fotos').upload(path, buffer, { contentType: mime, upsert: true });
  if (error) throw error;
  return supabase.storage.from('vencimiento-fotos').getPublicUrl(path).data.publicUrl;
}

// saldo/pedprov/unidadmedida se CONGELAN acá tal como estaban al validar
// — nunca más se releen de Referencia para este ítem (ver
// buildCombinedItems): si luego cambia de caja/ubicación o desaparece de
// esa fuente, la validación sigue mostrando los datos reales de cuando
// se hizo, en vez de perderlos.
async function validateItem({ bodega, caja, ean, referencia, ubicacion, descripcion, fv, saldo, pedprov, unidadmedida, motivo, motivoDetalle, fotoBase64, actor }) {
  if (!bodega || !caja || !ean) throw new Error('MISSING_KEY');
  if (!['ok', 'faltante', 'otro'].includes(motivo)) throw new Error('INVALID_MOTIVO');
  // Un ítem "faltante" exige evidencia — sin esto, "faltante" sería tan
  // fácil de tildar como "ok" y perdería todo el sentido de auditoría.
  if (motivo === 'faltante' && !fotoBase64) throw new Error('PHOTO_REQUIRED');

  const fotoUrl = motivo === 'faltante' ? await uploadPhoto(fotoBase64, itemKey(bodega, caja, ean)) : null;

  const supabase = requireClient();
  const { error } = await supabase.from('vencimiento_validaciones').upsert({
    bodega, caja, ean,
    referencia: referencia || null,
    ubicacion: ubicacion || null,
    descripcion: descripcion || null,
    fv: fv || null,
    saldo: saldo != null && saldo !== '' ? Number(saldo) : null,
    pedprov: pedprov || null,
    unidadmedida: unidadmedida || null,
    motivo,
    motivo_detalle: (motivoDetalle || '').trim() || null,
    foto_url: fotoUrl,
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

// Vacía TODAS las validaciones (usado por vencimiento-reset-scheduler.js
// a las 00:00) — lo validado es un estado del día, no algo que deba
// arrastrarse. `.gte('id', 0)` matchea cualquier fila (id es bigint
// autoincremental) sin depender de una columna de negocio.
async function resetValidations() {
  const supabase = requireClient();
  const { error } = await supabase.from('vencimiento_validaciones').delete().gte('id', 0);
  if (error) throw error;
}

// Edita SOLO la observación de un ítem ya validado — a diferencia de
// validateItem(), no toca motivo, foto ni otro dato. Si el ítem no está
// validado, no hace nada (no crea una validación a medias).
async function updateMotivoDetalle(bodega, caja, ean, motivoDetalle) {
  const supabase = requireClient();
  const { error } = await supabase.from('vencimiento_validaciones')
    .update({ motivo_detalle: (motivoDetalle || '').trim() || null })
    .eq('bodega', bodega).eq('caja', caja).eq('ean', ean);
  if (error) throw error;
}

// ---- Listado combinado ----

// Única fuente de verdad para Pendiente/Sugerido/Validado (app) y para
// el detalle exportado (services/vencimiento-export.js).
//
// Los VALIDADOS salen ENTEROS de vencimiento_validaciones — todo se
// congeló ahí al validar (ver validateItem), sin rechequear contra
// Referencia. Así, si el producto se mueve de caja/ubicación, la
// ubicación pasa a excluida, o el producto desaparece de esa fuente, la
// validación sigue mostrando los datos reales de cuando se hizo.
//
// Los PENDIENTES no tienen otra fuente que Referencia — se filtran por
// ventana de días y ubicaciones excluidas.
//
// Ordenado por ubicación (recorrido físico del depósito), días como
// criterio secundario.
async function buildCombinedItems() {
  const [validationRows, settings] = await Promise.all([fetchValidationRows(), getSettings()]);
  const today = new Date();
  const referenciaRows = inventoryStore.getRowsForExport();

  const validatedKeys = new Set();
  const items = [];

  for (const row of validationRows) {
    const key = itemKey(row.bodega, row.caja, row.ean);
    validatedKeys.add(key);
    const days = daysUntil(row.fv, today);
    items.push({
      key,
      bodega: row.bodega,
      caja: row.caja,
      ean: row.ean,
      referencia: row.referencia || null,
      ubicacion: row.ubicacion || null,
      descripcion: row.descripcion || null,
      saldo: row.saldo != null ? Number(row.saldo) : null,
      unidadmedida: row.unidadmedida || null,
      pedprov: row.pedprov || null,
      fv: row.fv || null,
      // sector/factura no se congelan al validar: solo sirven para
      // buscar/filtrar pendientes.
      sector: null,
      factura: null,
      days,
      severity: days != null ? severityOf(days) : null,
      isRetirar: days != null ? days <= RETIRAR_DAYS : false,
      validated: true,
      motivo: row.motivo,
      motivoDetalle: row.motivo_detalle,
      fotoUrl: row.foto_url,
      validatedBy: row.validated_by,
      validatedAt: row.validated_at,
    });
  }

  for (const r of referenciaRows) {
    if (!r.caja || !r.ean) continue;
    const key = itemKey(r.bodega, r.caja, r.ean);
    if (validatedKeys.has(key)) continue; // ya está arriba, como validado
    const days = daysUntil(r.fv, today);
    if (days === null || days > WINDOW_DAYS) continue;
    if (isExcludedLocation(r.ubicacion, settings.excludedLocations)) continue;
    items.push({
      key,
      bodega: r.bodega,
      caja: r.caja,
      ean: r.ean,
      referencia: r.referencia || r.barcode || null,
      ubicacion: r.ubicacion || null,
      descripcion: r.descripcion || null,
      // Copernico manda saldo como número o string con ceros de relleno
      // ("144.0000") — Number() lo deja limpio.
      saldo: r.saldo != null && r.saldo !== '' ? Number(r.saldo) : null,
      unidadmedida: String(r.unidadmedida || '').trim() || null,
      pedprov: String(r.pedprov || '').trim() || null,
      fv: r.fv || null,
      // Campos extra solo para buscar/filtrar (list-view.js); Copernico
      // los manda con espacios de relleno.
      sector: String(r.subgrupo || '').trim() || null,
      factura: String(r.factura || '').trim() || null,
      days,
      severity: severityOf(days),
      isRetirar: days <= RETIRAR_DAYS,
      validated: false,
      motivo: null,
      motivoDetalle: null,
      fotoUrl: null,
      validatedBy: null,
      validatedAt: null,
    });
  }

  // isPiso (nivel 1) lo usa la lista para separar piso de altura; el orden
  // es piso primero, después altura, cada una alfabética por ubicación.
  for (const it of items) it.isPiso = isPiso(it.ubicacion);
  items.sort((a, b) => {
    const cmp = compareRecorrido(a.ubicacion, b.ubicacion);
    return cmp !== 0 ? cmp : (a.days ?? 0) - (b.days ?? 0);
  });

  return { items, excludedLocations: settings.excludedLocations };
}

async function list() {
  const { items, excludedLocations } = await buildCombinedItems();
  return { items, excludedLocations, windowDays: WINDOW_DAYS, retirarDays: RETIRAR_DAYS };
}

async function listForExport() {
  const { items } = await buildCombinedItems();
  return items;
}

module.exports = {
  list,
  listForExport,
  validateItem,
  clearValidation,
  resetValidations,
  updateMotivoDetalle,
  getSettings,
  updateSettings,
  itemKey,
  WINDOW_DAYS,
  RETIRAR_DAYS,
};
