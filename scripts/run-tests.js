// Offline runner: loads the .gs files into one context with minimal Apps Script
// stubs, then runs runTests(). Verifies the pure logic without a Google account.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = process.argv[2];
const files = [
  '00_Config.gs', '01_Schema.gs', '02_Settings.gs', '03_GmailIngest.gs',
  '04_Parsers.gs', '05_Dedup.gs', '06_Categorize.gs', '07_Classify.gs',
  '08_Ledger.gs', '09_SyncLog.gs', '10_Pipeline.gs', '11_Triggers.gs',
  '12_AuditLog.gs', '13_TestHarness.gs', '99_Menu.gs'
];

const out = [];
const sandbox = {
  Logger: { log: (m) => out.push(String(m)) },
  Utilities: {
    getUuid: () => 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    formatDate: (d, tz, fmt) => {
      const p = (n, w = 2) => String(n).padStart(w, '0');
      return fmt
        .replace('yyyy', d.getFullYear())
        .replace('MMdd', p(d.getMonth() + 1) + p(d.getDate()))
        .replace('MM', p(d.getMonth() + 1))
        .replace('dd', p(d.getDate()))
        .replace('HHmmss', p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()))
        .replace('HH:mm:ss', p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()));
    }
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Asia/Kolkata' }),
    getUi: () => { throw new Error('no UI offline'); }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, deleteProperty: () => {}
    })
  },
  Session: { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) },
  console
};
vm.createContext(sandbox);

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    vm.runInContext(src, sandbox, { filename: f });
  } catch (e) {
    console.log('SYNTAX ERROR in ' + f + ': ' + e.message);
    process.exit(1);
  }
}
console.log('All ' + files.length + ' files parsed without syntax errors.\n');

const res = vm.runInContext('runTests()', sandbox);
console.log(out.join('\n'));
process.exit(res.fail === 0 ? 0 : 1);
