/* ============================================================
   Exporta el estado de Vencimientos a XLSX (ExcelJS) — UNA sola hoja
   (pedido explícito, nunca una por estado), ordenada por ubicación
   (mismo criterio que el recorrido físico de la app), con una columna
   "Observación" que resume el resultado: "Pendiente" si todavía no se
   validó, "OK" o el detalle escrito si el motivo fue "Otro", o
   "Faltante" (con la foto de evidencia en su propia columna, como
   link). Mismo criterio visual que services/mapeo-export.js:
   encabezado en negrita con relleno azul, todas las celdas centradas
   y con borde en los cuatro lados.
   ============================================================ */

const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const BORDER_SIDE = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const BORDERS = { top: BORDER_SIDE, left: BORDER_SIDE, bottom: BORDER_SIDE, right: BORDER_SIDE };
const CENTER = { horizontal: 'center', vertical: 'middle' };

function observacionOf(item) {
  if (!item.validated) return 'Pendiente';
  if (item.motivo === 'otro') return item.motivoDetalle || 'Otro';
  if (item.motivo === 'faltante') return 'Faltante';
  return 'OK';
}

const COLUMNS = [
  { header: 'Ubicación', width: 16, value: (i) => i.ubicacion || '' },
  { header: 'Caja', width: 14, value: (i) => i.caja || '' },
  { header: 'Código', width: 18, value: (i) => i.referencia || '' },
  { header: 'Descripción', width: 42, value: (i) => i.descripcion || 'Producto sin descripción' },
  { header: 'Saldo', width: 10, value: (i) => i.saldo ?? '' },
  { header: 'Vence', width: 12, value: (i) => i.fv || '' },
  { header: 'Días', width: 8, value: (i) => i.days },
  { header: 'Observación', width: 30, value: observacionOf },
  { header: 'Foto', width: 34, value: (i) => i.fotoUrl || '' },
  { header: 'Validado por', width: 16, value: (i) => i.validatedBy || '' },
];

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
  wb.creator = 'GStock';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Vencimientos');
  sheet.columns = COLUMNS.map((col) => ({ header: col.header, width: col.width }));
  styleHeaderRow(sheet.getRow(1));

  const sorted = items.slice().sort((a, b) => String(a.ubicacion || '').localeCompare(String(b.ubicacion || ''), 'es'));
  for (const item of sorted) {
    const row = sheet.addRow(COLUMNS.map((col) => col.value(item)));
    styleDataRow(row);
  }

  if (!sorted.length) sheet.addRow(['No hay ítems dentro de la ventana de vencimiento.']);

  return wb;
}

module.exports = { buildWorkbook };
