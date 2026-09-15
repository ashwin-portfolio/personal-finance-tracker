/**
 * 11_Triggers.gs — time-driven trigger management.
 *
 * Two independent safety layers, because either alone is insufficient:
 *
 *   1. installSyncTrigger_() refuses to create a second trigger for the same
 *      handler (Orig §14). Re-running setup is otherwise the classic way to end
 *      up with four triggers all importing the same emails.
 *   2. runScheduledSync() re-reads Automation Enabled from Settings on every
 *      fire. The kill switch therefore works from the Sheet, with no access to
 *      the script editor and no deployment step.
 */

var SYNC_HANDLER = 'runScheduledSync';

function listSyncTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === SYNC_HANDLER;
  });
}

/**
 * Creates the trigger if and only if none exists. Returns a status string.
 * Does NOT flip Automation Enabled — arming the schedule and enabling the work
 * are deliberately separate decisions.
 */
function installSyncTrigger() {
  var existing = listSyncTriggers_();
  if (existing.length > 1) {
    // Repair a previously duplicated setup rather than adding to the pile.
    for (var i = 1; i < existing.length; i++) ScriptApp.deleteTrigger(existing[i]);
    return 'Found ' + existing.length + ' triggers for ' + SYNC_HANDLER
         + '; removed ' + (existing.length - 1) + ' and kept one.';
  }
  if (existing.length === 1) {
    return 'Trigger already installed — nothing to do.';
  }

  var minutes = normaliseInterval_(cfg_().intervalMinutes);
  ScriptApp.newTrigger(SYNC_HANDLER).timeBased().everyMinutes(minutes).create();

  var armed = cfg_().automationOn;
  return 'Trigger installed, every ' + minutes + ' minutes. '
       + (armed
          ? 'Automation Enabled is TRUE — it will start importing on the next fire.'
          : 'Automation Enabled is FALSE — it will fire and exit immediately until you set it TRUE.');
}

function removeSyncTrigger() {
  var existing = listSyncTriggers_();
  for (var i = 0; i < existing.length; i++) ScriptApp.deleteTrigger(existing[i]);
  return 'Removed ' + existing.length + ' trigger(s).';
}

/** Apps Script only accepts 1, 5, 10, 15 or 30 minutes. Snap to the nearest. */
function normaliseInterval_(requested) {
  var allowed = [1, 5, 10, 15, 30];
  var n = Number(requested) || 15;
  var best = allowed[0];
  var bestGap = Infinity;
  for (var i = 0; i < allowed.length; i++) {
    var gap = Math.abs(allowed[i] - n);
    if (gap < bestGap) { bestGap = gap; best = allowed[i]; }
  }
  return best;
}

/** Reports trigger + kill switch state in one line, for the menu. */
function triggerStatus() {
  var triggers = listSyncTriggers_();
  var c = cfg_();
  var lastRun = PropertiesService.getScriptProperties().getProperty(PROP.LAST_RUN_EPOCH);
  return 'Triggers for ' + SYNC_HANDLER + ': ' + triggers.length + '\n'
       + 'Automation Enabled (Settings): ' + c.automationOn + '\n'
       + 'Configured interval: ' + c.intervalMinutes + ' min (snapped to ' + normaliseInterval_(c.intervalMinutes) + ')\n'
       + 'Gmail label: ' + c.label + '\n'
       + 'Duplicate handling: ' + c.dupHandling + '\n'
       + 'Last completed run: ' + (lastRun ? new Date(Number(lastRun) * 1000) : '(never)');
}
