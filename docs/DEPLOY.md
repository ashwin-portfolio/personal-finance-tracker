# Deployment — Steps 1, 2, 3 and 10

Each step is gated on the one before it. The gates are the point; skipping one puts unvalidated
rows into a ledger you are going to make spending decisions from.

---

## Step 1 — Gmail label and filters

1. Gmail → Settings → Labels → **Create new label**: `BankAlerts`.
   (If you pick a different name, set `Gmail Label` in the Settings tab to match. A name with a
   space becomes a hyphen in Gmail search; the code handles that.)
2. The real senders are already known — they were read from the mailbox, not guessed:

   | Account | Sender Rule | Parser |
   |---|---|---|
   | HDFC credit card | `alerts@hdfcbank.bank.in` | `HDFC_CC` |
   | HDFC UPI / savings | `alerts@hdfcbank.bank.in` | `HDFC_UPI` |
   | SBI credit card | `onlinesbicard@sbicard.com` | `SBI_CC` |

   Note that HDFC uses **one sender for all three** of its alert types, so the `Sender Rule` alone
   cannot tell a card alert from a UPI alert. Leave `Parser` blank on the HDFC rows and let the body
   sniffing pick — the `requires` signatures distinguish them reliably. Fill in `Last 4 Digits` for
   each HDFC row from your own card and account numbers, so a message can still be attributed when
   two HDFC accounts both match the sender.
3. For each sender: three dots → **Filter messages like these** → *Create filter* →
   **Apply the label: BankAlerts**. Tick *Also apply filter to matching conversations* to backfill.
4. Put the sender into the `Accounts` tab, `Sender Rule` column. The rule is matched as a
   **case-insensitive substring** of the From header, so `alerts@hdfcbank.bank.in` works and so does
   `hdfcbank.bank.in`.
5. Set `Parser` to `SBI_CC` on the SBI row. Leave it blank on the HDFC rows — one sender covers
   card, UPI and savings alerts there, so a fixed parser would mis-route two of the three.
6. If two accounts share a sender (two HDFC cards, say), fill in `Last 4 Digits` for both.
   Without it the message is reported ambiguous and sent to review rather than guessed onto a card.

**Gate:** several real HDFC, UPI and SBI emails visible under the label.

**Do not filter on subject.** The label must catch the OTP, declined and promo mail too — the parser
drops those deliberately (`REJECT_SIGNATURES`), and it is better to see them dropped in the dry-run
log than to discover later that a filter was silently hiding a format you needed.

---

## Step 2 — Duplicate the workbook

File → Make a copy. Name it something like `finance_tracker (DEV)`.

Do every remaining step in the copy. Only after Step 9 passes there do you repeat the deployment
against the real workbook. Test emails must never reach the real `Transactions` tab.

---

## Step 3 — Bind the script, dry-run only

1. In the **dev** workbook: Extensions → **Apps Script**.
2. Create one file per `apps-script/*.gs` (File → + → Script) and paste the contents.
   `Sidebar.html` is File → + → **HTML**, named `Sidebar` — Apps Script adds the extension.
3. Project Settings → tick **Show "appsscript.json" manifest file in editor**, then replace its
   contents with `apps-script/appsscript.json`. This is what pins the scopes to read-only Gmail.
4. Reload the spreadsheet tab. A **Finance Sync** menu appears.
5. **Finance Sync → Verify workbook schema.** Fix everything it reports before going further —
   either rename the sheet column or edit the `SCHEMA` block in `00_Config.gs` to match reality.
   Optional columns reported as missing are fine to leave alone.
6. **Finance Sync → Run tests.** 57 assertions, no writes. All should pass.
7. **Finance Sync → Dry run — entire label.** Authorise the scopes when prompted (you will see a
   Gmail read-only consent screen; there is no send or delete permission to grant).
8. Extensions → Apps Script → **Executions** → open the run → read the log.

**Gate:** dry-run output shows the right amount, merchant, date and account for several real emails,
for at least one bank.

### Iterating on the parsers (Step 4)

The dry-run log tells you which messages failed and why. To work on one message at a time, paste a
redacted body into `previewParse()` in `13_TestHarness.gs` and run just that function — it prints
the parse result and the classification without going near Gmail or the ledger.

Edit only the `PATTERNS` block at the top of `04_Parsers.gs`. If you find yourself editing the
engine below it, something is probably wrong with the pattern instead.

---

## Steps 5–9 — validated by running, not by configuring

Once dry run looks right for a bank:

- **Finance Sync → Run Sync Now** (dev workbook). Confirm the dialog.
- Check `Transactions`, `Review Queue` and `Sync Logs`.
- **Run it again immediately.** The second run must add **zero** transaction rows and **zero**
  review rows. That is the Step 5 gate, and it is the single most important thing to verify.
- Put a junk email under the label and run again — it should produce one `Unparsed` review row and
  not disturb anything else.

---

## Step 10 — the trigger

Only after all of the above, and after repeating the deployment against the real workbook.

1. Add `Automation Enabled` to the `Settings` tab with value `FALSE`.
2. **Finance Sync → Automation → Install 15-min trigger.** It refuses to create a second trigger if
   one already exists, and repairs the situation if it finds several.
3. **Finance Sync → Automation → Status** — confirm exactly one trigger.
4. Watch `Sync Logs` for a couple of fires. With the switch off, the trigger fires and exits without
   doing anything, which is what you want to see first.
5. Set `Automation Enabled` to `TRUE`.

**The kill switch is the Settings cell, not the trigger.** Setting it to `FALSE` stops all importing
on the next fire, from the Sheet, with no script editor access needed.

---

## Settings keys the code reads

Absent keys fall back to the default, so you only need the ones you want to change.

| Key | Default | Meaning |
|---|---|---|
| `Gmail Label` | `BankAlerts` | Label to scan |
| `Processing Interval` | `15` | Trigger interval; snapped to 1/5/10/15/30 |
| `Duplicate Review Window (days)` | `3` | Soft duplicate window |
| `Default Category` | `Uncategorised` | Used when no keyword matches |
| `Automation Enabled` | `FALSE` | Kill switch, checked every fire |
| `Duplicate Handling` | `flag-and-insert` | or `review-only` — see below |
| `Lookback Overlap (days)` | `2` | How far back of already-seen mail to re-examine |
| `Max Messages Per Run` | `100` | Guard against execution timeouts |
| `Base Currency` | `INR` | Written to the Currency column |
| `Refund Match Window (days)` | `45` | How far back to look for the purchase a refund reverses |
| `Self Transfer VPAs` | *(empty)* | Comma-separated list of your own UPI handles |
| `Flag Uncategorised For Review` | `FALSE` | Raise a review row when nothing matched |

### `Duplicate Handling` — the one judgement call worth knowing about

The PRP asks for two things that pull against each other: possible duplicates go to Review Queue
(Addendum §4.1), and two legitimate same-amount same-day purchases must both survive (Orig §17).

The default, `flag-and-insert`, resolves it by **keeping the row** (Status `Needs Review`, a note
naming the suspected twin) **and** raising a Review Queue entry. Nothing is merged and nothing is
discarded, which is what §4.1 actually forbids.

The reasoning: a duplicate that stays in overstates your spending, so you under-spend until you
review it. A real transaction held out of the ledger understates it, so you over-spend. For a
safe-to-spend number, over-stating is the safe direction to be wrong in.

If you would rather hold suspected duplicates out of the ledger entirely, set `Duplicate Handling`
to `review-only`.
