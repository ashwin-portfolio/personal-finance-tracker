/**
 * 04_Parsers.gs — bank-specific extraction.
 *
 * Patterns validated against real HDFC and SBI Card alert mail (Sep 2026).
 * Each parser is pinned to a real sender and a real body signature.
 *
 * The REJECT_SIGNATURES block below is not an optimisation — it is load-bearing.
 * A bank's transaction alert, its OTP mail, and its declined-transaction notice
 * all contain an amount, a merchant and a card number, and all come from the
 * same sender. Matching on "has an amount and a merchant" books all three.
 * Observed in this mailbox:
 *
 *   - An OTP mail for INR 3798.00 "at SAMPLE MERCH" arrives minutes before the
 *     real SAMPLE MERCH purchase alert for the same 3798.00. Parsing both doubles it.
 *   - A declined Rs. 9390.00 alert sits alongside a successful Rs. 9390.00
 *     retry on the same card the same day. Parsing both doubles it.
 *
 * Rejection runs before parser selection, and rejected mail is dropped with a
 * log line rather than queued for review — a promo mail is not something a
 * human needs to adjudicate.
 */

/* ===================== PATTERNS — the only part you edit ===================== */

var PATTERNS = {
  /**
   * HDFC credit card purchase. Real shape:
   *   "We would like to inform you that Rs. 450.00 has been debited from your
   *    HDFC Bank Credit Card ending 9999 towards SAMPLE TRADERS on
   *    14 Sep, 2026 at 18:22:07."
   * Merchant follows "towards", NOT "at" — "at" here introduces the time, and
   * the mail's footer also contains "Helpline at 1800 258 6161". An "at"-based
   * merchant pattern extracts "18" or a phone number.
   * These alerts carry no reference number, so identity falls to the Gmail
   * message ID (tier 2).
   */
  HDFC_CC: {
    parser: 'HDFC_CC',
    bank: 'HDFC',
    requires: [/hdfc/i, /credit\s*card/i, /towards/i],
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+has\s+been\s+debited/i,
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+has\s+been\s+(?:successfully\s+)?credited/i
    ],
    merchant: [
      /towards\s+([A-Za-z0-9][^\n]{1,60}?)\s+on\s+\d{1,2}\s+[A-Za-z]{3}/,
      /towards\s+([A-Za-z0-9][^\n]{1,60}?)\s+on\s+\d{1,2}[-\/]\d{1,2}/
    ],
    date: [
      /\bon\s+(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4})/i,
      /\bon\s+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i
    ],
    reference: [
      /(?:ref(?:erence)?\s*(?:no\.?|number)?|txn\s*id)\s*[:\-#]?\s*([A-Za-z0-9]{6,25})/i
    ],
    creditHints: [/\brefund/i, /\breversed?\b/i, /payment received/i, /credited to your card/i]
  },

  /**
   * HDFC UPI. Real shape:
   *   "Rs.130.00 is debited from your account ending 1111 towards VPA
   *    sample.abc123@pty (SAMPLE SNACK BAR) on 15-09-26.
   *    UPI transaction reference no.: 120000000001"
   * The human-readable merchant is in the parentheses; the VPA is the machine
   * handle. We take the parenthesised name as the merchant (it is what you would
   * recognise on a statement) and keep the VPA for self-transfer detection.
   */
  HDFC_UPI: {
    parser: 'HDFC_UPI',
    bank: 'HDFC',
    requires: [/hdfc/i, /\bVPA\b|\bUPI\b/i],
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+is\s+(?:debited|credited)/i,
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+has\s+been\s+(?:successfully\s+)?(?:debited|credited)/i
    ],
    merchant: [
      /(?:towards|from)\s+VPA\s+[^\s()]+\s*\(([^)\n]{2,80})\)/i,
      /(?:towards|from)\s+VPA\s+([A-Za-z0-9][A-Za-z0-9._\-]{2,50}@[A-Za-z]{2,20})/i
    ],
    vpa: [
      /(?:towards|from)\s+VPA\s+([A-Za-z0-9][A-Za-z0-9._\-]{2,50}@[A-Za-z]{2,20})/i
    ],
    date: [
      /\bon\s+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
      /Date\s*[:\-]\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i
    ],
    reference: [
      /UPI\s+transaction\s+reference\s+no\.?\s*[:\-#]?\s*(\d{9,22})/i,
      /(?:UPI\s*(?:ref(?:erence)?)?\s*(?:no\.?)?|UTR|RRN)\s*[:\-#]?\s*(\d{9,22})/i
    ],
    creditHints: [/is\s+credited/i, /\brefund/i, /\breceived from\b/i]
  },

  /**
   * HDFC savings-account credit. Real shape:
   *   "Rs.4000.00 has been successfully credited to your HDFC Bank account
   *    ending in 1111. Transaction Details: a. Date: 14-09-26"
   * No merchant at all, so merchantOptional lets it through with a placeholder
   * rather than failing to the review queue on every salary or transfer credit.
   */
  HDFC_SAV_CREDIT: {
    parser: 'HDFC_SAV_CREDIT',
    bank: 'HDFC',
    requires: [/hdfc/i, /credited to your HDFC Bank account/i],
    merchantOptional: true,
    merchantFallback: 'HDFC Account Credit',
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+has\s+been\s+successfully\s+credited/i
    ],
    merchant: [
      /(?:from|by)\s+([A-Z0-9][^\n]{2,60}?)\s+on\s+\d/
    ],
    date: [
      /Date\s*[:\-]\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
      /\bon\s+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i
    ],
    reference: [
      /(?:ref(?:erence)?\s*(?:no\.?|number)?)\s*[:\-#]?\s*([A-Za-z0-9]{6,25})/i
    ],
    creditHints: [/credited/i]
  },

  /**
   * SBI Card. Real shape:
   *   "Rs.1,207.58 spent on your SBI Credit Card ending 9999 at
   *    SAMPLEPETROLSUPPLY on 10/09/26."
   * Merchant follows "at" here, and the footer contains no competing "at <CAPS>",
   * so the at-based pattern is safe for this sender specifically.
   * No reference number.
   */
  SBI_CC: {
    parser: 'SBI_CC',
    bank: 'SBI',
    requires: [/sbi\s*card|sbi\s*credit\s*card/i, /\bspent\b|\bcredited\b/i],
    amount: [
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+spent/i,
      /(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+(?:has\s+been\s+)?credited/i
    ],
    merchant: [
      /\bat\s+([A-Za-z0-9][^\n]{1,60}?)\s+on\s+\d{1,2}[-\/]\d{1,2}/
    ],
    date: [
      /\bon\s+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
      /\bon\s+(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4})/i
    ],
    reference: [
      /(?:ref(?:erence)?\s*(?:no\.?|number)?|txn\s*(?:no\.?|id))\s*[:\-#]?\s*([A-Za-z0-9]{6,25})/i
    ],
    creditHints: [/\brefund/i, /payment received/i, /thank you for your payment/i]
  }
};

/**
 * Mail that must never become a ledger row, checked before parser selection.
 * Each entry names itself so the dry-run log says WHY something was dropped.
 */
var REJECT_SIGNATURES = [
  { name: 'OTP',            test: /is\s+the\s+OTP\s+for|OTP\s+for\s+(?:the\s+)?transaction|verification\s+code/i },
  { name: 'Declined',       test: /has\s+declined\b|transaction\s+(?:is\s+)?declined|declined\s+transaction|failed\s+transaction/i },
  { name: 'EMI promo',      test: /smartemi|eligible\s+for\s+conversion|convert\s+your\s+(?:credit\s+card\s+)?(?:outstanding|balance|bill)|interest\s+rate\s+(?:starts|drop)/i },
  { name: 'Statement',      test: /monthly\s+statement|e-?statement|statement\s+is\s+password/i },
  { name: 'Reward points',  test: /reward\s+points|sbi\s+rewardz/i },
  { name: 'Card control',   test: /login\s+PIN|tap\s*&\s*pay|transaction\s+limits|usage\s+limit\s+is\s+set/i },
  { name: 'Marketing',      test: /know\s+more\s*\||instant\s+discount|voucher|joining\s+fee|pre-?approved/i }
];

/**
 * An amount candidate is rejected when a poison word sits within ~60 characters
 * on EITHER side. Both sides matter: HDFC writes "Outstanding of Rs. 30682"
 * (left) and also "Rs.30682 Outstanding Amount" (right) in its EMI promos.
 */
var AMOUNT_POISON_BEFORE = /(available|avl\.?|avbl\.?|limit|balance|bal\.?|outstanding|o\/s|due|minimum|min\.?\s*amt|reward|points|cashback|charged)[^.]{0,45}$/i;
var AMOUNT_POISON_AFTER = /^[^.]{0,30}(outstanding|available|limit|balance|reward|points|as\s+on)/i;

/** Sanity bounds. An amount outside this range is treated as unparsed, not clamped. */
var AMOUNT_MIN = 0.01;
var AMOUNT_MAX = 10000000;

/* ===================== Bank-agnostic extraction engine ===================== */

/** Returns the name of the first rejection signature that matches, or null. */
function rejectionReason_(text) {
  for (var i = 0; i < REJECT_SIGNATURES.length; i++) {
    if (REJECT_SIGNATURES[i].test.test(text)) return REJECT_SIGNATURES[i].name;
  }
  return null;
}

/**
 * Walks every match of every amount pattern in priority order, discarding any
 * whose surrounding context is poisoned, and returns the first survivor.
 */
function parseAmount_(body, patterns) {
  for (var p = 0; p < patterns.length; p++) {
    var flags = patterns[p].flags.indexOf('g') >= 0 ? patterns[p].flags : patterns[p].flags + 'g';
    var re = new RegExp(patterns[p].source, flags);
    var m;
    while ((m = re.exec(body)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      var before = body.slice(Math.max(0, m.index - 60), m.index);
      if (AMOUNT_POISON_BEFORE.test(before)) continue;
      var after = body.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (AMOUNT_POISON_AFTER.test(after)) continue;
      var n = Number(String(m[1]).replace(/,/g, ''));
      if (isNaN(n) || n < AMOUNT_MIN || n > AMOUNT_MAX) continue;
      return { amount: n, raw: m[0].trim() };
    }
  }
  return null;
}

var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Parses dd-mm-yy(yy), dd/mm/yy(yy), dd-Mon-yy(yy) and "dd Mon, yyyy".
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

  // "05-Sep-2025", "05 Sep 2025", "14 Sep, 2026", "14 September, 2026"
  m = s.match(/^(\d{1,2})[-\s]+([A-Za-z]{3})[A-Za-z]*,?[-\s]+(\d{2,4})$/);
  if (m) {
    var mm = MONTHS[m[2].toLowerCase()];
    if (mm === undefined) return fallbackDate;
    var yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    var dd = Number(m[1]);
    var dt2 = new Date(yy, mm, dd);
    if (isNaN(dt2.getTime()) || dt2.getDate() !== dd) return fallbackDate;
    return dt2;
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
 * Returns { ok:true, txn:{...} } or { ok:false, reason, detail, drop? }.
 * drop:true means "this is definitely not a transaction" — caller discards it
 * without queueing a human for review.
 * Never throws on bad input — unparseable is a result, not an exception.
 */
function parseMessage_(env, account) {
  var body = env.subject + '\n' + env.body;

  var rejected = rejectionReason_(body);
  if (rejected) {
    return {
      ok: false,
      drop: true,
      reason: REVIEW_REASON.UNSUPPORTED,
      detail: 'Not a transaction alert (' + rejected + ').'
    };
  }

  var spec = selectParser_(env, account);
  if (!spec) {
    return {
      ok: false,
      reason: REVIEW_REASON.UNSUPPORTED,
      detail: 'No parser matched the sender/body signature.'
    };
  }

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
    if (spec.merchantOptional) {
      merchant = spec.merchantFallback || 'Unknown';
    } else {
      return {
        ok: false,
        reason: REVIEW_REASON.UNPARSED,
        detail: 'Parser ' + spec.parser + ' extracted amount ' + amt.amount + ' but no merchant. Not guessing.'
      };
    }
  }

  var dateTok = firstMatch_(body, spec.date);
  var when = parseDateToken_(dateTok, env.date);
  var ref = firstMatch_(body, spec.reference);
  var vpa = spec.vpa ? firstMatch_(body, spec.vpa) : null;

  var isCredit = false;
  for (var i = 0; i < spec.creditHints.length; i++) {
    if (spec.creditHints[i].test(body)) { isCredit = true; break; }
  }
  // An explicit debit verb outranks a stray credit hint, unless the message is
  // itself about a refund or reversal.
  if (/\bis\s+debited\b|has\s+been\s+debited\b|\bspent\b/i.test(body)
      && !/\brefund|\breversed?\b/i.test(body)) {
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
      vpa: vpa || '',
      date: when,
      reference: ref || '',
      rawAmount: amt.raw,
      raw: body.slice(0, 1500)
    }
  };
}
