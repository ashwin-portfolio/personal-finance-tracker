// Scriptable widget for the finance tracker.
//
// Setup:
//   1. Install Scriptable (free, App Store).
//   2. Deploy the Apps Script project as a web app (see apps-script/14_WebApp.gs).
//   3. Paste this file into a new Scriptable script named "Finance".
//   4. Fill in ENDPOINT and TOKEN below.
//   5. Home screen > long press > + > Scriptable > pick size > choose "Finance".
//
// Small widget  = safe-to-spend per day.
// Medium widget = spend against budget, plus the top categories.

const ENDPOINT = "PASTE_YOUR_WEB_APP_URL_HERE";   // ends in /exec
const TOKEN = "PASTE_YOUR_WIDGET_TOKEN_HERE";     // must match the Settings tab
const SHEET_URL = "";                             // optional: tap widget to open the sheet

const FG = Color.dynamic(new Color("#1f2937"), new Color("#f3f4f6"));
const MUTED = Color.dynamic(new Color("#6b7280"), new Color("#9ca3af"));
const OK = new Color("#16a34a");
const WARN = new Color("#dc2626");

async function fetchData() {
  const req = new Request(`${ENDPOINT}?token=${encodeURIComponent(TOKEN)}`);
  req.timeoutInterval = 15;
  return await req.loadJSON();
}

function money(n, currency) {
  const symbol = currency === "INR" ? "₹" : "";
  return symbol + Math.round(n).toLocaleString("en-IN");
}

function errorWidget(message) {
  const w = new ListWidget();
  const t = w.addText("Finance");
  t.font = Font.semiboldSystemFont(13);
  t.textColor = MUTED;
  w.addSpacer(4);
  const m = w.addText(message);
  m.font = Font.systemFont(12);
  m.textColor = WARN;
  return w;
}

function addStaleNote(w, data) {
  if (!data.lastSync) return;
  w.addSpacer(4);
  const t = w.addText("synced " + data.lastSync);
  t.font = Font.systemFont(9);
  t.textColor = MUTED;
}

function smallWidget(data) {
  const w = new ListWidget();
  const label = w.addText("safe to spend");
  label.font = Font.semiboldSystemFont(11);
  label.textColor = MUTED;

  w.addSpacer(2);
  const big = w.addText(money(data.safePerDay, data.currency));
  big.font = Font.boldSystemFont(32);
  big.textColor = data.remaining >= 0 ? OK : WARN;
  big.minimumScaleFactor = 0.5;
  big.lineLimit = 1;

  const per = w.addText(`per day · ${data.daysLeft}d left`);
  per.font = Font.systemFont(11);
  per.textColor = MUTED;

  w.addSpacer(6);
  const sub = w.addText(
    `${money(data.spent, data.currency)} of ${money(data.budget, data.currency)}`);
  sub.font = Font.systemFont(12);
  sub.textColor = FG;

  if (data.openReviews > 0) {
    const r = w.addText(`${data.openReviews} to review`);
    r.font = Font.systemFont(10);
    r.textColor = WARN;
  }
  return w;
}

function mediumWidget(data) {
  const w = new ListWidget();

  const head = w.addStack();
  const left = head.addText(data.month);
  left.font = Font.semiboldSystemFont(12);
  left.textColor = MUTED;
  head.addSpacer();
  const right = head.addText(
    `${money(data.safePerDay, data.currency)}/day · ${data.daysLeft}d`);
  right.font = Font.semiboldSystemFont(12);
  right.textColor = data.remaining >= 0 ? OK : WARN;

  w.addSpacer(4);
  const total = w.addText(
    `${money(data.spent, data.currency)} of ${money(data.budget, data.currency)}`);
  total.font = Font.boldSystemFont(20);
  total.textColor = FG;

  w.addSpacer(6);
  for (const c of data.categories.slice(0, 4)) {
    const row = w.addStack();
    row.centerAlignContent();

    const name = row.addText(c.name);
    name.font = Font.systemFont(11);
    name.textColor = FG;
    name.lineLimit = 1;

    row.addSpacer();

    const amt = row.addText(money(c.spent, data.currency));
    amt.font = Font.systemFont(11);
    // Over its own budget, when it has one.
    amt.textColor = c.budget > 0 && c.spent > c.budget ? WARN : MUTED;
    w.addSpacer(2);
  }

  addStaleNote(w, data);
  return w;
}

let widget;
try {
  const data = await fetchData();
  if (data.error) {
    widget = errorWidget(data.error === "unauthorised" ? "check TOKEN" : data.error);
  } else {
    widget = config.widgetFamily === "small" ? smallWidget(data) : mediumWidget(data);
  }
} catch (e) {
  // Offline or the deployment moved. Showing the reason beats a blank widget.
  widget = errorWidget(String(e.message || e));
}

if (SHEET_URL) widget.url = SHEET_URL;

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
