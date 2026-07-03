/**
 * sheets.gs — Google Sheets host glue.
 *
 * Read the selected range as TSV, run the task, and write the result down a
 * column from the selection's top-left. Mirrors the Excel path in
 * packages/office/src/host.ts (rangeToText / linesToRows are pure and tested).
 */

/**
 * rangeToText flattens a selected range's 2-D values into TSV: rows joined by
 * newline, cells by tab, null/undefined as empty. Pure.
 */
function rangeToText(values) {
  if (!values || values.length === 0) return '';
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var cells = [];
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      cells.push(v === null || v === undefined ? '' : String(v));
    }
    rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

/**
 * linesToRows turns model output into a 1-column, N-row 2-D array for writing
 * down a column. Trailing blank lines are dropped so a stray newline does not
 * clear a cell. Pure.
 */
function linesToRows(text) {
  var trimmed = String(text).replace(/\n+$/, '');
  var lines = trimmed.split('\n');
  var rows = [];
  for (var i = 0; i < lines.length; i++) rows.push([lines[i]]);
  return rows;
}

/** sheetsContextText returns the active range as TSV — the model's input. */
function sheetsContextText() {
  var range = SpreadsheetApp.getActiveRange();
  if (!range) return '';
  return rangeToText(range.getValues());
}

/**
 * sheetsInsert writes the result down a column from the active cell (a
 * spreadsheet has no "after cursor"): the top-left of the current selection.
 */
function sheetsInsert(text) {
  var sheet = SpreadsheetApp.getActiveSheet();
  var range = SpreadsheetApp.getActiveRange();
  var startRow = range ? range.getRow() : 1;
  var startCol = range ? range.getColumn() : 1;
  var rows = linesToRows(text);
  sheet.getRange(startRow, startCol, rows.length, 1).setValues(rows);
}

// Node-only export for unit tests (inert in Apps Script — no `module` there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rangeToText: rangeToText, linesToRows: linesToRows };
}
