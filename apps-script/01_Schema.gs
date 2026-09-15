/**
 * 01_Schema.gs — header-name based column access.
 *
 * Nothing in this project addresses a column by letter or index. Every read and
 * write goes through a header map built from the live sheet, so reordering or
 * inserting a column in the workbook cannot silently corrupt the ledger.
 */

var _sheetCache = {};
var _headerCache = {};

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(tabName) {
  if (_sheetCache[tabName]) return _sheetCache[tabName];
  var sh = ss_().getSheetByName(tabName);
  if (!sh) throw new Error('Tab not found: "' + tabName + '". Check TAB in 00_Config.gs.');
  _sheetCache[tabName] = sh;
  return sh;
}

/** Returns { headerName -> 0-based column index } for a tab. */
function headerMap_(tabName) {
  if (_headerCache[tabName]) return _headerCache[tabName];
  var sh = sheet_(tabName);
  var row = HEADER_ROW[tabName] || 1;
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) throw new Error('Tab "' + tabName + '" has no header row.');
  var headers = sh.getRange(row, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h) map[h.toLowerCase()] = i;
  }
  _headerCache[tabName] = map;
  return map;
}

/** 0-based column index for a header, or -1. Case/whitespace insensitive. */
function col_(tabName, headerName) {
  var map = headerMap_(tabName);
  var idx = map[String(headerName).trim().toLowerCase()];
  return (idx === undefined) ? -1 : idx;
}

function colOrThrow_(tabName, headerName) {
  var i = col_(tabName, headerName);
  if (i < 0) throw new Error('Required column "' + headerName + '" missing from tab "' + tabName + '".');
  return i;
}

/** Reads a whole tab below the header row as an array of arrays. */
function readRows_(tabName) {
  var sh = sheet_(tabName);
  var hr = HEADER_ROW[tabName] || 1;
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow <= hr || lastCol < 1) return [];
  return sh.getRange(hr + 1, 1, lastRow - hr, lastCol).getValues();
}

/**
 * Builds a row array of the correct width for a tab from a {header: value} object.
 * Unknown headers in the object are ignored (so optional columns are free).
 */
function buildRow_(tabName, obj) {
  var sh = sheet_(tabName);
  var width = sh.getLastColumn();
  var row = new Array(width);
  for (var i = 0; i < width; i++) row[i] = '';
  for (var key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    var idx = col_(tabName, key);
    if (idx >= 0 && idx < width) row[idx] = obj[key];
  }
  return row;
}

function appendRow_(tabName, obj) {
  sheet_(tabName).appendRow(buildRow_(tabName, obj));
}

/** Appends many rows in one write. Much faster than appendRow_ in a loop. */
function appendRows_(tabName, objs) {
  if (!objs || !objs.length) return;
  var sh = sheet_(tabName);
  var rows = objs.map(function (o) { return buildRow_(tabName, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Compares SCHEMA against the live workbook. Run this first, and after any
 * manual column change. Returns a report object and also shows it in a dialog
 * when run from the menu.
 */
function verifySchema() {
  var problems = [];
  var notes = [];

  for (var tabName in SCHEMA) {
    if (!SCHEMA.hasOwnProperty(tabName)) continue;
    var sh = ss_().getSheetByName(tabName);
    if (!sh) { problems.push('MISSING TAB: ' + tabName); continue; }

    var map = headerMap_(tabName);
    var expected = SCHEMA[tabName];
    var seen = {};

    for (var i = 0; i < expected.length; i++) {
      var spec = expected[i];
      seen[spec.name.toLowerCase()] = true;
      if (map[spec.name.toLowerCase()] === undefined) {
        if (spec.required) problems.push(tabName + ': required column "' + spec.name + '" NOT FOUND');
        else notes.push(tabName + ': optional column "' + spec.name + '" not found (will be skipped)');
      }
    }
    for (var h in map) {
      if (map.hasOwnProperty(h) && !seen[h]) {
        notes.push(tabName + ': sheet has extra column "' + h + '" (code will not touch it)');
      }
    }
  }

  var ok = problems.length === 0;
  if (ok) {
    PropertiesService.getScriptProperties().setProperty(PROP.SCHEMA_OK, new Date().toISOString());
  } else {
    PropertiesService.getScriptProperties().deleteProperty(PROP.SCHEMA_OK);
  }

  var report = (ok ? 'SCHEMA OK\n' : 'SCHEMA FAILED\n')
    + (problems.length ? '\nProblems (must fix):\n  ' + problems.join('\n  ') + '\n' : '')
    + (notes.length ? '\nNotes (informational):\n  ' + notes.join('\n  ') + '\n' : '');

  Logger.log(report);
  return { ok: ok, problems: problems, notes: notes, report: report };
}

/** Pipeline guard — refuses to run against an unverified workbook. */
function assertSchemaVerified_() {
  var v = verifySchema();
  if (!v.ok) {
    throw new Error('Schema verification failed; refusing to touch the ledger.\n' + v.report);
  }
}
