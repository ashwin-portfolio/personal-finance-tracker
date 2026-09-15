/**
 * 09_SyncLog.gs — one row per run, always.
 *
 * A run that crashes still logs. The Dashboard's "Last Successful Sync" cell
 * reads this tab, and a silently-absent row is indistinguishable from "the
 * trigger never fired" — which is precisely the failure mode that makes an
 * automated ledger untrustworthy.
 */

function newRunStats_(triggerType) {
  return {
    runId: 'RUN-' + Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata', 'yyyyMMdd-HHmmss')
           + '-' + Utilities.getUuid().slice(0, 4),
    startedAt: new Date(),
    triggerType: triggerType,
    scanned: 0,
    imported: 0,
    duplicates: 0,
    review: 0,
    errors: 0,
    ignored: 0,
    status: 'Running',
    errorMessage: ''
  };
}

function writeSyncLog_(stats, dryRun) {
  stats.finishedAt = new Date();

  var row = {
    'Run ID':             stats.runId,
    'Started At':         stats.startedAt,
    'Finished At':        stats.finishedAt,
    'Trigger Type':       stats.triggerType,
    'Emails Scanned':     stats.scanned,
    'Imported':           stats.imported,
    'Duplicates Skipped': stats.duplicates,
    'Sent To Review':     stats.review,
    'Parsing Errors':     stats.errors,
    'Status':             stats.status,
    'Error Message':      String(stats.errorMessage || '').slice(0, 1000),
    'Ignored':            stats.ignored
  };

  if (dryRun) {
    Logger.log('[DRY RUN] sync log row: ' + JSON.stringify(row, function (k, v) {
      return (v instanceof Date) ? v.toISOString() : v;
    }));
    return;
  }

  try {
    appendRow_(TAB.SYNC_LOGS, row);
  } catch (e) {
    // Losing the log must not lose the run. Surface it in the execution log at
    // minimum, so a broken Sync Logs tab is diagnosable.
    Logger.log('FAILED to write Sync Logs row: ' + e.message + ' | intended: ' + JSON.stringify(row));
  }
}

/** Human-readable one-line summary, reused by the menu toasts. */
function summarise_(stats) {
  return stats.status + ' — scanned ' + stats.scanned
       + ', imported ' + stats.imported
       + ', duplicates ' + stats.duplicates
       + ', to review ' + stats.review
       + ', errors ' + stats.errors
       + ', ignored ' + stats.ignored;
}
