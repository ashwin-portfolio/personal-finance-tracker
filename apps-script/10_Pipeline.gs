/**
 * 10_Pipeline.gs — orchestration and the public entry points.
 *
 * Failure isolation (Orig §16) is the organising principle: every message is
 * processed inside its own try/catch, and a thrown error becomes a Review Queue
 * row rather than aborting the batch. One malformed email must cost you that
 * one email, not the run.
 */

/* ============================== Entry points ============================== */

/**
 * STEP 3/4 — dry run. Reads Gmail, parses, classifies, and logs what it WOULD
 * do. Writes nothing to any tab, including Sync Logs.
 */
function runDryRun() {
  return runPipeline_({ dryRun: true, triggerType: 'Dry Run', fullScan: false });
}

/** Dry run over the entire label, ignoring the incremental pointer. */
function runFullDryRun() {
  return runPipeline_({ dryRun: true, triggerType: 'Dry Run (full)', fullScan: true });
}

/** STEP 7 — manual, writes for real. Wired to the custom menu. */
function runSyncNow() {
  var stats = runPipeline_({ dryRun: false, triggerType: 'Manual', fullScan: false });
  try {
    ss_().toast(summarise_(stats), 'Finance sync', 8);
  } catch (e) { /* toast is unavailable when run from the editor */ }
  return stats;
}

/**
 * STEP 10 — the time-driven trigger target.
 * Checks the kill switch FIRST, before touching Gmail or the ledger.
 */
function runScheduledSync() {
  resetCaches_();
  if (!cfg_().automationOn) {
    Logger.log('Automation Enabled is FALSE in Settings — exiting without doing anything.');
    return null;
  }
  return runPipeline_({ dryRun: false, triggerType: 'Scheduled', fullScan: false });
}

/* =============================== The pipeline ============================== */

function runPipeline_(opts) {
  resetCaches_();
  var stats = newRunStats_(opts.triggerType);

  // Manual "Run Sync Now" and the 15-minute trigger can collide. Without this
  // lock both runs would read the same pre-insert ledger index and both would
  // conclude the same email is new.
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    stats.status = 'Skipped';
    stats.errorMessage = 'Another sync run holds the lock; this run exited without doing anything.';
    writeSyncLog_(stats, opts.dryRun);
    Logger.log(summarise_(stats));
    return stats;
  }

  try {
    assertSchemaVerified_();

    var c = cfg_();
    var idx = buildLedgerIndex_();
    var selfVpas = selfTransferVpas_();
    var flagUncategorised = getSettingBool_('Flag Uncategorised For Review', false);

    var messages = fetchMessages_({ fullScan: opts.fullScan });
    stats.scanned = messages.length;
    Logger.log('Scanned ' + messages.length + ' message(s) under label "' + c.label + '".');

    var toInsert = [];
    var toReview = [];

    for (var i = 0; i < messages.length; i++) {
      try {
        processMessage_(messages[i], idx, c, selfVpas, flagUncategorised, toInsert, toReview, stats);
      } catch (err) {
        // Orig §16: contain the blast radius to this one message.
        stats.errors++;
        Logger.log('ERROR on message ' + messages[i].id + ': ' + err.message + '\n' + (err.stack || ''));
        pushReview_(toReview, idx, {
          reviewId: makeReviewId_(messages[i].id, REVIEW_REASON.UNPARSED),
          date: messages[i].date,
          reason: REVIEW_REASON.UNPARSED,
          emailId: messages[i].id,
          raw: messages[i].body,
          detail: 'Processing threw: ' + err.message
        });
      }
    }

    stats.imported = insertTransactions_(toInsert, opts.dryRun);
    stats.review = queueForReview_(toReview, opts.dryRun);
    stats.status = stats.errors > 0 ? 'Completed with errors' : 'Success';

    // Advance the incremental pointer only on a real, successful run. A dry run
    // must be repeatable, and a failed run must re-examine the same window.
    if (!opts.dryRun && stats.status !== 'Failed') {
      markRunCompleted_(stats.startedAt);
    }

  } catch (fatal) {
    stats.status = 'Failed';
    stats.errorMessage = fatal.message;
    Logger.log('FATAL: ' + fatal.message + '\n' + (fatal.stack || ''));
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }

  writeSyncLog_(stats, opts.dryRun);
  Logger.log(summarise_(stats));
  return stats;
}

