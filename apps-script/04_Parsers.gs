/**
 * 04_Parsers.gs — bank-specific extraction.
 *
 * ############################################################################
 * # STATUS: UNVALIDATED DRAFTS. DO NOT ENABLE WRITES UNTIL STEP 4 IS GATED.  #
 * #                                                                          #
 * # The HDFC and UPI patterns below are adapted in shape from passbook (MIT) #
 * # and from the common structure of Indian bank alert mail. The SBI patterns#
 * # are net-new guesses — no reference parser exists in either source repo.   #
 * #                                                                          #
 * # Every pattern in the PATTERNS block is a hypothesis until it has matched  #
 * # MULTIPLE real emails per bank in dry-run. Run runDryRun() and read the    #
 * # execution log. Where a pattern misses, edit only the PATTERNS block —      #
 * # the extraction engine below it is bank-agnostic and should not need edits.#
 * ############################################################################
 */

/* ===================== PATTERNS — the only part you edit ===================== */

var PATTERNS = {
  HDFC_CC: {
    parser: 'HDFC_CC',
    bank: 'HDFC',
    /** A message qualifies for this parser when ALL of `requires` appear. */
    requires: [/hdfc/i, /credit\s*card/i],
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+(?:at|on|to|has been|was)/i,
      /(?:for|of)\s+(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
    ],
    merchant: [
      /\bat\s+([A-Z0-9][A-Za-z0-9 &._\-\/]{2,60}?)\s+on\s+\d/,
      /\bat\s+([A-Z0-9][A-Za-z0-9 &._\-\/]{2,60})/
    ],
    date: [
      /on\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/i,
      /on\s+(\d{2}[-\s][A-Za-z]{3}[-\s]\d{2,4})/i
    ],
    reference: [
      /(?:ref(?:erence)?(?:\s*no\.?|\s*number)?|txn\s*id)\s*[:\-#]?\s*([A-Za-z0-9]{6,25})/i
    ],
    creditHints: [/\brefund/i, /\breversed?\b/i, /payment received/i, /credited to your card/i]
  },

  HDFC_UPI: {
    parser: 'HDFC_UPI',
    bank: 'HDFC',
    requires: [/hdfc/i, /\bupi\b|\bvpa\b/i],
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+(?:has been|is|was)\s+(?:debited|credited)/i,
      /(?:debited|credited)\s+(?:by|with|for)\s+(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
    ],
    merchant: [
      /\bto\s+(?:vpa\s+)?([A-Za-z0-9][A-Za-z0-9._\-]{2,50}@[A-Za-z]{2,20})/i,
      /\bto\s+([A-Z0-9][A-Za-z0-9 &._\-\/]{2,60}?)\s+on\s+\d/,
      /\bfrom\s+(?:vpa\s+)?([A-Za-z0-9][A-Za-z0-9._\-]{2,50}@[A-Za-z]{2,20})/i
    ],
    date: [
      /on\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/i,
      /on\s+(\d{2}[-\s][A-Za-z]{3}[-\s]\d{2,4})/i
    ],
    reference: [
      /(?:upi\s*(?:ref(?:erence)?)?(?:\s*no\.?)?|utr|rrn)\s*[:\-#]?\s*(\d{9,22})/i,
      /(?:ref(?:erence)?\s*(?:no\.?|number)?)\s*[:\-#]?\s*([A-Za-z0-9]{6,25})/i
    ],
    creditHints: [/\bcredited\b/i, /\brefund/i, /\breceived from\b/i]
  },

  SBI_CC: {
    parser: 'SBI_CC',
    bank: 'SBI',
    /* NET-NEW. No reference implementation existed in either source repo.
       Expect to rewrite these entirely against real SBI Card alert mail. */
    requires: [/\bsbi\b|sbicard/i],
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+(?:spent|has been spent|was spent)/i,
      /(?:spent|txn of|transaction of)\s+(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
    ],
    merchant: [
      /\bat\s+([A-Z0-9][A-Za-z0-9 &._\-\/]{2,60}?)\s+on\s+\d/,
      /\bat\s+([A-Z0-9][A-Za-z0-9 &._\-\/]{2,60})/
    ],
    date: [
      /on\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/i,
      /on\s+(\d{2}[-\s][A-Za-z]{3}[-\s]\d{2,4})/i
    ],
    reference: [
      /(?:ref(?:erence)?\s*(?:no\.?|number)?|txn\s*(?:no\.?|id))\s*[:\-#]?\s*([A-Za-z0-9]{6,25})/i
    ],
    creditHints: [/\brefund/i, /payment received/i, /\bcredited\b/i, /thank you for your payment/i]
  }
};

/**
 * An amount candidate preceded by any of these within ~60 characters is
 * rejected. This is the guard against booking a credit limit or an available
 * balance as if it were the purchase (Orig §8).
 */
var AMOUNT_POISON = /(available|avl\.?|avbl\.?|limit|balance|bal\.?|outstanding|o\/s|due|minimum|min\.?\s*amt|reward|points|cashback)[^.]{0,45}$/i;

/** Sanity bounds. An amount outside this range is treated as unparsed, not clamped. */
var AMOUNT_MIN = 0.01;
var AMOUNT_MAX = 10000000;

/* ===================== Bank-agnostic extraction engine ===================== */

/**
 * Walks every match of every amount pattern in priority order, discarding any
 * whose left context is poisoned, and returns the first survivor.
 */
function parseAmount_(body, patterns) {
  for (var p = 0; p < patterns.length; p++) {
    var flags = patterns[p].flags.indexOf('g') >= 0 ? patterns[p].flags : patterns[p].flags + 'g';
    var re = new RegExp(patterns[p].source, flags);
    var m;
    while ((m = re.exec(body)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      var before = body.slice(Math.max(0, m.index - 60), m.index);
      if (AMOUNT_POISON.test(before)) continue;
      var n = Number(String(m[1]).replace(/,/g, ''));
      if (isNaN(n) || n < AMOUNT_MIN || n > AMOUNT_MAX) continue;
      return { amount: n, raw: m[0].trim() };
    }
  }
  return null;
}

var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Parses dd-mm-yy(yy), dd/mm/yy(yy) and dd-Mon-yy(yy).
 * Day-first, because that is how Indian bank alerts are written. An impossible
 * date falls back to the email's own timestamp rather than rolling over.
 */
function parseDateToken_(token, fallbackDate) {
  if (!token) return fallbackDate;
  var s = String(token).trim();

  var m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (m) {
    var d = Number(m[1]), mo = Number(m[2]) - 1, y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo >= 0 && mo <= 11 && d >= 1 && d <= 31) {
      var dt = new Date(y, mo, d);
      if (dt.getDate() === d && dt.getMonth() === mo) return dt;
    }
    return fallbackDate;
  }

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/);
  if (m) {
    var mm = MONTHS[m[2].toLowerCase()];
    if (mm === undefined) return fallbackDate;
    var yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    var dt2 = new Date(yy, mm, Number(m[1]));
    return isNaN(dt2.getTime()) ? fallbackDate : dt2;
  }
  return fallbackDate;
}

function firstMatch_(body, patterns) {
  if (!patterns) return null;
  for (var i = 0; i < patterns.length; i++) {
    var m = body.match(patterns[i]);
    if (m && m[1]) return String(m[1]).trim();
  }
  return null;
}

function cleanMerchant_(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
}

/** Picks the parser spec for a message. Account config wins over sniffing. */
function selectParser_(env, account) {
  if (account && account.parser && PATTERNS[account.parser]) return PATTERNS[account.parser];
  var hay = env.from + '\n' + env.subject + '\n' + env.body;
  for (var key in PATTERNS) {
    if (!PATTERNS.hasOwnProperty(key)) continue;
    var spec = PATTERNS[key];
    var all = true;
    for (var i = 0; i < spec.requires.length; i++) {
      if (!spec.requires[i].test(hay)) { all = false; break; }
    }
    if (all) return spec;
  }
  return null;
}

/**
 * Parses one message envelope.
 * Returns { ok:true, txn:{...} } or { ok:false, reason, detail }.
 * Never throws on bad input — unparseable is a result, not an exception.
 */
function parseMessage_(env, account) {
  var spec = selectParser_(env, account);
  if (!spec) {
    return {
      ok: false,
      reason: REVIEW_REASON.UNSUPPORTED,
      detail: 'No parser matched the sender/body signature.'
    };
  }

  var body = env.subject + '\n' + env.body;

  var amt = parseAmount_(body, spec.amount);
  if (!amt) {
    return {
      ok: false,
      reason: REVIEW_REASON.UNPARSED,
      detail: 'Parser ' + spec.parser + ' found no plausible amount (every candidate was poisoned by balance/limit context, out of range, or absent).'
    };
  }

  var merchant = cleanMerchant_(firstMatch_(body, spec.merchant));
  if (!merchant) {
    return {
      ok: false,
      reason: REVIEW_REASON.UNPARSED,
      detail: 'Parser ' + spec.parser + ' extracted amount ' + amt.amount + ' but no merchant. Not guessing.'
    };
  }

  var dateTok = firstMatch_(body, spec.date);
  var when = parseDateToken_(dateTok, env.date);
  var ref = firstMatch_(body, spec.reference);

  var isCredit = false;
  for (var i = 0; i < spec.creditHints.length; i++) {
    if (spec.creditHints[i].test(body)) { isCredit = true; break; }
  }
  // An explicit debit verb outranks a stray credit hint, unless the message is
  // itself about a refund or reversal.
  if (/\bdebited\b|\bspent\b|\bpurchase\b/i.test(body) && !/\brefund|\breversed?\b/i.test(body)) {
    isCredit = false;
  }

  return {
    ok: true,
    txn: {
      parser: spec.parser,
      bank: spec.bank,
      amount: amt.amount,
      direction: isCredit ? 'credit' : 'debit',
      merchant: merchant,
      date: when,
      reference: ref || '',
      rawAmount: amt.raw,
      raw: body.slice(0, 1500)
    }
  };
}
