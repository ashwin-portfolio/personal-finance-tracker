/**
 * 02_Settings.gs — reads the Settings tab as a key/value store.
 *
 * Tolerant by design: it scans every column pair looking for a cell whose text
 * matches the key, then takes the cell immediately to its right. This survives
 * the Settings tab being laid out as one block or several side-by-side blocks.
 */

var _settingsCache = null;

function settings_() {
  if (_settingsCache) return _settingsCache;
  var map = {};
  var rows = readRows_(TAB.SETTINGS);
  for (var r = 0; r < rows.length; r++) {
    for (var c = 0; c < rows[r].length - 1; c++) {
      var key = String(rows[r][c]).trim();
      if (!key) continue;
      var val = rows[r][c + 1];
      if (val === '' || val === null) continue;
      var norm = key.toLowerCase();
      if (map[norm] === undefined) map[norm] = val;
    }
  }
  _settingsCache = map;
  return map;
}

function getSetting_(key, fallback) {
  var map = settings_();
  var v = map[String(key).trim().toLowerCase()];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    if (SETTING_DEFAULTS.hasOwnProperty(key)) return SETTING_DEFAULTS[key];
    return '';
  }
  return v;
}

function getSettingNumber_(key, fallback) {
  var v = getSetting_(key, fallback);
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  if (isNaN(n)) {
    var d = (fallback !== undefined) ? fallback : SETTING_DEFAULTS[key];
    return Number(d);
  }
  return n;
}

function getSettingBool_(key, fallback) {
  var v = getSetting_(key, fallback);
  if (typeof v === 'boolean') return v;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'on';
}

function getSettingString_(key, fallback) {
  return String(getSetting_(key, fallback)).trim();
}

/** Clears caches. Call at the start of every run so a run sees fresh config. */
function resetCaches_() {
  _settingsCache = null;
  _sheetCache = {};
  _headerCache = {};
  _accountsCache = null;
  _categoriesCache = null;
}

/** Convenience accessors used across the pipeline. */
function cfg_() {
  return {
    label:           getSettingString_('Gmail Label', SETTING_DEFAULTS['Gmail Label']),
    intervalMinutes: getSettingNumber_('Processing Interval', SETTING_DEFAULTS['Processing Interval']),
    dupWindowDays:   getSettingNumber_('Duplicate Review Window (days)', SETTING_DEFAULTS['Duplicate Review Window (days)']),
    defaultCategory: getSettingString_('Default Category', SETTING_DEFAULTS['Default Category']),
    automationOn:    getSettingBool_('Automation Enabled', SETTING_DEFAULTS['Automation Enabled']),
    dupHandling:     getSettingString_('Duplicate Handling', SETTING_DEFAULTS['Duplicate Handling']).toLowerCase(),
    overlapDays:     getSettingNumber_('Lookback Overlap (days)', SETTING_DEFAULTS['Lookback Overlap (days)']),
    maxMessages:     getSettingNumber_('Max Messages Per Run', SETTING_DEFAULTS['Max Messages Per Run']),
    currency:        getSettingString_('Base Currency', SETTING_DEFAULTS['Base Currency']),
    timezone:        ss_().getSpreadsheetTimeZone() || 'Asia/Kolkata'
  };
}
