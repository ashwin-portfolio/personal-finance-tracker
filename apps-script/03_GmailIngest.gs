/**
 * 03_GmailIngest.gs — Gmail label scan and message normalisation.
 *
 * Deliberately does NOT use message.isUnread() as a processing condition
 * (Orig 7.2). Read state is a human affordance, not a pipeline state machine:
 * opening an email on your phone would silently skip a transaction.
 *
 * Incremental scanning instead uses Gmail's after: operator against the last
 * successful run, rewound by "Lookback Overlap (days)". The overlap deliberately
 * re-presents recent messages; the dedup layer discards them by stable ID. That
 * costs a few redundant parses and buys immunity to clock skew and to alerts
 * that arrive out of order.
 */

var _accountsCache = null;

/** Reads the Accounts tab into matcher objects. */
function accounts_() {
  if (_accountsCache) return _accountsCache;
  var rows = readRows_(TAB.ACCOUNTS);
  var cId     = colOrThrow_(TAB.ACCOUNTS, 'Account ID');
  var cRule   = colOrThrow_(TAB.ACCOUNTS, 'Sender Rule');
  var cBank   = col_(TAB.ACCOUNTS, 'Bank');
  var cLast4  = col_(TAB.ACCOUNTS, 'Last 4 Digits');
  var cParser = col_(TAB.ACCOUNTS, 'Parser');
  var cActive = col_(TAB.ACCOUNTS, 'Active');

  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][cId]).trim();
    if (!id) continue;
    if (cActive >= 0) {
      var a = rows[i][cActive];
      if (a !== '' && a !== null && !(a === true || /^(true|yes|y|1)$/i.test(String(a).trim()))) continue;
    }
    // Sender Rule accepts several senders, comma- or semicolon-separated: one
    // card is alerted by its own bank AND by whatever app you pay the bill
    // through (CRED, for instance). Both belong to the same account.
    var rules = String(rows[i][cRule]).toLowerCase().split(/[,;]/)
                  .map(function (r) { return r.trim(); })
                  .filter(function (r) { return r.length > 0; });
    out.push({
      id:     id,
      bank:   cBank   >= 0 ? String(rows[i][cBank]).trim()   : '',
      rules:  rules,
      last4:  cLast4  >= 0 ? String(rows[i][cLast4]).trim()  : '',
      parser: cParser >= 0 ? String(rows[i][cParser]).trim() : ''
    });
  }
  _accountsCache = out;
  return out;
}

/**
 * Matches a message to a configured account.
 * Sender Rule is matched as a case-insensitive substring of the From header.
 * When several accounts share a sender (e.g. two HDFC cards), Last 4 Digits
 * disambiguates against the body; without it the match is reported ambiguous
 * rather than guessed.
 */
function matchAccount_(fromHeader, body) {
  var from = String(fromHeader).toLowerCase();
  var candidates = accounts_().filter(function (a) {
    for (var i = 0; i < a.rules.length; i++) {
      if (from.indexOf(a.rules[i]) !== -1) return true;
    }
    return false;
  });

  if (candidates.length === 0) return { account: null, ambiguous: false };
  if (candidates.length === 1) return { account: candidates[0], ambiguous: false };

  var byLast4 = candidates.filter(function (a) {
    return a.last4 && body.indexOf(a.last4) !== -1;
  });
  if (byLast4.length === 1) return { account: byLast4[0], ambiguous: false };
  return { account: null, ambiguous: true, candidates: candidates };
}

/** Strips HTML to readable text and normalises whitespace and rupee variants. */
function normaliseBody_(message) {
  var text = '';
  try { text = message.getPlainBody(); } catch (e) { text = ''; }
  if (!text || text.replace(/\s/g, '').length < 20) {
    var html = '';
    try { html = message.getBody(); } catch (e2) { html = ''; }
    text = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|table|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u20b9/g, 'Rs.')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Builds the Gmail search query for this run. */
function buildQuery_(label, sinceEpochSeconds) {
  var q = 'label:' + label.replace(/\s+/g, '-');
  if (sinceEpochSeconds && sinceEpochSeconds > 0) q += ' after:' + Math.floor(sinceEpochSeconds);
  return q;
}

/**
 * Fetches candidate messages for this run as normalised envelopes.
 * Returns [{ id, date, from, subject, body }] newest-last.
 */
function fetchMessages_(opts) {
  var c = cfg_();
  var props = PropertiesService.getScriptProperties();
  var lastRun = Number(props.getProperty(PROP.LAST_RUN_EPOCH) || 0);

  var since = 0;
  if (opts && opts.fullScan) {
    since = 0;
  } else if (lastRun > 0) {
    since = lastRun - (c.overlapDays * 86400);
  }

  var query = buildQuery_(c.label, since);
  Logger.log('Gmail query: ' + query);

  var threads = GmailApp.search(query, 0, Math.max(1, Math.min(500, c.maxMessages)));
  var out = [];
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var when = msg.getDate();
      if (since > 0 && when.getTime() / 1000 < since) continue;
      out.push({
        id:      msg.getId(),
        date:    when,
        from:    msg.getFrom(),
        subject: msg.getSubject(),
        body:    normaliseBody_(msg)
      });
      if (out.length >= c.maxMessages) break;
    }
    if (out.length >= c.maxMessages) break;
  }

  out.sort(function (a, b) { return a.date - b.date; });
  return out;
}

function markRunCompleted_(startedAt) {
  PropertiesService.getScriptProperties()
    .setProperty(PROP.LAST_RUN_EPOCH, String(Math.floor(startedAt.getTime() / 1000)));
}
