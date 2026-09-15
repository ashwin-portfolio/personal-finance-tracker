# Unblocking Step 4 — handing over sample emails

Step 4 is the only part of this PRP that cannot be finished without real data. Regex written against
a remembered email format is a guess; regex written against three real ones is a parser.

## What to send

**Three or more emails per bank**, ideally covering different shapes:

| Shape | Why it matters |
|---|---|
| An ordinary purchase | The baseline. |
| A purchase where the body also states a limit or available balance | This is what the amount poison-guard exists for. |
| A refund or reversal | Drives the credit/debit direction logic. |
| A credit card bill payment confirmation | Must be classified `CC Payment`, not income. |
| A UPI payment to a person (not a merchant) | VPA extraction differs from merchant-name extraction. |
| A declined or failed transaction alert, if you get them | These must **not** become ledger rows. |

## How to redact

Get the plain text, not a screenshot — the parser works on text, and a screenshot cannot be tested
against.

In Gmail: open the message → three dots → **Show original** → *Download Original*, or just copy the
rendered body. Then replace, keeping the **shape** intact:

| Replace | With | Why keep the shape |
|---|---|---|
| Card last 4 digits | `1234` | Length matters — the code matches on it |
| Account number | `XX5678` | Same |
| Reference / UTR / RRN | Same-length digits, e.g. `123456789012` | Length gates the tier-1 ID rule |
| Your name | `Customer` | |
| Your UPI handle | `you@bank` | Keep the `@` and the handle format |
| Your email / phone | `you@example.com` / `9999999999` | |

**Keep exactly as-is:** the amount formatting (`Rs 1,250.00` vs `INR 1250` vs `₹1,250.00`), the date
format, the merchant name, the word order, the punctuation, and the `From:` address. Those are the
things being parsed. Changing `Rs.` to `Rs` or `05-09-2025` to `2025-09-05` will produce a parser
that works on your redacted sample and fails on real mail.

Amounts themselves can be changed freely — just keep the separator and decimal style.

## Format to hand them over in

One block per email, plain text:

```
--- SAMPLE 1 ---
BANK: HDFC
TYPE: purchase
FROM: alerts@hdfcbank.net
SUBJECT: Alert : Update on your HDFC Bank Credit Card

Dear Customer,
Thank you for using your HDFC Bank Credit Card ending 1234 for Rs 1,250.00 at
BLUE TOKAI COFFEE on 05-09-2025 19:42:11.
Your available credit limit is Rs 1,48,750.00.
Reference No: 123456789012
--- END ---
```

## What happens next

Each sample becomes a fixture in `13_TestHarness.gs`, so the patterns are locked down by tests that
fail loudly when a bank changes its email template — which they do, usually without warning.

Priority order is HDFC → UPI → SBI, per the PRP. **SBI matters most**: the HDFC and UPI patterns at
least started from a working MIT-licensed implementation, whereas the SBI ones are pure guesswork
and should be assumed wrong until proven otherwise.
