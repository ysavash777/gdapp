/* ============================================================
   Exporta el estado de Vencimientos a XLSX (ExcelJS) — mismo criterio
   visual que services/mapeo-export.js: encabezado en negrita con
   relleno azul, todas las celdas centradas y con borde en los cuatro
   lados. Una hoja por estado (Pendiente/OK/Vencido/Faltante/Otro) en
   vez de una sola hoja mezclada — cada fila ya es, por sí sola, un
   ítem (ubicación+caja+código) dentro de la ventana de 15 días, así
   que no hace falta ninguna consolidación (a diferencia de Mapeos,
   acá nunca hay dos filas iguales: la clave bodega+caja+ean ya es
   única en el origen). Una hoja se omite si no tiene ningún ítem.
   ============================================================ */

const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const BORDER_SIDE = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const BORDERS = { top: BORDER_SIDE, left: BORDER_SIDE, bottom: BORDER_SIDE, right: BORDER_SIDE };
const CENTER = { horizontal: 'center', vertical: 'middle' };

function statusOf(item) {
  return item.validated ? item.motivo : 'pendiente';
}

const SHEETS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'ok', label: 'OK' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'faltante', label: 'Faltante' },
  { value: 'otro', label: 'Otro' },
];

const BASE_COLUMNS = [
  { header: 'Ubicación', width: 16, value: (i) => i.ubicacion || '' },
  { header: 'Caja', width: 14, value: (i) => i.caja || '' },
  { header: 'Código', width: 18, value: (i) => i.referencia || '' },
  { header: 'Descripción', width: 42, value: (i) => i.descripcion || 'Producto sin descripción' },
  { header: 'Saldo', width: 10, value: (i) => i.saldo ?? '' },
  { header: 'Vence', width: 12, value: (i) => i.fv || '' },
  { header: 'Días', width: 8, value: (i) => i.days },
];

const VALIDATED_COLUMNS = [
  { header: 'Validado por', width: 16, value: (i) => i.validatedBy || '' },
];

const OTRO_COLUMN = { header: 'Detalle', width: 28, value: (i) => i.motivoDetalle || '' };

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

function buildWorkbook(items) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDapp';
  wb.created = new Date();

  for (const sheetDef of SHEETS) {
    const rows = items.filter((i) => statusOf(i) === sheetDef.value);
    if (!rows.length) continue;

    const columns = [...BASE_COLUMNS];
    if (sheetDef.value === 'otro') columns.push(OTRO_COLUMN);
    if (sheetDef.value !== 'pendiente') columns.push(...VALIDATED_COLUMNS);

    const sheet = wb.addWorksheet(sheetDef.label);
    sheet.columns = columns.map((col) => ({ header: col.header, width: col.width }));
    styleHeaderRow(sheet.getRow(1));

    // Dentro de cada hoja, ordenado por ubicación (mismo criterio que
    // el recorrido físico de la app) — el llamador ya lo hace así,
    // pero se repite acá para que el archivo sea correcto aunque
    // cambie el orden con el que se lo invoque en el futuro.
    const sorted = rows.slice().sort((a, b) => String(a.ubicacion || '').localeCompare(String(b.ubicacion || ''), 'es'));
    for (const item of sorted) {
      const row = sheet.addRow(columns.map((col) => col.value(item)));
      styleDataRow(row);
    }
  }

  if (!wb.worksheets.length) {
    const sheet = wb.addWorksheet('Sin datos');
    sheet.addRow(['No hay ítems dentro de la ventana de vencimiento.']);
  }

  return wb;
}

module.exports = { buildWorkbook };
