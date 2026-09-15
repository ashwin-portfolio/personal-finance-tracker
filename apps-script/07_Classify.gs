/**
 * 07_Classify.gs — transaction type, spending exclusion, and refund linking.
 *
 * This is Step 11 of the PRP and it is genuinely the last thing to trust,
 * because a refund rule cannot be tested without a real prior purchase sitting
 * in the ledger. Everything here is written to degrade into a Review Queue
 * entry rather than into a confident wrong answer.
 *
 * Sign convention (see signedAmount_ in 05_Dedup.gs): debits are positive,
 * money coming back is negative. Exclusion from spending is a separate flag —
 * a CC payment is negative AND excluded, because netting it into spend would
 * make paying your bill look like earning money.
 */

/** Credits on a card that are the cardholder paying the bill, not a merchant refund. */
var CC_PAYMENT_HINTS = [
  /payment\s+(?:of\s+)?(?:rs\.?|inr)?[\s0-9,.]*\s*(?:has been\s+)?received/i,
  /thank you for your payment/i,
  /payment\s+received\s+towards/i,
  /we have received your payment/i,
  /bill\s+payment\s+(?:received|successful)/i
];

/** Credits that are a merchant returning money for a prior purchase. */
var REFUND_HINTS = [
  /\brefund(?:ed)?\b/i,
  /\breversal\b/i,
  /\breversed\b/i,
  /\bchargeback\b/i,
  /credit\s+for\s+(?:the\s+)?(?:cancelled|returned)/i
];

/** Movements between the person's own accounts — never spending in either direction. */
var SELF_TRANSFER_HINTS = [
  /\bself\s*transfer\b/i,
  /transfer\s+to\s+(?:your\s+)?own\s+account/i,
  /\bown\s+account\s+transfer\b/i
];

/**
 * Decides Transaction Type and whether the row counts toward spending.
 *
 * Returns:
 *   { type, excluded, note, reviewReason }
 * reviewReason is non-empty only when the classification is genuinely
 * ambiguous and a human should look — never as a way of avoiding a decision
 * the rules can make.
 */
function classifyTransaction_(txn, account, selfTransferVpas) {
  var text = txn.raw || '';
  var merchantUpper = String(txn.merchant || '').toUpperCase();

  // Self-transfer is checked first: it outranks direction entirely, because the
  // same movement produces a debit alert on one account and a credit on the other.
  if (matchesAny_(text, SELF_TRANSFER_HINTS) || isKnownSelfVpa_(txn.merchant, selfTransferVpas)) {
    return {
      type: TXN_TYPE.SELF_TRANSFER,
      excluded: true,
      note: 'Excluded from spending. Pair manually with the opposite entry on the other account.',
      reviewReason: ''
    };
  }

  if (txn.direction === 'debit') {
    return { type: TXN_TYPE.DEBIT, excluded: false, note: '', reviewReason: '' };
  }

  // From here down every case is a credit.

  if (matchesAny_(text, CC_PAYMENT_HINTS)) {
    // Orig §10: a card bill payment is a repayment on the card side, not income
    // and not negative spending. It must not touch the spending total at all.
    return {
      type: TXN_TYPE.CC_PAYMENT,
      excluded: true,
      note: 'Card repayment received. Excluded from spending on both sides.',
      reviewReason: ''
    };
  }

  if (matchesAny_(text, REFUND_HINTS)) {
    return { type: TXN_TYPE.REFUND, excluded: false, note: '', reviewReason: '' };
  }

  // A credit that is neither a recognised bill payment nor a recognised refund.
  // Guessing here is how a card repayment silently becomes negative spending,
  // so this goes to a human instead.
  return {
    type: TXN_TYPE.CREDIT,
    excluded: true,
    note: 'Unrecognised credit. Excluded from spending until classified.',
    reviewReason: REVIEW_REASON.AMBIGUOUS_TYPE
  };
}

function matchesAny_(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) return true;
  }
  return false;
}

/**
 * Reads the optional "Self Transfer VPAs" setting — a comma-separated list of
 * the person's own UPI handles / account nicknames.
 */
function selfTransferVpas_() {
  var raw = getSettingString_('Self Transfer VPAs', '');
  if (!raw) return [];
  return raw.split(/[,;]/).map(function (s) { return s.trim().toUpperCase(); })
            .filter(function (s) { return s.length > 0; });
}

function isKnownSelfVpa_(merchant, list) {
  if (!list || !list.length) return false;
  var m = String(merchant || '').toUpperCase();
  for (var i = 0; i < list.length; i++) {
    if (m.indexOf(list[i]) !== -1) return true;
  }
  return false;
}

/**
 * Attempts to link a refund to the purchase it reverses: same account, same
 * absolute amount, a prior debit, inside the refund match window.
 *
 * Addendum §4.4: when no match is found the refund is NOT held back. It still
 * reduces spend in the month the credit actually arrives — which is the month
 * the money is really available — and is flagged for manual linking. Holding it
 * would understate what is safe to spend, which is the dangerous direction to
 * be wrong in.
 *
 * Returns { matched:boolean, txnId:string, note:string }.
 */
function linkRefund_(idx, candidate) {
  var windowDays = getSettingNumber_('Refund Match Window (days)', 45);
  var windowMs = windowDays * 86400000;
  var when = candidate.date.getTime();
  var amt = Math.abs(candidate.amount);

  var best = null;
  for (var i = 0; i < idx.recent.length; i++) {
    var r = idx.recent[i];
    if (r.account !== candidate.account) continue;
    if (r.type !== TXN_TYPE.DEBIT) continue;
    if (Math.abs(r.amount - amt) > 0.005) continue;
    var gap = when - r.dateMs;
    if (gap < 0 || gap > windowMs) continue;
    if (!best || r.dateMs > best.dateMs) best = r;   // nearest prior purchase
  }

  if (best) {
    return {
      matched: true,
      txnId: best.txnId,
      note: 'Refund linked to ' + best.txnId + ' (' + best.merchant + ').'
    };
  }
  return {
    matched: false,
    txnId: '',
    note: 'Refund not matched to a prior purchase within ' + windowDays
        + ' days. Counted against spend in the month it arrived; link manually if it belongs elsewhere.'
  };
}
