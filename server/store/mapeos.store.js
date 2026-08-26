// Repositorio de mapeos — Supabase (tablas `mapeos` + `mapeo_codes`,
// proyecto "bodega-47-inventario"). `actor` en cada mutación es el
// username autenticado (req.user.username), nunca viene del cliente.

const { requireClient } = require('../services/supabase-client');
const variablesStore = require('./variables.store');

// Cada mutación de código devuelve el mapeo completo con sus códigos,
// para que list-view.js/editor-view.js no pidan dos cosas separadas.
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
    grupo: row.grupo,
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
  // Título por defecto usa el id real asignado por Supabase, se completa
  // en un segundo paso si no vino title.
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

// Cantidad y condición quedan con valores por defecto al escanear, para
// no frenar el ritmo de un escaneo masivo. Descripción/EAN/Grupo se
// completan acá mismo vía findByCode() contra la fuente Variables
// (referencia o cualquier código en "dun" — ver parseDunCodes en
// variables.store.js); Variables se usa en vez de Referencia porque
// además trae "codgrupoprm" (grupo/familia). Sin match, quedan '' y el
// front los muestra como "sin datos".
async function addCode(mapeoId, rawCode, actor) {
  const supabase = requireClient();
  const code = String(rawCode).trim();
  if (!code) throw new Error('EMPTY_CODE');

  const match = variablesStore.findByCode(code);
  const description = match?.descripcion || '';
  const ean = match?.productoean || '';
  const grupo = match?.codgrupoprm || '';

  const { error: insErr } = await supabase.from('mapeo_codes').insert({ mapeo_id: mapeoId, code, description, ean, grupo });
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
