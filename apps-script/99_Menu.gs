/**
 * 99_Menu.gs — the Sheet-side control surface.
 *
 * Deliberately ordered so that the safe actions sit above the ones that write,
 * and the trigger controls sit in a submenu you have to mean to open.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Finance Sync')
    .addItem('Verify workbook schema', 'menuVerifySchema')
    .addItem('Run tests (no writes)', 'menuRunTests')
    .addSeparator()
    .addItem('Dry run — recent mail', 'menuDryRun')
    .addItem('Dry run — entire label', 'menuFullDryRun')
    .addSeparator()
    .addItem('Run Sync Now', 'menuRunSyncNow')
    .addItem('Correct a transaction…', 'showCorrectionSidebar')
    .addSeparator()
    .addSubMenu(ui.createMenu('Automation')
      .addItem('Status', 'menuTriggerStatus')
      .addItem('Install 15-min trigger', 'menuInstallTrigger')
      .addItem('Remove trigger', 'menuRemoveTrigger'))
    .addToUi();
}

function menuVerifySchema() {
  var v = verifySchema();
  alert_(v.ok ? 'Schema OK' : 'Schema problems', v.report);
}

function menuRunTests() {
  var r = runTests();
  alert_(r.fail === 0 ? 'All tests passed' : r.fail + ' test(s) failed', r.report);
}

function menuDryRun() {
  var s = runDryRun();
  alert_('Dry run complete (nothing was written)',
         summarise_(s) + '\n\nOpen Extensions → Apps Script → Executions to read the full log.');
}

function menuFullDryRun() {
  var s = runFullDryRun();
  alert_('Full dry run complete (nothing was written)',
         summarise_(s) + '\n\nOpen Extensions → Apps Script → Executions to read the full log.');
}

function menuRunSyncNow() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert('Run sync now?',
    'This writes to Transactions and Review Queue. Have you validated the parsers in dry run first?',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;
  var s = runSyncNow();
  alert_('Sync complete', summarise_(s));
}

function menuTriggerStatus() {
  alert_('Automation status', triggerStatus());
}

function menuInstallTrigger() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert('Install the time-driven trigger?',
    'Only do this after Steps 1–9 are validated.\n\n'
    + 'The trigger still checks "Automation Enabled" in Settings on every fire, '
    + 'so it stays inert until you set that to TRUE.',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;
  alert_('Trigger', installSyncTrigger());
}

function menuRemoveTrigger() {
  alert_('Trigger', removeSyncTrigger());
}

function alert_(title, body) {
  try {
    SpreadsheetApp.getUi().alert(title, String(body).slice(0, 4000), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(title + '\n' + body);
  }
}
