# Finance Tracker — Gmail → Google Sheets sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Tests](https://img.shields.io/badge/tests-34%20passing-brightgreen)](scripts/run-tests.js)

Apps Script implementation of Phases 2–5 of the Automated Personal Finance Tracker PRP.
It feeds the `Transactions` tab of an existing `finance_tracker.xlsx` / Google Sheet.
It does not touch the Dashboard, Budget, or Safe-to-Spend layer — those are already built.

## Where each PRP step stands

| Step | What it is | Status |
|---|---|---|
| 1 | Gmail label + filters | **You do this in the browser.** See [docs/DEPLOY.md](docs/DEPLOY.md). |
| 2 | Duplicate the workbook for dev | **You do this.** Non-negotiable — nothing here should first run against the real ledger. |
| 3 | Apps Script project, dry-run only | Built — `runDryRun()` / `runFullDryRun()`. Writes to no tab at all. |
| 4 | Parsers, HDFC → UPI → SBI | **Drafts only, blocked on real sample emails.** See below. |
| 5 | Transaction ID + deduplication | Built and unit-tested — `05_Dedup.gs`. |
| 6 | Categorisation | Built and unit-tested — `06_Categorize.gs`. |
| 7 | Manual "Run Sync Now" | Built — Finance Sync menu, with a confirm dialog. |
| 8 | Failure isolation | Built — per-message try/catch in `10_Pipeline.gs`. |
| 9 | Sync Logs | Built — one row per run, including crashed runs. |
| 10 | Time trigger + kill switch | Built — `11_Triggers.gs`, duplicate-trigger safe, gated on `Automation Enabled`. |
| 11 | Refunds / CC payments / Self-Transfer | Built and unit-tested — `07_Classify.gs`. Needs real history to validate. |
| 12 | Audit Log | Built — deliberate sidebar workflow, not an `onEdit` guess. |

## Step 4 is the only real blocker

The patterns in `04_Parsers.gs` are **hypotheses, not validated parsers**:

- **HDFC CC / HDFC UPI** — shaped after `passbook` (MIT) and the common structure of Indian bank alert mail.
- **SBI CC** — entirely net-new. Neither source repo had a reference implementation, so these are the weakest patterns in the file.

To finish Step 4, hand over redacted real emails using the format in
[docs/SAMPLE-EMAILS.md](docs/SAMPLE-EMAILS.md). Everything that needs to change lives in the
`PATTERNS` block at the top of `04_Parsers.gs`; the extraction engine below it is bank-agnostic.

## Read this before your first run

`00_Config.gs` declares the column headers the code expects on every tab. Those lists were written
**without sight of the actual workbook**, so they are informed guesses. The first thing to run is
**Finance Sync → Verify workbook schema**, which diffs the expectation against the live sheet and
reports every mismatch. The pipeline refuses to write until that passes, so a wrong guess here
produces a clear error rather than a corrupted ledger.

Nothing addresses a column by letter or index — every read and write goes through a header map — so
reordering columns in the Sheet is safe.

## Files

```
apps-script/
  appsscript.json     manifest — least-privilege scopes (gmail.readonly, no send/modify)
  00_Config.gs        tab names, expected headers, settings defaults, vocabularies
  01_Schema.gs        header-name column access + verifySchema()
  02_Settings.gs      Settings tab as a key/value store
  03_GmailIngest.gs   label scan, HTML→text, account matching
  04_Parsers.gs       PATTERNS block + bank-agnostic extraction engine
  05_Dedup.gs         tiered transaction IDs + ledger index + soft duplicate window
  06_Categorize.gs    longest-keyword-wins categorisation
  07_Classify.gs      Debit/Refund/CC Payment/Self-Transfer + refund linking
  08_Ledger.gs        the only two functions that write rows
  09_SyncLog.gs       one row per run, always
  10_Pipeline.gs      orchestration + entry points + failure isolation
  11_Triggers.gs      trigger install/remove, duplicate-safe
  12_AuditLog.gs      deliberate correction workflow
  13_TestHarness.gs   34 offline tests + previewParse() for Step 4 iteration
  99_Menu.gs          the Finance Sync menu
  Sidebar.html        correction UI
docs/
  DEPLOY.md           Steps 1–3 and 10, in order
  SAMPLE-EMAILS.md    how to redact and hand over samples to unblock Step 4
```

## Constraints this honours

- Gmail scope is `gmail.readonly` only — no send, no modify, no delete.
- No bank credentials, no OTPs, no unofficial bank APIs.
- No external AI or third-party API calls anywhere in the code.
- No hosted third-party Apps Script deployment — you deploy your own copy.
- No code copied from the unlicensed `Ledger` repo; only reimplemented behaviour.
- `message.isUnread()` is never used as a processing condition. Incremental scanning uses Gmail's
  `after:` operator against the last completed run, rewound by `Lookback Overlap (days)`, with the
  resulting re-reads discarded by stable ID.
- Nothing uncertain is silently inserted. Unparsed, unsupported, ambiguous-type and possible-duplicate
  cases all produce a Review Queue row.

## Testing

`runTests()` (Finance Sync → Run tests) runs 34 offline assertions against the pure logic. It
touches no tab and needs no Gmail access, so it is safe in the real workbook. All 34 pass as shipped.

Mapping to the PRP §6 acceptance tests:

| PRP §6 requirement | Covered by |
|---|---|
| Same email twice → zero duplicate rows | `testIdentity_` ("same email twice → identical ID") + the hard-ID check in `processMessage_`. Confirm live by running the sync twice. |
| Two legitimate same-amount same-day purchases → both retained | `testIdentity_` ("different emails → different IDs"). The soft check flags the coincidence in Review Queue without removing either row. |
| Missing merchant / reference → Review Queue, not guessed | `parseMessage_` returns `{ok:false}` when merchant extraction fails; `testAmountExtraction_` covers the amount side. |
| Manual correction not overwritten by next sync | Corrected rows are already in the ledger index by Transaction ID, so the source email is a hard duplicate on every later run. Confirm live after Step 7. |
| One malformed email in ten → other nine still process | Per-message try/catch in `10_Pipeline.gs`. Confirm live by putting a junk email under the label. |

The last three rows need a live run to confirm end-to-end; the unit tests cover the logic underneath them.

To run the tests outside Google (syntax check + full suite under Node):

```bash
node scripts/run-tests.js apps-script
```

## Licence and attribution

This project is MIT licensed — see [LICENSE](LICENSE).

**Third-party work this draws on:**

- **passbook** (MIT) — the HDFC credit-card and UPI patterns in
  `04_Parsers.gs` are shaped after its parsers. MIT permits this; if you copy its parser source
  verbatim rather than adapting the shape, preserve its copyright notice alongside this one.
- **Ledger / vickeyshetty** — **no licence file, so no code was taken.** Only the documented
  *behaviour* was reimplemented from scratch in fresh Apps Script. Do not copy source from that
  repository into this one.

No bank is affiliated with or endorses this project. Bank names appear only as the subjects of
email-format parsing.
