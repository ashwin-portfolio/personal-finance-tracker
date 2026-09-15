# Finance Tracker — Gmail → Google Sheets sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Tests](https://github.com/ashwin-portfolio/personal-finance-tracker/actions/workflows/tests.yml/badge.svg)](https://github.com/ashwin-portfolio/personal-finance-tracker/actions/workflows/tests.yml)

Apps Script implementation of Phases 2–5 of the Automated Personal Finance Tracker PRP.
It feeds the `Transactions` tab of an existing `finance_tracker.xlsx` / Google Sheet.
It does not touch the Dashboard, Budget, or Safe-to-Spend layer — those are already built.

## Where each PRP step stands

| Step | What it is | Status |
|---|---|---|
| 1 | Gmail label + filters | **You do this in the browser.** See [docs/DEPLOY.md](docs/DEPLOY.md). |
| 2 | Duplicate the workbook for dev | **You do this.** Non-negotiable — nothing here should first run against the real ledger. |
| 3 | Apps Script project, dry-run only | Built — `runDryRun()` / `runFullDryRun()`. Writes to no tab at all. |
| 4 | Parsers, HDFC → UPI → SBI | Validated against real alert mail (Sep 2026) and covered by fixtures. Not yet confirmed by a live dry run. |
| 5 | Transaction ID + deduplication | Built and unit-tested — `05_Dedup.gs`. |
| 6 | Categorisation | Built and unit-tested — `06_Categorize.gs`. |
| 7 | Manual "Run Sync Now" | Built — Finance Sync menu, with a confirm dialog. |
| 8 | Failure isolation | Built — per-message try/catch in `10_Pipeline.gs`. |
| 9 | Sync Logs | Built — one row per run, including crashed runs. |
| 10 | Time trigger + kill switch | Built — `11_Triggers.gs`, duplicate-trigger safe, gated on `Automation Enabled`. |
| 11 | Refunds / CC payments / Self-Transfer | Built and unit-tested — `07_Classify.gs`. Needs real history to validate. |
| 12 | Audit Log | Built — deliberate sidebar workflow, not an `onEdit` guess. |

## Parser status

Patterns are written against real alert mail observed in the mailbox (Sep 2026), with redacted
fixtures in `13_TestHarness.gs` locking each format down.

| Source | Sender | Shape |
|---|---|---|
| HDFC credit card | `alerts@hdfcbank.bank.in` | `Rs. N has been debited ... towards MERCHANT on DD Mon, YYYY at HH:MM:SS` |
| HDFC UPI | `alerts@hdfcbank.bank.in` | `Rs.N is debited ... towards VPA handle@psp (MERCHANT) on DD-MM-YY` + `UPI transaction reference no.: N` |
| HDFC debit card | `alerts@hdfcbank.bank.in` | `Thank you for using your ... Debit Card ending NNNN for Rs N at MERCHANT on DD-MM-YYYY` (and an ATM variant) |
| HDFC savings credit | `alerts@hdfcbank.bank.in` | `Rs.N ... credited to your ... account` + `Sender: NAME (VPA: handle)` + `UPI Reference No.: N` |
| SBI Card | `onlinesbicard@sbicard.com` | `Rs.N spent on your SBI Credit Card ending NNNN at MERCHANT on DD/MM/YY` |
| CRED bill payment | `from@cred.club` | HTML table: `amount paid  Rs.N` / `payment date  Mon DD, YYYY` / `UTR No.: ...` |

HDFC UPI, HDFC savings credits and CRED carry a reference number, so those reach tier-1 identity.
HDFC CC, HDFC debit card and SBI CC carry none and fall to the Gmail message ID (tier 2).

`HDFC_SAV_CREDIT` is deliberately listed **before** `HDFC_UPI`: both savings-credit forms contain
the word VPA, so the UPI parser would otherwise claim them and then fail to find an amount, because
its patterns expect `is debited` / `has been credited` rather than `is successfully credited`.

CRED needs three things the bank parsers do not:

- The amount anchors on **`amount paid`**. The same mail also prints the statement bill amount
  further down under `latest statement`, and the two are equal only when you pay the bill in full.
