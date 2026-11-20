/* ============================================================
   Exporta un mapeo a XLSX (ExcelJS) — una hoja por motivo (Rotura,
   Unidades, Vencido, Otro, Sin motivo); cada una con su propio dato
   extra (responsable, vencimiento, texto libre). Se omite la hoja si
   no tiene códigos. Dentro de cada hoja, códigos repetidos se
   consolidan (ver consolidate()) sumando cantidad, solo si también
   coincide el dato extra de esa hoja.

   Columna "Ubicación": no es un dato del mapeo — se resuelve acá
   contra Referencia (ver ubicacion-picker.js), nunca se guarda en Supabase.
   ============================================================ */

const ExcelJS = require('exceljs');
const inventoryStore = require('../store/inventory.store');
const { pickUbicacion, stockCajasDetalle } = require('./ubicacion-picker');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const BORDER_SIDE = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const BORDERS = { top: BORDER_SIDE, left: BORDER_SIDE, bottom: BORDER_SIDE, right: BORDER_SIDE };
const CENTER = { horizontal: 'center', vertical: 'middle' };

const RESPONSABLE_LABEL = { idl: 'IDL', rappi: 'Rappi' };

// Un motivo (o null = "sin motivo todavía") = una hoja, con su columna extra.
const SHEETS = [
  { value: 'rotura', label: 'Rotura', extraHeader: 'Responsable', extraValue: (c) => RESPONSABLE_LABEL[c.roturaResponsible] || '' },
  { value: 'unidades', label: 'Unidades', extraHeader: 'Vencimiento', extraValue: (c) => c.expiryDate || '' },
  { value: 'vencido', label: 'Vencido', extraHeader: 'Responsable', extraValue: (c) => RESPONSABLE_LABEL[c.roturaResponsible] || '' },
  { value: 'otro', label: 'Otro', extraHeader: 'Motivo', extraValue: (c) => c.customReason || '' },
  { value: null, label: 'Sin motivo', extraHeader: null, extraValue: () => '' },
];

const BASE_COLUMNS = [
  { header: 'Código', width: 18, value: (c) => c.code },
  { header: 'Descripción', width: 42, value: (c) => c.description || 'Producto sin descripción' },
  { header: 'EAN', width: 14, value: (c) => c.ean || '' },
  { header: 'Cantidad', width: 10, value: (c) => c.quantity },
];

// Se resuelve acá buscando el código contra Referencia (ver ubicacion-picker.js).
const UBICACION_COLUMN = {
  header: 'Ubicación',
  width: 16,
  value: (c) => pickUbicacion(inventoryStore.findAllByReferencia(c.code)),
};

// Cajas en Recupero/Diferencias (cuentan como "sin stock" en la columna
// Ubicación, pero se detallan acá con su número de caja). Vacía si no hay.
const CAJAS_COLUMN = {
  header: 'Recupero / Diferencias',
  width: 34,
  value: (c) => stockCajasDetalle(inventoryStore.findAllByReferencia(c.code)),
};

// Consolida códigos repetidos dentro de una misma hoja sumando cantidad.
// Clave: código + el mismo dato extra de esa hoja (extraValue) — nunca
// solo el código, para no mezclar filas con vencimiento/responsable
// distinto. No toca los datos originales en Supabase (mapeo.codes).
function consolidate(codes, extraValue) {
  const groups = new Map();
  for (const c of codes) {
    const key = `${c.code}|${extraValue(c)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += Number(c.quantity) || 0;
    } else {
      groups.set(key, { ...c, quantity: Number(c.quantity) || 0 });
    }
  }
  return [...groups.values()];
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = CENTER;
    cell.border = BORDERS;
  });
}

function styleDataRow(row) {
  row.eachCell((cell) => {
    cell.alignment = { ...CENTER, wrapText: true }; // varias cajas = varias líneas en la misma celda
    cell.border = BORDERS;
  });
}

function buildWorkbook(mapeo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GStock';
  wb.created = new Date();

  const baseColumns = [...BASE_COLUMNS, UBICACION_COLUMN, CAJAS_COLUMN];

  for (const sheetDef of SHEETS) {
    const codes = mapeo.codes.filter((c) => (c.condition || null) === sheetDef.value);
    if (!codes.length) continue;

    const columns = sheetDef.extraHeader
      ? [...baseColumns, { header: sheetDef.extraHeader, width: 16, value: sheetDef.extraValue }]
      : baseColumns;

    const sheet = wb.addWorksheet(sheetDef.label);
    sheet.columns = columns.map((col) => ({ header: col.header, width: col.width }));
    styleHeaderRow(sheet.getRow(1));

    for (const c of consolidate(codes, sheetDef.extraValue)) {
      const row = sheet.addRow(columns.map((col) => col.value(c)));
      styleDataRow(row);
    }
  }

  // ExcelJS no genera un archivo válido sin al menos una hoja — un
  // mapeo recién creado, sin códigos todavía, cae en este caso.
  if (!wb.worksheets.length) {
    const sheet = wb.addWorksheet('Sin datos');
    sheet.addRow(['Este mapeo no tiene códigos escaneados.']);
  }

  return wb;
}

module.exports = { buildWorkbook };
