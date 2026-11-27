/**
 * 14_WebApp.gs — read-only JSON for the iOS widget.
 *
 * There is nothing new to host: this is the same Apps Script project, published
 * as a web app. Deploy > New deployment > Web app, "Execute as: Me",
 * "Who has access: Anyone with the link".
 *
 * That URL is a bearer credential on its own, and URLs leak — browser history,
 * an iCloud-synced Scriptable file. So it also requires ?token= matching the
 * "Widget Token" setting. Put any long random string there.
 *
 * Figures come from Transactions and Budget by header name, not from the
 * Dashboard's cells, so replacing the Dashboard tab cannot break the widget.
 */

function doGet(e) {
  var want = getSettingString_('Widget Token', '');
  var got = (e && e.parameter && e.parameter.token) || '';
  // Apps Script web apps cannot set a status code, so errors are 200 + {error}.
  if (!want || got !== want) return json_({ error: 'unauthorised' });
  try {
    return json_(widgetPayload_());
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** "2026-09" from a text month, a date, or "2026-09-01". */
function monthKey_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
  return String(v == null ? '' : v).trim().slice(0, 7);
}

function widgetPayload_() {
  resetCaches_();
  var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata';
  var now = new Date();
  var month = Utilities.formatDate(now, tz, 'yyyy-MM');
  var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  var daysLeft = Math.max(1, Math.round((monthEnd - now) / 86400000) + 1);

  // Amount is already signed in the sheet (debits positive, refunds negative),
  // so a plain sum is the spend.
  var rows = readRows_(TAB.TRANSACTIONS);
  var cDate = colOrThrow_(TAB.TRANSACTIONS, 'Date');
  var cAmt = colOrThrow_(TAB.TRANSACTIONS, 'Amount');
  var cCat = colOrThrow_(TAB.TRANSACTIONS, 'Category');
  var cEx = col_(TAB.TRANSACTIONS, 'Excluded From Spending');
  var fallbackCat = cfg_().defaultCategory;

  var spent = 0, spentByCat = {};
  for (var i = 0; i < rows.length; i++) {
    if (monthKey_(rows[i][cDate], tz) !== month) continue;
    if (cEx >= 0 && rows[i][cEx] === true) continue;
    var amt = Number(rows[i][cAmt]) || 0;
    spent += amt;
    var key = String(rows[i][cCat] || '').trim() || fallbackCat;
    spentByCat[key] = (spentByCat[key] || 0) + amt;
  }

  var brows = readRows_(TAB.BUDGET);
  var bMonth = colOrThrow_(TAB.BUDGET, 'Month');
  var bCat = colOrThrow_(TAB.BUDGET, 'Category');
  var bAmt = colOrThrow_(TAB.BUDGET, 'Budgeted Amount');
  var budget = 0, budgetByCat = {};
  for (var j = 0; j < brows.length; j++) {
    if (monthKey_(brows[j][bMonth], tz) !== month) continue;
    var b = Number(brows[j][bAmt]) || 0;
    var bk = String(brows[j][bCat] || '').trim();
    if (!bk) continue;
    budget += b;
    budgetByCat[bk] = (budgetByCat[bk] || 0) + b;
  }

  var names = {};
  for (var k in spentByCat) names[k] = true;
  for (var m in budgetByCat) names[m] = true;
  var categories = Object.keys(names).map(function (name) {
    return { name: name, spent: round2_(spentByCat[name] || 0), budget: round2_(budgetByCat[name] || 0) };
  }).sort(function (a, b) { return b.spent - a.spent; }).slice(0, 6);

  var remaining = budget - spent;

  return {
    month: month,
    daysLeft: daysLeft,
    spent: round2_(spent),
    budget: round2_(budget),
    remaining: round2_(remaining),
    safePerDay: round2_(Math.max(0, remaining) / daysLeft),
    categories: categories,
    openReviews: countOpenReviews_(),
    lastSync: lastSuccessfulSync_(tz),
    currency: cfg_().currency
  };
}

function round2_(n) {
  return Math.round(Number(n) * 100) / 100;
}

function countOpenReviews_() {
  try {
    var c = col_(TAB.REVIEW_QUEUE, 'Status');
    if (c < 0) return 0;
    return readRows_(TAB.REVIEW_QUEUE).filter(function (r) {
      return String(r[c]).trim() === 'Open';
    }).length;
  } catch (e) {
    return 0;
  }
}

function lastSuccessfulSync_(tz) {
  try {
    var rows = readRows_(TAB.SYNC_LOGS);
    var cFin = col_(TAB.SYNC_LOGS, 'Finished At');
    var cSt = col_(TAB.SYNC_LOGS, 'Status');
    if (cFin < 0 || cSt < 0) return '';
    for (var i = rows.length - 1; i >= 0; i--) {
      // "Success" and "Completed with errors" both wrote rows; only the first
      // means the ledger is actually up to date.
      if (String(rows[i][cSt]).trim().indexOf('Success') !== 0) continue;
      var d = rows[i][cFin];
      return (d instanceof Date) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm') : String(d);
    }
  } catch (e) { /* a missing or malformed tab must not break the widget */ }
  return '';
}
