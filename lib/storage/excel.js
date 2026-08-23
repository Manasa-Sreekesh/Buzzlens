const ExcelJS = require('exceljs');

// Column keys intentionally match RawItem field names exactly, so
// `dataSheet.addRow(item)` works directly without a mapping step.
const DATA_COLUMNS = [
  { header: 'ID', key: 'id', width: 16 },
  { header: 'Source', key: 'source', width: 10 },
  { header: 'ContentTitle', key: 'contentTitle', width: 42 },
  { header: 'Author', key: 'author', width: 20 },
  { header: 'Text', key: 'text', width: 70 },
  { header: 'Date', key: 'date', width: 24 },
  { header: 'Sentiment', key: 'sentiment', width: 12 },
  { header: 'Theme', key: 'theme', width: 18 },
  { header: 'Engagement', key: 'engagement', width: 12 },
  { header: 'Link', key: 'link', width: 44 },
];

const HEADER_TO_KEY = Object.fromEntries(DATA_COLUMNS.map((c) => [c.header, c.key]));

/**
 * Writes a dataset workbook with a "Data" sheet (raw items) and a
 * "Manifest" sheet (human-readable run summary). Dates are stored as ISO
 * strings, not native Excel date cells, so re-reading is lossless and
 * timezone-safe.
 */
async function writeDatasetWorkbook(filepath, { items, summaryRows }) {
  const workbook = new ExcelJS.Workbook();

  const dataSheet = workbook.addWorksheet('Data');
  dataSheet.columns = DATA_COLUMNS;
  for (const item of items) {
    dataSheet.addRow({ ...item, date: String(item.date) });
  }

  const manifestSheet = workbook.addWorksheet('Manifest');
  manifestSheet.columns = [
    { header: 'Field', key: 'field', width: 26 },
    { header: 'Value', key: 'value', width: 70 },
  ];
  for (const [field, value] of summaryRows) {
    manifestSheet.addRow({ field, value: Array.isArray(value) ? value.join(', ') : String(value) });
  }

  await workbook.xlsx.writeFile(filepath);
}

/**
 * Reads the "Data" sheet of a previously saved dataset back into RawItem[].
 * This is what makes a saved topic reusable across analysis runs without
 * recollecting it.
 */
async function readDatasetItems(filepath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filepath);
  const sheet = workbook.getWorksheet('Data');
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const keysByColumn = {};
  headerRow.eachCell((cell, colNumber) => {
    keysByColumn[colNumber] = HEADER_TO_KEY[cell.value] || String(cell.value);
  });

  const items = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    row.eachCell((cell, colNumber) => {
      const key = keysByColumn[colNumber];
      if (!key) return;
      item[key] = key === 'engagement' ? Number(cell.value) || 0 : cell.value == null ? '' : String(cell.value);
    });
    if (item.id) items.push(item);
  });
  return items;
}

module.exports = { writeDatasetWorkbook, readDatasetItems, DATA_COLUMNS };
