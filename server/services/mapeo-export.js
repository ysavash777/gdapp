/* ============================================================
   Exporta un mapeo a XLSX (ExcelJS) — una hoja por motivo (Rotura,
   Unidades, Vencido, Otro, Sin motivo), nunca una sola hoja con todo
   mezclado: cada motivo tiene su propio dato extra relevante (el
   responsable en Rotura/Vencido, el vencimiento en Unidades, el texto
   libre en Otro) que no tiene sentido en las demás columnas. Una hoja
   se omite por completo si no tiene ningún código (nunca una hoja
   vacía con solo el encabezado).

   Mismo criterio en las cuatro hojas: encabezado en negrita con
   relleno de color, todas las celdas centradas y con biordes en
   los cuatro lados — pedido explícito, no una decisión de estilo
   improvisada.

   Dentro de cada hoja, códigos repetidos se CONSOLIDAN en una sola
   fila sumando la cantidad — ver consolidate() — pero solo si
   coincide también el dato extra propio de esa hoja (vencimiento en
   Unidades, responsable en Rotura/Vencido): comportamiento permanente
   pedido explícitamente, no algo puntual de una corrida.
   ============================================================ */

const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const BORDER_SIDE = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const BORDERS = { top: BORDER_SIDE, left: BORDER_SIDE, bottom: BORDER_SIDE, right: BORDER_SIDE };
const CENTER = { horizontal: 'center', vertical: 'middle' };

const RESPONSABLE_LABEL = { idl: 'IDL', rappi: 'Rappi' };

// Un motivo (o null = "sin motivo todavía") = una hoja, con su propia
// columna extra — nunca todas las columnas posibles en todas las
// hojas, que dejaría casillas vacías sin sentido (ej. "Vencimiento" en
// la hoja de Rotura).
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

// Consolida códigos repetidos DENTRO de una misma hoja (mismo motivo)
// sumando su cantidad — pedido explícito y permanente: "123 rotura x6"
// + "123 rotura x8" en el mismo mapeo pasan a ser una sola fila "123
// rotura x14". La clave de agrupación es código + el MISMO dato extra
// que ya distingue esa hoja (extraValue) — nunca solo el código: dos
// "unidades" del mismo código con vencimiento distinto (o dos
// "rotura"/"vencido" con responsable distinto) NO se mezclan, quedan
// en filas separadas, porque esa diferencia es real y perderla sería
// mentir en el reporte. Nunca toca los datos originales en Supabase
// (mapeo.codes) — la consolidación es solo para este archivo.
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
    cell.alignment = CENTER;
    cell.border = BORDERS;
  });
}

function buildWorkbook(mapeo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDapp';
  wb.created = new Date();

  for (const sheetDef of SHEETS) {
    const codes = mapeo.codes.filter((c) => (c.condition || null) === sheetDef.value);
    if (!codes.length) continue;

    const columns = sheetDef.extraHeader
      ? [...BASE_COLUMNS, { header: sheetDef.extraHeader, width: 16, value: sheetDef.extraValue }]
      : BASE_COLUMNS;

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