- The date is **month-first** (`Sep 04, 2026`). No bank alert here writes dates that way.
- The UTR is **35 alphanumeric characters**, past the 25-char cap the generic reference patterns use.

A CRED confirmation is classified `CC Payment` and excluded from spending on the card side, per
Orig §10 — paying a bill is not income and not negative spending.

### Rejection is load-bearing, not an optimisation

A bank's transaction alert, its OTP mail, and its declined-transaction notice all carry an amount,
a merchant and a card number, and all arrive from the same sender. Matching on "has an amount and a
merchant" books all three. Two cases observed directly in this mailbox:

- An **OTP** mail for `INR 3798.00 at SAMPLE MERCH` arrives minutes before the genuine SAMPLE MERCH alert
  for the same 3798.00. Parsing both doubles the spend.
- A **declined** `Rs. 9390.00` alert sits alongside a **successful** `Rs. 9390.00` retry on the same
  card the same day. Parsing both doubles the spend.

`REJECT_SIGNATURES` in `04_Parsers.gs` drops OTP, declined, EMI promo, statement, rewards, card-control
and marketing mail before parser selection. Dropped mail is logged and discarded rather than queued
— a promo is not something a human needs to adjudicate.

The EMI promos also forced a change to the amount guard: HDFC writes both `Outstanding of Rs. 30682`
and `Rs.30682 Outstanding Amount`, so poison words are now checked on **both** sides of a candidate.

### Accounts may list several senders

One card is alerted by its own bank **and** by whatever app you pay the bill through. `Sender Rule`
therefore accepts a comma-separated list, and all of them resolve to the same account:

```
Account ID      SBI-CC
Sender Rule     onlinesbicard@sbicard.com, from@cred.club
Last 4 Digits   4444
```

`Last 4 Digits` is a list too, and it is what actually decides attribution when a sender is shared.
HDFC alerts every product — credit card, debit card, UPI, savings — from **one** address, so the
sender alone can never say which account a message belongs to. One account also answers to more than
one number: your savings account is named by its account number in UPI alerts and by its **debit
card** number in card alerts. Both go on the same row:

```
Account ID      UPI-SAV
Sender Rule     alerts@hdfcbank.bank.in
Last 4 Digits   2222, 3333
```

Without the second value every debit-card alert is ambiguous between the card account and the
savings account, and lands in the Review Queue instead of the ledger. A message that genuinely
cannot be attributed is still reported ambiguous rather than guessed onto whichever row is first.

### Still unhandled

- **SBI savings / debit alerts** do not appear to arrive by email at all — only marketing and
  monthly statements. If you want those in the ledger, email is not the channel.

### One thing to watch on the funding side

A CRED payment moves money out of a bank account and into a card. This project books the card side
from the CRED mail. If the funding account also emails an alert for that outgoing payment, it would
be counted as spending, double-counting the bill.

No such alert was found for the observed payment, so nothing is done about it today. If one does
show up, add the CRED collection handle to `Self Transfer VPAs` in Settings — that excludes the
funding leg without touching the card leg.

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
  13_TestHarness.gs   100 offline tests incl. real-format fixtures + previewParse()
  99_Menu.gs          the Finance Sync menu
  Sidebar.html        correction UI
docs/
  DEPLOY.md           Steps 1–3 and 10, in order
  SAMPLE-EMAILS.md    how to redact and hand over samples to unblock Step 4
scripts/
  run-tests.js        runs the suite outside Google, no dependencies
.github/workflows/
  tests.yml           CI — the same suite on every push and PR
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

`runTests()` (Finance Sync → Run tests) runs 100 offline assertions against the pure logic,
including end-to-end parses of every real alert format and every rejection case. It touches no tab
and needs no Gmail access, so it is safe in the real workbook. All 100 pass as shipped.

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

The same command runs in CI on every push and pull request to `main`
(`.github/workflows/tests.yml`). The runner exits non-zero when any assertion fails, and it loads
every `.gs` file into one VM context first — so a syntax error anywhere fails the build before a
single assertion runs. There are no dependencies to install.

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
