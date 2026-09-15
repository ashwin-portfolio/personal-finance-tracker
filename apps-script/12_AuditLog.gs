/**
 * 12_AuditLog.gs — deliberate manual corrections with a real before/after record.
 *
 * Why this is a sidebar and not an onEdit trigger:
 *
 * A simple onEdit handler receives e.oldValue only for single-cell edits, and
 * not at all for paste, fill-down, undo, or any programmatic write. Caching a
 * shadow copy of every row to recover the old value is fragile in exactly the
 * situations where an audit trail matters most. So corrections are made through
 * this deliberate path, which reads the current value at the moment of the
 * edit, takes the new one explicitly, and writes both (Addendum §4.7).
 *
 * Direct cell edits in the Transactions tab still work — they are simply not
 * audited. If you want them audited, make them here.
 */

/** Fields a correction may touch. Amount and Date are intentionally absent. */
var CORRECTABLE_FIELDS = [
  'Category',
  'Subcategory',
  'Merchant',
  'Transaction Type',
  'Status',
  'Notes',
  'Excluded From Spending'
];

function showCorrectionSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Correct a transaction');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Called from the sidebar on open. Returns the transaction under the cursor,
 * so the common case is zero typing.
 */
function getCorrectionContext() {
  resetCaches_();
  var sh = ss_().getActiveSheet();
  var ctx = { fields: CORRECTABLE_FIELDS, txnId: '', values: {}, message: '' };

  if (sh.getName() !== TAB.TRANSACTIONS) {
    ctx.message = 'Select a row in the ' + TAB.TRANSACTIONS + ' tab, or paste a Transaction ID below.';
    return ctx;
  }

  var row = ss_().getActiveRange().getRow();
  var hr = HEADER_ROW[TAB.TRANSACTIONS] || 1;
  if (row <= hr) {
    ctx.message = 'That is the header row. Select a transaction row.';
    return ctx;
  }

  var values = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  ctx.txnId = String(values[colOrThrow_(TAB.TRANSACTIONS, 'Transaction ID')]).trim();
  ctx.values = readCorrectableValues_(values);
  ctx.summary = summariseTxnRow_(values);
  return ctx;
}

/** Looks up a transaction by ID, for when the sidebar is used away from the tab. */
function lookupTransaction(txnId) {
  resetCaches_();
  var hit = findTransactionRow_(txnId);
  if (!hit) throw new Error('No transaction found with ID: ' + txnId);
  return {
    fields: CORRECTABLE_FIELDS,
    txnId: String(txnId).trim(),
    values: readCorrectableValues_(hit.values),
    summary: summariseTxnRow_(hit.values),
    message: ''
  };
}

function readCorrectableValues_(values) {
  var out = {};
  for (var i = 0; i < CORRECTABLE_FIELDS.length; i++) {
    var f = CORRECTABLE_FIELDS[i];
    var c = col_(TAB.TRANSACTIONS, f);
    out[f] = (c >= 0) ? String(values[c]) : '(column not present)';
  }
  return out;
}

function summariseTxnRow_(values) {
  function get(name) {
    var c = col_(TAB.TRANSACTIONS, name);
    return c >= 0 ? values[c] : '';
  }
  var d = get('Date');
  var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata';
  return [
    (d instanceof Date) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d),
    get('Account'),
    get('Amount'),
    get('Merchant')
  ].join('  ·  ');
}

/**
 * Applies one correction and records it. Reads the old value immediately before
 * writing, inside the same call, so the audit row cannot drift from reality.
 */
function applyCorrection(payload) {
  resetCaches_();

  var txnId = String(payload.txnId || '').trim();
  var field = String(payload.field || '').trim();
  var newValue = payload.newValue;
  var note = String(payload.note || '').trim();

  if (!txnId) throw new Error('No Transaction ID given.');
  if (CORRECTABLE_FIELDS.indexOf(field) === -1) {
    throw new Error('Field "' + field + '" is not correctable through this workflow.');
  }

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) throw new Error('A sync run is in progress. Try again in a moment.');

  try {
    var hit = findTransactionRow_(txnId);
    if (!hit) throw new Error('No transaction found with ID: ' + txnId);

    var cIdx = colOrThrow_(TAB.TRANSACTIONS, field);
    var oldValue = hit.values[cIdx];

    if (field === 'Excluded From Spending') {
      newValue = (newValue === true || /^(true|yes|y|1)$/i.test(String(newValue).trim()));
    }

    if (String(oldValue) === String(newValue)) {
      return 'No change — "' + field + '" is already ' + JSON.stringify(String(oldValue)) + '.';
    }

    hit.sheet.getRange(hit.row, cIdx + 1).setValue(newValue);

    var cMod = col_(TAB.TRANSACTIONS, 'Last Modified');
    if (cMod >= 0) hit.sheet.getRange(hit.row, cMod + 1).setValue(new Date());

    appendRow_(TAB.AUDIT_LOG, {
      'Timestamp':      new Date(),
      'Transaction ID': txnId,
      'Field':          field,
      'Old Value':      oldValue,
      'New Value':      newValue,
      'Changed By':     safeUserEmail_(),
      'Note':           note
    });

    return 'Updated ' + field + ': ' + JSON.stringify(String(oldValue))
         + ' → ' + JSON.stringify(String(newValue)) + ' (logged to ' + TAB.AUDIT_LOG + ').';
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}

function safeUserEmail_() {
  try { return Session.getActiveUser().getEmail() || '(unknown)'; }
  catch (e) { return '(unknown)'; }
}