/** Processes exactly one message. Mutates toInsert / toReview / stats. */
function processMessage_(env, idx, c, selfVpas, flagUncategorised, toInsert, toReview, stats) {

  // ---- 1. Which account is this? -------------------------------------------
  var match = matchAccount_(env.from, env.body);
  if (match.ambiguous) {
    stats.errors++;
    pushReview_(toReview, idx, {
      reviewId: makeReviewId_(env.id, REVIEW_REASON.UNSUPPORTED),
      date: env.date, reason: REVIEW_REASON.UNSUPPORTED, emailId: env.id, raw: env.body,
      detail: 'Sender matches several accounts (' +
              match.candidates.map(function (a) { return a.id; }).join(', ') +
              ') and no Last 4 Digits value disambiguated it.'
    });
    return;
  }
  if (!match.account) {
    stats.errors++;
    pushReview_(toReview, idx, {
      reviewId: makeReviewId_(env.id, REVIEW_REASON.UNSUPPORTED),
      date: env.date, reason: REVIEW_REASON.UNSUPPORTED, emailId: env.id, raw: env.body,
      detail: 'No Accounts row has a Sender Rule matching: ' + env.from
    });
    return;
  }
  var account = match.account;

  // ---- 2. Parse -------------------------------------------------------------
  var parsed = parseMessage_(env, account);
  if (!parsed.ok) {
    stats.errors++;
    pushReview_(toReview, idx, {
      reviewId: makeReviewId_(env.id, parsed.reason),
      date: env.date, account: account.id, reason: parsed.reason,
      emailId: env.id, raw: env.body, detail: parsed.detail
    });
    return;
  }
  var txn = parsed.txn;

  // ---- 3. Hard duplicate ----------------------------------------------------
  var ident = makeTransactionId_(account.id, txn, env.id);
  if (idx.txnIds[ident.id] || idx.emailIds[env.id]) {
    stats.duplicates++;
    Logger.log('  = duplicate, skipping: ' + ident.id + ' (tier: ' + ident.tier + ')');
    return;
  }

  // ---- 4. Type, exclusion, refund linking -----------------------------------
  var cls = classifyTransaction_(txn, account, selfVpas);

  var candidate = {
    txnId: ident.id,
    idTier: ident.tier,
    date: txn.date,
    sourceDate: env.date,
    account: account.id,
    bank: account.bank || txn.bank,
    type: cls.type,
    amount: txn.amount,
    currency: c.currency,
    merchant: txn.merchant,
    reference: txn.reference,
    emailId: env.id,
    raw: txn.raw,
    excluded: cls.excluded,
    status: TXN_STATUS.ACTIVE,
    notes: cls.note || '',
    description: env.subject
  };

  if (cls.type === TXN_TYPE.REFUND) {
    var link = linkRefund_(idx, candidate);
    candidate.notes = joinNotes_(candidate.notes, link.note);
    if (!link.matched) {
      pushReview_(toReview, idx, {
        reviewId: makeReviewId_(env.id, REVIEW_REASON.AMBIGUOUS_TYPE),
        date: txn.date, account: account.id, amount: txn.amount, merchant: txn.merchant,
        reason: REVIEW_REASON.AMBIGUOUS_TYPE, emailId: env.id, raw: txn.raw,
        detail: link.note
      });
    }
  }

  if (cls.reviewReason) {
    candidate.status = TXN_STATUS.NEEDS_REVIEW;
    pushReview_(toReview, idx, {
      reviewId: makeReviewId_(env.id, cls.reviewReason),
      date: txn.date, account: account.id, amount: txn.amount, merchant: txn.merchant,
      reason: cls.reviewReason, emailId: env.id, raw: txn.raw,
      detail: cls.note
    });
  }

  // ---- 5. Categorise --------------------------------------------------------
  var cat = categorise_(txn.merchant, txn.raw);
  candidate.category = cat.category;
  candidate.subcategory = cat.subcategory;
  if (cat.matchedOn === 'default' && flagUncategorised) {
    pushReview_(toReview, idx, {
      reviewId: makeReviewId_(env.id, REVIEW_REASON.AMBIGUOUS_CAT),
      date: txn.date, account: account.id, amount: txn.amount, merchant: txn.merchant,
      reason: REVIEW_REASON.AMBIGUOUS_CAT, emailId: env.id, raw: txn.raw,
      detail: 'No keyword in Categories matched "' + txn.merchant + '"; used default category.'
    });
  }

  // ---- 6. Soft duplicate ----------------------------------------------------
  var soft = softDuplicateCheck_(idx, candidate, c.dupWindowDays);
  if (soft) {
    pushReview_(toReview, idx, {
      reviewId: makeReviewId_(env.id, REVIEW_REASON.POSSIBLE_DUP),
      date: txn.date, account: account.id, amount: txn.amount, merchant: txn.merchant,
      reason: REVIEW_REASON.POSSIBLE_DUP, emailId: env.id, raw: txn.raw,
      detail: 'Same account and same signed amount as ' + soft.txnId + ' (' + soft.merchant
            + ') within ' + c.dupWindowDays + ' days. Not merged and not discarded — confirm or delete one.'
    });
    candidate.status = TXN_STATUS.NEEDS_REVIEW;
    candidate.notes = joinNotes_(candidate.notes, 'Possible duplicate of ' + soft.txnId + '.');

    // "review-only" holds the row out of the ledger entirely. The default,
    // "flag-and-insert", keeps it — a possible duplicate overstates spending,
    // which is the safe direction to be wrong in for a safe-to-spend number,
    // whereas dropping a real transaction understates it.
    if (c.dupHandling === 'review-only') {
      stats.duplicates++;
      return;
    }
  }

  toInsert.push(candidate);
  indexNewTransaction_(idx, ident.id, env.id, candidate);
}

/** Queues a review item unless this (email, reason) pair is already queued. */
function pushReview_(list, idx, item) {
  var key = (item.emailId || '') + '|' + item.reason;
  if (idx.reviewEmailIds[key]) return;
  idx.reviewEmailIds[key] = true;
  list.push(item);
}

function joinNotes_(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a + ' ' + b;
}
