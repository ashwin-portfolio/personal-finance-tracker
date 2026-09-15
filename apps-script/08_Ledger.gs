/**
 * 08_Ledger.gs — the only two places that write rows to the ledger.
 *
 * Every write is batched: a run does at most one setValues() per tab. Apps
 * Script's per-call overhead is what makes a 100-email run time out, and a
 * partially-written batch is exactly the kind of corruption this project
 * cannot tolerate.
 */

/**
 * Converts a fully-processed candidate into a Transactions row object.
 * Column names that do not exist in the workbook are dropped harmlessly by
 * buildRow_, so an abbreviated Transactions tab still works.
 */
function toTransactionRow_(c) {
  var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata';
  return {
    'Transaction ID':         c.txnId,
    'Date':                   c.date,
    'Time':                   Utilities.formatDate(c.sourceDate || c.date, tz, 'HH:mm:ss'),
    'Account':                c.account,
    'Bank':                   c.bank,
    'Transaction Type':       c.type,
    'Amount':                 signedAmount_(c.amount, c.type),
    'Currency':               c.currency,
    'Merchant':               c.merchant,
    'Category':               c.category,
    'Subcategory':            c.subcategory,
    'Description':            c.description,
    'Reference Number':       c.reference,
    'Source Email ID':        c.emailId,
    'Status':                 c.status,
    'Notes':                  c.notes,
    'Raw Text':               c.raw,
    'Imported At':            new Date(),
    'Last Modified':          new Date(),
    'Excluded From Spending': c.excluded ? true : false
  };
}

function toReviewRow_(r) {
  return {
    'Review ID':       r.reviewId,
    'Date':            r.date || '',
    'Account':         r.account || '',
    'Amount':          (r.amount === undefined || r.amount === null) ? '' : r.amount,
    'Merchant':        r.merchant || '',
    'Review Reason':   r.reason,
    'Source Email ID': r.emailId || '',
    'Raw Text':        (r.raw || '').slice(0, 1500),
    'Detail':          r.detail || '',
    'Status':          'Open',
    'Created At':      new Date()
  };
}

function makeReviewId_(emailId, reason) {
  var slug = String(reason).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6);
  return 'RQ-' + slug + '-' + String(emailId || Utilities.getUuid()).slice(0, 12);
}

/**
 * Writes accepted transactions. In dry-run nothing is written; the rows are
 * logged in the same shape they would have been inserted, so a dry-run log is
 * a faithful preview rather than a different code path.
 */
function insertTransactions_(candidates, dryRun) {
  if (!candidates.length) return 0;
  var rows = candidates.map(toTransactionRow_);

  if (dryRun) {
    Logger.log('[DRY RUN] would insert ' + rows.length + ' transaction(s):');
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      Logger.log('  + ' + c.txnId
        + ' | ' + Utilities.formatDate(c.date, ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd')
        + ' | ' + c.account
        + ' | ' + c.type
        + ' | ' + signedAmount_(c.amount, c.type)
        + ' | ' + c.merchant
        + ' | ' + c.category
        + (c.excluded ? ' | EXCLUDED' : '')
        + (c.notes ? ' | ' + c.notes : ''));
    }
    return rows.length;
  }

  appendRows_(TAB.TRANSACTIONS, rows);
  return rows.length;
}

function queueForReview_(items, dryRun) {
  if (!items.length) return 0;
  var rows = items.map(toReviewRow_);

  if (dryRun) {
    Logger.log('[DRY RUN] would queue ' + rows.length + ' item(s) for review:');
    for (var i = 0; i < items.length; i++) {
      Logger.log('  ? ' + items[i].reason + ' | ' + (items[i].merchant || '(no merchant)')
        + ' | ' + (items[i].emailId || '') + ' | ' + (items[i].detail || ''));
    }
    return rows.length;
  }

  appendRows_(TAB.REVIEW_QUEUE, rows);
  return rows.length;
}

/**
 * Finds a transaction row by Transaction ID. Returns { row, values } or null.
 * Used by the manual-correction workflow in 12_AuditLog.gs.
 */
function findTransactionRow_(txnId) {
  var sh = sheet_(TAB.TRANSACTIONS);
  var hr = HEADER_ROW[TAB.TRANSACTIONS] || 1;
  var cId = colOrThrow_(TAB.TRANSACTIONS, 'Transaction ID');
  var rows = readRows_(TAB.TRANSACTIONS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][cId]).trim() === String(txnId).trim()) {
      return { row: hr + 1 + i, values: rows[i], sheet: sh };
    }
  }
  return null;
}
