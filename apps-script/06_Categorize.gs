/**
 * 06_Categorize.gs — keyword categorisation, longest match wins.
 *
 * Addendum §4.6: when several keywords match, the longest one is the more
 * specific rule and takes precedence. "AMAZON PAY" beats "AMAZON"; "HP GAS"
 * beats "HP". Ties beyond that are broken by sheet order (earlier row wins),
 * so the tab stays editable without surprising reshuffles.
 */

var _categoriesCache = null;

function categoryRules_() {
  if (_categoriesCache) return _categoriesCache;
  var rows = readRows_(TAB.CATEGORIES);
  var cKw  = colOrThrow_(TAB.CATEGORIES, 'Keyword');
  var cCat = colOrThrow_(TAB.CATEGORIES, 'Category');
  var cSub = col_(TAB.CATEGORIES, 'Subcategory');

  var rules = [];
  for (var i = 0; i < rows.length; i++) {
    var kw = String(rows[i][cKw]).trim();
    var cat = String(rows[i][cCat]).trim();
    if (!kw || !cat) continue;
    rules.push({
      keyword: kw.toUpperCase(),
      length: kw.length,
      order: i,
      category: cat,
      subcategory: cSub >= 0 ? String(rows[i][cSub]).trim() : ''
    });
  }

  rules.sort(function (a, b) {
    if (b.length !== a.length) return b.length - a.length;
    return a.order - b.order;
  });

  _categoriesCache = rules;
  return rules;
}

/**
 * Matches against merchant first, then the wider text. A merchant hit is
 * always preferred over a body hit of the same length, because the body can
 * mention unrelated brand names in footers and offers.
 *
 * Returns { category, subcategory, keyword, matchedOn } — keyword is '' when
 * nothing matched and the Default Category was used.
 */
function categorise_(merchant, wideText) {
  var rules = categoryRules_();
  var m = String(merchant || '').toUpperCase();
  var w = String(wideText || '').toUpperCase();

  for (var i = 0; i < rules.length; i++) {
    if (m && m.indexOf(rules[i].keyword) !== -1) {
      return {
        category: rules[i].category,
        subcategory: rules[i].subcategory,
        keyword: rules[i].keyword,
        matchedOn: 'merchant'
      };
    }
  }

  for (var j = 0; j < rules.length; j++) {
    if (w && w.indexOf(rules[j].keyword) !== -1) {
      return {
        category: rules[j].category,
        subcategory: rules[j].subcategory,
        keyword: rules[j].keyword,
        matchedOn: 'body'
      };
    }
  }

  return {
    category: cfg_().defaultCategory,
    subcategory: '',
    keyword: '',
    matchedOn: 'default'
  };
}
