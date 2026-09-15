/**
 * 13_TestHarness.gs — offline tests for the logic that must not be wrong.
 *
 * These run without Gmail and without touching any tab, so they are safe in the
 * real workbook. They cover the Orig §17 scenarios that are testable with
 * synthetic data; the ones that need real mail (parser accuracy) are covered by
 * previewParse() below instead, which is the Step 4 iteration loop.
 *
 * Run runTests() from the editor and read the execution log.
 */

var _t = { pass: 0, fail: 0, log: [] };

function check_(name, cond, detail) {
  if (cond) { _t.pass++; _t.log.push('  PASS  ' + name); }
  else { _t.fail++; _t.log.push('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

function runTests() {
  _t = { pass: 0, fail: 0, log: [] };

  testAmountExtraction_();
  testDateParsing_();
  testIdentity_();
  testSignAndExclusion_();
  testClassification_();
  testSoftDuplicate_();
  testCategoryPrecedence_();

  var summary = '\n=== ' + _t.pass + ' passed, ' + _t.fail + ' failed ===\n' + _t.log.join('\n');
  Logger.log(summary);
  return { pass: _t.pass, fail: _t.fail, report: summary };
}

/* -------------------------------------------------------------------------- */

function testAmountExtraction_() {
  _t.log.push('Amount extraction (must never pick up a limit or balance)');

  var spec = PATTERNS.HDFC_CC;

  var a = parseAmount_('Rs 1,234.50 at BIGBAZAAR on 12-09-2025', spec.amount);
  check_('comma-separated amount', a && a.amount === 1234.5, a ? String(a.amount) : 'no match');

  var b = parseAmount_('INR 499 at ZOMATO on 12-09-2025', spec.amount);
  check_('INR prefix, no decimals', b && b.amount === 499, b ? String(b.amount) : 'no match');

  var c = parseAmount_(
    'Thank you for using your card for Rs 250.00 at CAFE on 12-09-2025. Available credit limit is Rs 1,50,000.00',
    spec.amount);
  check_('transaction wins over available limit', c && c.amount === 250, c ? String(c.amount) : 'no match');

  var d = parseAmount_('Your available balance is Rs 45,000.00', spec.amount);
  check_('balance-only text yields nothing', d === null, d ? String(d.amount) : '');

  var e = parseAmount_('Rs 0.00 at TEST on 12-09-2025', spec.amount);
  check_('zero amount rejected', e === null, e ? String(e.amount) : '');

  var f = parseAmount_('Rs 99,99,99,999.00 at TEST on 12-09-2025', spec.amount);
  check_('implausibly large amount rejected', f === null, f ? String(f.amount) : '');
}

function testDateParsing_() {
  _t.log.push('Date parsing (day-first, as Indian banks write it)');
  var fb = new Date(2000, 0, 1);

  var d1 = parseDateToken_('05-09-2025', fb);
  check_('dd-mm-yyyy is 5 September', d1.getMonth() === 8 && d1.getDate() === 5,
         d1.toISOString());

  var d2 = parseDateToken_('05/09/25', fb);
  check_('dd/mm/yy two-digit year', d2.getFullYear() === 2025 && d2.getMonth() === 8, d2.toISOString());

  var d3 = parseDateToken_('05-Sep-2025', fb);
  check_('dd-Mon-yyyy', d3.getMonth() === 8 && d3.getDate() === 5, d3.toISOString());

  var d4 = parseDateToken_('31-02-2025', fb);
  check_('impossible date falls back, does not roll over', d4 === fb, d4.toISOString());

  var d5 = parseDateToken_('', fb);
  check_('missing token falls back to email date', d5 === fb, String(d5));
}

function testIdentity_() {
  _t.log.push('Transaction identity tiers');

  var txn = { reference: 'UTR123456789', date: new Date(2025, 8, 5), amount: 100, merchant: 'ZOMATO', direction: 'debit' };
  var i1 = makeTransactionId_('HDFC-CC', txn, 'gmail-abc');
  check_('reference wins when present', i1.tier === 'reference', i1.tier);

  var i2 = makeTransactionId_('HDFC-CC', { reference: '', date: txn.date, amount: 100, merchant: 'ZOMATO', direction: 'debit' }, 'gmail-abc');
  check_('falls back to message id', i2.tier === 'message' && i2.id.indexOf('gmail-abc') !== -1, i2.id);

  var i3 = makeTransactionId_('HDFC-CC', { reference: 'AB12', date: txn.date, amount: 100, merchant: 'ZOMATO', direction: 'debit' }, 'gmail-abc');
  check_('too-short reference is not trusted', i3.tier === 'message', i3.tier);

  var i4 = makeTransactionId_('HDFC-CC', { reference: '', date: txn.date, amount: 100, merchant: 'ZOMATO', direction: 'debit' }, null);
  check_('fingerprint is the last resort', i4.tier === 'fingerprint', i4.tier);

  // Orig §17: two legitimate same-amount same-day purchases must stay distinct.
  var same = { reference: '', date: new Date(2025, 8, 5), amount: 250, merchant: 'CAFE', direction: 'debit' };
  var a = makeTransactionId_('HDFC-CC', same, 'gmail-msg-1');
  var b = makeTransactionId_('HDFC-CC', same, 'gmail-msg-2');
  check_('same amount, same day, different emails -> different IDs', a.id !== b.id, a.id + ' vs ' + b.id);

  // And the same email twice must collapse.
  var c1 = makeTransactionId_('HDFC-CC', same, 'gmail-msg-1');
  check_('same email twice -> identical ID', a.id === c1.id, a.id + ' vs ' + c1.id);
}

function testSignAndExclusion_() {
  _t.log.push('Sign convention');
  check_('debit is positive', signedAmount_(500, TXN_TYPE.DEBIT) === 500);
  check_('refund is negative', signedAmount_(500, TXN_TYPE.REFUND) === -500);
  check_('cc payment is negative', signedAmount_(500, TXN_TYPE.CC_PAYMENT) === -500);
  check_('self-transfer keeps magnitude (exclusion flag carries the meaning)',
         signedAmount_(500, TXN_TYPE.SELF_TRANSFER) === 500);
  check_('already-negative input is normalised', signedAmount_(-500, TXN_TYPE.DEBIT) === 500);
}

function testClassification_() {
  _t.log.push('Type classification');

  var debit = classifyTransaction_({ direction: 'debit', raw: 'Rs 500 spent at ZOMATO', merchant: 'ZOMATO' }, null, []);
  check_('plain debit', debit.type === TXN_TYPE.DEBIT && !debit.excluded, debit.type);

  var pay = classifyTransaction_({ direction: 'credit', raw: 'Thank you for your payment of Rs 5,000', merchant: 'HDFC' }, null, []);
  check_('card bill payment is excluded from spending',
         pay.type === TXN_TYPE.CC_PAYMENT && pay.excluded === true, pay.type);

  var ref = classifyTransaction_({ direction: 'credit', raw: 'Refund of Rs 500 processed for your order', merchant: 'AMAZON' }, null, []);
  check_('refund is a refund and counts', ref.type === TXN_TYPE.REFUND && ref.excluded === false, ref.type);

  var unk = classifyTransaction_({ direction: 'credit', raw: 'Rs 500 credited to your account', merchant: 'SOMEONE' }, null, []);
  check_('unrecognised credit is excluded AND flagged, not guessed',
         unk.type === TXN_TYPE.CREDIT && unk.excluded === true && unk.reviewReason === REVIEW_REASON.AMBIGUOUS_TYPE,
         unk.type + '/' + unk.reviewReason);

  var self = classifyTransaction_({ direction: 'debit', raw: 'Rs 500 debited to ashwin@okaxis', merchant: 'ashwin@okaxis' },
                                  null, ['ASHWIN@OKAXIS']);
  check_('known own VPA becomes Self-Transfer and is excluded',
         self.type === TXN_TYPE.SELF_TRANSFER && self.excluded === true, self.type);
}

function testSoftDuplicate_() {
  _t.log.push('Soft duplicate window');

  var idx = { recent: [{
    account: 'HDFC-CC', signed: 250, amount: 250,
    dateMs: new Date(2025, 8, 5).getTime(), merchant: 'CAFE',
    type: TXN_TYPE.DEBIT, status: 'Active', txnId: 'T1'
  }] };

  var inWindow = softDuplicateCheck_(idx,
    { account: 'HDFC-CC', amount: 250, type: TXN_TYPE.DEBIT, date: new Date(2025, 8, 6) }, 3);
  check_('same amount next day is flagged', !!inWindow, String(inWindow));

  var outWindow = softDuplicateCheck_(idx,
    { account: 'HDFC-CC', amount: 250, type: TXN_TYPE.DEBIT, date: new Date(2025, 8, 20) }, 3);
  check_('same amount two weeks later is not flagged', outWindow === null, String(outWindow));

  var otherAcct = softDuplicateCheck_(idx,
    { account: 'SBI-CC', amount: 250, type: TXN_TYPE.DEBIT, date: new Date(2025, 8, 6) }, 3);
  check_('same amount on another account is not flagged', otherAcct === null, String(otherAcct));

  var otherSign = softDuplicateCheck_(idx,
    { account: 'HDFC-CC', amount: 250, type: TXN_TYPE.REFUND, date: new Date(2025, 8, 6) }, 3);
  check_('a refund of the same size is not a duplicate of the purchase', otherSign === null, String(otherSign));
}

function testCategoryPrecedence_() {
  _t.log.push('Category precedence (longest keyword wins)');

  var saved = _categoriesCache;
  _categoriesCache = [
    { keyword: 'AMAZON PAY', length: 10, order: 1, category: 'Bills', subcategory: '' },
    { keyword: 'AMAZON',     length: 6,  order: 0, category: 'Shopping', subcategory: '' },
    { keyword: 'ZOMATO',     length: 6,  order: 2, category: 'Food', subcategory: '' }
  ].sort(function (a, b) { return b.length - a.length || a.order - b.order; });

  try {
    var r1 = categorise_('AMAZON PAY RECHARGE', '');
    check_('longer keyword beats shorter', r1.category === 'Bills', r1.category);

    var r2 = categorise_('AMAZON RETAIL', '');
    check_('shorter keyword still matches on its own', r2.category === 'Shopping', r2.category);

    var r3 = categorise_('ZOMATO', 'footer mentions AMAZON offers');
    check_('merchant match beats body match', r3.category === 'Food' && r3.matchedOn === 'merchant',
           r3.category + '/' + r3.matchedOn);
  } finally {
    _categoriesCache = saved;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * STEP 4 ITERATION LOOP.
 *
 * Paste a redacted real email body between the backticks, run this, and read
 * the log. This is how you turn the draft patterns in 04_Parsers.gs into
 * validated ones without sending a single row to the ledger.
 */
function previewParse() {
  var sampleFrom = 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>';
  var sampleSubject = 'Alert: Update on your HDFC Bank Credit Card';
  var sampleBody = [
    'Dear Customer,',
    'Thank you for using your HDFC Bank Credit Card ending 1234 for Rs 1,250.00 at BLUE TOKAI COFFEE on 05-09-2025 19:42:11.',
    'Your available credit limit is Rs 1,48,750.00.',
    'Reference No: 123456789012'
  ].join('\n');

  var env = {
    id: 'preview-' + Utilities.getUuid().slice(0, 8),
    date: new Date(),
    from: sampleFrom,
    subject: sampleSubject,
    body: sampleBody
  };

  var result = parseMessage_(env, null);
  Logger.log('--- previewParse ---');
  Logger.log('From:    ' + env.from);
  Logger.log('Subject: ' + env.subject);
  Logger.log('Result:  ' + JSON.stringify(result, function (k, v) {
    return (v instanceof Date) ? v.toISOString() : v;
  }, 2));

  if (result.ok) {
    var cls = classifyTransaction_(result.txn, null, selfTransferVpasSafe_());
    Logger.log('Type:    ' + cls.type + (cls.excluded ? ' (excluded from spending)' : '')
             + (cls.reviewReason ? ' [' + cls.reviewReason + ']' : ''));
  }
  return result;
}

/** selfTransferVpas_ reads the Settings tab; fall back to empty when unavailable. */
function selfTransferVpasSafe_() {
  try { return selfTransferVpas_(); } catch (e) { return []; }
}
