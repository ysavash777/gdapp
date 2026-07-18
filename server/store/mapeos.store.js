/* ============================================================
   Repositorio de mapeos — Supabase (tablas `mapeos` + `mapeo_codes`,
   proyecto "bodega-47-inventario"). Antes vivía entero en la memoria
   del NAVEGADOR (public/app/modules/mapear/store.js) — se perdía todo
   al recargar la página o cerrar la pestaña, y cada operario tenía su
   propia copia aislada. Ahora es la única fuente real: el store del
   navegador pasa a ser un cliente de esta API (ver
   server/routes/mapeos.js), sin cambiar la forma de sus funciones.

   `actor` en cada mutación es el username de quien la hizo — lo pasa
   la ruta HTTP desde la sesión autenticada (req.user.username), nunca
   viene del cliente directamente.
   ============================================================ */

const { requireClient } = require('../services/supabase-client');
const inventoryStore = require('./inventory.store');

// Cada mutación de código termina tocando el mapeo (updated_at/by) y
// devolviendo el mapeo completo con sus códigos — mismo patrón que
// tenía el store del navegador, para que list-view.js/editor-view.js
// no tengan que pedir dos cosas separadas.
const CODE_PATCH_KEY_MAP = {
  expiryDate: 'expiry_date',
  roturaResponsible: 'rotura_responsible',
  customReason: 'custom_reason',
};

function rowToCode(row) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    ean: row.ean,
    quantity: row.quantity,
    condition: row.condition,
    expiryDate: row.expiry_date,
    roturaResponsible: row.rotura_responsible,
    customReason: row.custom_reason,
    scannedAt: row.scanned_at,
    touchedAt: row.touched_at,
  };
}

function rowToMapeo(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    codes: (row.mapeo_codes || []).map(rowToCode).sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt)),
  };
}

const SELECT_WITH_CODES = '*, mapeo_codes(*)';

async function list() {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('mapeos')
    .select(SELECT_WITH_CODES)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMapeo);
}

async function get(id) {
  const supabase = requireClient();
  const { data, error } = await supabase.from('mapeos').select(SELECT_WITH_CODES).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToMapeo(data) : null;
}

async function create(actor, title) {
  const supabase = requireClient();
  const trimmed = title && String(title).trim();
  const { data, error } = await supabase
    .from('mapeos')
    .insert({ title: trimmed || null, created_by: actor || null, updated_by: actor || null })
    .select(SELECT_WITH_CODES)
    .single();
  if (error) throw error;
  // El título por defecto usa el id real asignado por Supabase, no un
  // contador propio — se completa en un segundo paso si no vino title.
  if (!trimmed) {
    const { data: renamed, error: renameErr } = await supabase
      .from('mapeos')
      .update({ title: `Mapeo #${data.id}` })
      .eq('id', data.id)
      .select(SELECT_WITH_CODES)
      .single();
    if (renameErr) throw renameErr;
    return rowToMapeo(renamed);
  }
  return rowToMapeo(data);
}

async function rename(id, title, actor) {
  const trimmed = String(title).trim();
  if (!trimmed) {
    const existing = await get(id);
    if (!existing) throw new Error('NOT_FOUND');
    return existing;
  }
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('mapeos')
    .update({ title: trimmed, updated_at: new Date().toISOString(), updated_by: actor || undefined })
    .eq('id', id)
    .select(SELECT_WITH_CODES)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('NOT_FOUND');
  return rowToMapeo(data);
}

async function remove(id) {
  const supabase = requireClient();
  // mapeo_codes cae solo por el ON DELETE CASCADE de la FK.
  await supabase.from('mapeos').delete().eq('id', id);
}

// Cantidad y condición quedan con valores por defecto al escanear —
// se completan después sin frenar el ritmo de un escaneo masivo
// (mismo comportamiento que tenía el store del navegador). Descripción
// y EAN, en cambio, se completan solos en este mismo paso: se busca el
// código escaneado (un EAN-13) contra la columna "referencia" de la
// fuente Referencia (inventory.store, hidratada desde Supabase) — si
// hay match, "descripcion" queda como título del producto y "ean" (el
// código corto interno, no el de barras) se muestra en la ficha de
// registro — si no hay match (código fuera de catálogo o fuente
// vacía), ambos quedan '' y el front los muestra como "sin datos".
async function addCode(mapeoId, rawCode, actor) {
  const supabase = requireClient();
  const code = String(rawCode).trim();
  if (!code) throw new Error('EMPTY_CODE');

  const match = inventoryStore.findBy('referencia', code);
  const description = match?.descripcion || '';
  const ean = match?.ean || '';

  const { error: insErr } = await supabase.from('mapeo_codes').insert({ mapeo_id: mapeoId, code, description, ean });
  if (insErr) throw insErr;

  return touchAndReturn(mapeoId, actor);
}

async function updateCode(mapeoId, codeId, patch, actor) {
  const supabase = requireClient();
  const dbPatch = {};
  for (const key in patch) dbPatch[CODE_PATCH_KEY_MAP[key] || key] = patch[key];
  dbPatch.touched_at = new Date().toISOString();

  const { error, data } = await supabase
    .from('mapeo_codes')
    .update(dbPatch)
    .eq('id', codeId)
    .eq('mapeo_id', mapeoId)
    .select('id');
  if (error) throw error;
  if (!data.length) throw new Error('NOT_FOUND');

  return touchAndReturn(mapeoId, actor);
}

async function removeCode(mapeoId, codeId, actor) {
  const supabase = requireClient();
  await supabase.from('mapeo_codes').delete().eq('id', codeId).eq('mapeo_id', mapeoId);
  return touchAndReturn(mapeoId, actor);
}

async function touchAndReturn(mapeoId, actor) {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('mapeos')
    .update({ updated_at: new Date().toISOString(), updated_by: actor || undefined })
    .eq('id', mapeoId)
    .select(SELECT_WITH_CODES)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('NOT_FOUND');
  return rowToMapeo(data);
}

module.exports = { list, get, create, rename, remove, addCode, updateCode, removeCode };
