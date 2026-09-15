/**
 * 05_Dedup.gs — transaction identity and duplicate detection.
 *
 * Two separate mechanisms, deliberately not conflated:
 *
 *   HARD identity (makeTransactionId_) decides whether this is literally a row
 *   we already have. A collision means skip, silently and safely.
 *
 *   SOFT suspicion (softDuplicateCheck_) notices that a NEW, distinct alert
 *   looks a lot like a recent one. It never suppresses anything; it raises a
 *   Review Queue entry for a human.
 *
 * Collapsing these two would fail the Orig §17 test that two legitimate
 * same-amount same-day purchases must both survive: they are genuinely
 * different emails with different Gmail IDs, so hard identity keeps them apart,
 * and only the soft check flags the coincidence.
 */

/** Tier 1: a bank reference / UTR is the strongest identity available. */
function idFromReference_(accountId, reference) {
  return accountId + ':REF:' + String(reference).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Tier 2: the Gmail message ID, scoped to the account it was attributed to. */
function idFromMessage_(accountId, gmailId) {
  return accountId + ':MSG:' + gmailId;
}

/** Tier 3: content fingerprint, for any future source that has neither of the above. */
function idFromFingerprint_(accountId, txn) {
  var d = Utilities.formatDate(txn.date, ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata', 'yyyyMMdd');
  var cents = Math.round(Number(txn.amount) * 100);
  var slug = String(txn.merchant).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  return accountId + ':FP:' + d + ':' + cents + ':' + slug + ':' + txn.direction;
}

/**
 * Tiered identity per Orig §9. Reference first because it survives the same
 * alert being re-delivered as a different Gmail message; message ID second
 * because within Gmail ingestion it is always present and always stable.
 */
function makeTransactionId_(accountId, txn, gmailId) {
  if (txn.reference && String(txn.reference).replace(/[^A-Za-z0-9]/g, '').length >= 6) {
    return { id: idFromReference_(accountId, txn.reference), tier: 'reference' };
  }
  if (gmailId) {
    return { id: idFromMessage_(accountId, gmailId), tier: 'message' };
  }
  return { id: idFromFingerprint_(accountId, txn), tier: 'fingerprint' };
}

/**
 * Builds an in-memory index of the existing ledger plus the review queue.
 * One read per run; everything downstream is O(1) against it.
 */
function buildLedgerIndex_() {
  var idx = {
    txnIds: {},
    emailIds: {},
    reviewEmailIds: {},
    recent: []   // [{ account, signed, dateMs, merchant, txnId, status }]
  };

  var rows = readRows_(TAB.TRANSACTIONS);
  var cId   = colOrThrow_(TAB.TRANSACTIONS, 'Transaction ID');
  var cMail = colOrThrow_(TAB.TRANSACTIONS, 'Source Email ID');
  var cAcct = colOrThrow_(TAB.TRANSACTIONS, 'Account');
  var cAmt  = colOrThrow_(TAB.TRANSACTIONS, 'Amount');
  var cDate = colOrThrow_(TAB.TRANSACTIONS, 'Date');
  var cMerch = colOrThrow_(TAB.TRANSACTIONS, 'Merchant');
  var cType = colOrThrow_(TAB.TRANSACTIONS, 'Transaction Type');
  var cStat = colOrThrow_(TAB.TRANSACTIONS, 'Status');

  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][cId]).trim();
    if (id) idx.txnIds[id] = true;

    var mail = String(rows[i][cMail]).trim();
    if (mail) idx.emailIds[mail] = true;

    var dv = rows[i][cDate];
    var dms = (dv instanceof Date) ? dv.getTime() : Date.parse(dv);
    if (!isNaN(dms)) {
      idx.recent.push({
        account:  String(rows[i][cAcct]).trim(),
        signed:   signedAmount_(Number(rows[i][cAmt]), String(rows[i][cType]).trim()),
        amount:   Math.abs(Number(rows[i][cAmt])),
        dateMs:   dms,
        merchant: String(rows[i][cMerch]).trim(),
        type:     String(rows[i][cType]).trim(),
        status:   String(rows[i][cStat]).trim(),
        txnId:    id,
        row:      i + (HEADER_ROW[TAB.TRANSACTIONS] || 1) + 1
      });
    }
  }

  // Messages already sitting in the review queue must not be re-queued on the
  // next run — that is what makes Step 5's "zero new review entries" gate hold.
  try {
    var rq = readRows_(TAB.REVIEW_QUEUE);
    var rqMail = col_(TAB.REVIEW_QUEUE, 'Source Email ID');
    var rqReason = col_(TAB.REVIEW_QUEUE, 'Review Reason');
    if (rqMail >= 0) {
      for (var j = 0; j < rq.length; j++) {
        var m2 = String(rq[j][rqMail]).trim();
        if (!m2) continue;
        // Keyed by email AND reason: one message can legitimately raise two
        // different concerns, but must never raise the same one twice.
        var reason2 = rqReason >= 0 ? String(rq[j][rqReason]).trim() : '';
        idx.reviewEmailIds[m2 + '|' + reason2] = true;
      }
    }
  } catch (e) {
    Logger.log('Review Queue index skipped: ' + e.message);
  }

  return idx;
}

/** Spending sign convention: debits positive, money-back negative. */
function signedAmount_(amount, type) {
  var a = Math.abs(Number(amount) || 0);
  if (type === TXN_TYPE.REFUND || type === TXN_TYPE.CREDIT || type === TXN_TYPE.CC_PAYMENT) return -a;
  return a;
}

/**
 * Soft check per Addendum §4.1: same account, same signed amount, within the
 * configured window. Returns the matching prior row or null.
 *
 * Never merges and never discards — the caller decides how to surface it.
 */
function softDuplicateCheck_(idx, candidate, windowDays) {
  var windowMs = Math.max(0, Number(windowDays)) * 86400000;
  var target = signedAmount_(candidate.amount, candidate.type);
  var when = candidate.date.getTime();

  for (var i = 0; i < idx.recent.length; i++) {
    var r = idx.recent[i];
    if (r.account !== candidate.account) continue;
    if (Math.abs(r.signed - target) > 0.005) continue;
    if (Math.abs(r.dateMs - when) > windowMs) continue;
    return r;
  }
  return null;
}

/** Registers a freshly accepted transaction so later items in the same run see it. */
function indexNewTransaction_(idx, txnId, emailId, candidate) {
  idx.txnIds[txnId] = true;
  if (emailId) idx.emailIds[emailId] = true;
  idx.recent.push({
    account:  candidate.account,
    signed:   signedAmount_(candidate.amount, candidate.type),
    amount:   Math.abs(candidate.amount),
    dateMs:   candidate.date.getTime(),
    merchant: candidate.merchant,
    type:     candidate.type,
    status:   candidate.status,
    txnId:    txnId,
    row:      -1
  });
}
