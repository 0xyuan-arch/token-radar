/* Token Launch Radar — board behaviour. Reads window.RADAR_DATA (data.js, loaded first). */
(function () {
  'use strict';
  var D = window.RADAR_DATA || { rows: [], meta: {} };
  var rows = D.rows || [];
  var meta = D.meta || {};
  var calibByCategory = {};
  ((meta.calibration && meta.calibration.categories) || []).forEach(function (e) { calibByCategory[e.category] = e; });

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    asof: $('asof'), chips: $('chips'), q: $('q'), cat: $('f-category'), chain: $('f-chain'),
    tier: $('f-tier'), watch: $('f-watch'), rowcount: $('rowcount'), body: $('rows'),
    empty: $('empty'), detail: $('detail'), calib: $('calib'), board: $('board')
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function chainLabel(chains) {
    chains = chains || [];
    if (chains.length <= 4) return chains.join(', ');
    return chains.slice(0, 4).join(', ') + ' +' + (chains.length - 4) + ' more';
  }
  function ageShort(days) {
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30.4) + 'mo';
    return days + 'd';
  }

  /* header chips */
  var totalImplied = rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
  var sortedImplied = rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
  var medianImplied = sortedImplied.length ? sortedImplied[Math.floor(sortedImplied.length / 2)] : 0;
  var watchCovered = rows.filter(function (r) { return r.watchlist; }).length;
  els.asof.textContent = meta.as_of || '—';
  els.chips.innerHTML =
    '<span class="chip"><b>' + rows.length + '</b>pre-token protocols</span>' +
    '<span class="chip"><b class="acc">' + watchCovered + '/' + (meta.counts ? meta.counts.watchlist : watchCovered) + '</b>watchlist covered</span>' +
    '<span class="chip"><b>' + money(totalImplied) + '</b>total implied value</span>' +
    '<span class="chip"><b>' + money(medianImplied) + '</b>median implied</span>';

  /* filter option lists, from the data itself */
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    cats[r.category] = 1;
    (r.chains || []).forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; els.cat.appendChild(o);
  });
  Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); }).forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; els.chain.appendChild(o);
  });

  /* calibration table inside "How the value is derived" */
  (function renderCalib() {
    var cal = meta.calibration || { categories: [] };
    var own = (cal.categories || []).filter(function (e) { return e.basis === 'category'; });
    var html = '<p>The multiples below were calibrated from this snapshot alone: ' + (cal.global_peers || 0) +
      ' tokenized protocols set a global median of ' + (cal.global_multiple != null ? cal.global_multiple.toFixed(3) : '—') +
      '×, and every category with at least 3 tokenized peers uses its own median instead.</p>';
    if (own.length) {
      html += '<div class="calib-wrap"><table class="calib"><thead><tr><th>Category</th><th class="num">Tokenized peers</th><th class="num">Median mcap/TVL</th></tr></thead><tbody>';
      own.forEach(function (e) {
        html += '<tr><td>' + esc(e.category) + '</td><td class="num">' + e.tokenized_peers + '</td><td class="num">' + e.multiple.toFixed(3) + '×</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    els.calib.innerHTML = html;
  })();

  /* board state */
  var state = { sortKey: 'rank', sortDir: 1, selected: null };
  function currentRows() {
    var q = els.q.value.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (els.cat.value && r.category !== els.cat.value) return false;
      if (els.chain.value && (r.chains || []).indexOf(els.chain.value) < 0) return false;
      if (els.tier.value && r.tier !== els.tier.value) return false;
      if (els.watch.checked && !r.watchlist) return false;
      return true;
    });
    var k = state.sortKey, dir = state.sortDir;
    out.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null && y == null) return a.rank - b.rank;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return (x < y ? -1 : x > y ? 1 : 0) * dir || a.rank - b.rank;
      return (x - y) * dir || a.rank - b.rank;
    });
    return out;
  }

  function render() {
    var list = currentRows();
    els.rowcount.textContent = 'showing ' + list.length + ' of ' + rows.length;
    els.empty.hidden = list.length > 0;
    els.body.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="star" title="On the watchlist">★</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category) + '</td>' +
        '<td class="chains" title="' + esc((r.chains || []).join(', ')) + '">' + esc(chainLabel(r.chains)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageShort(r.age_days) + '</td>' +
        '<td><span class="pill ' + r.tier + '">' + r.tier + '</span></td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    els.board.querySelectorAll('th.sortable').forEach(function (th) {
      var arrow = th.querySelector('.arrow');
      if (arrow) arrow.remove();
      if (th.getAttribute('data-sort') === state.sortKey) {
        var s = document.createElement('span');
        s.className = 'arrow'; s.textContent = state.sortDir === 1 ? ' ▲' : ' ▼';
        th.appendChild(s);
      }
    });
  }

  function openDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.selected = slug;
    var cal = calibByCategory[r.category];
    var multNote = cal && cal.basis === 'category'
      ? 'the median market-cap/TVL of the ' + cal.tokenized_peers + ' tokenized ' + r.category + ' protocols in this same snapshot'
      : 'the global median across all tokenized protocols in this snapshot — only ' + (cal ? cal.tokenized_peers : 0) + ' tokenized ' + r.category + ' peer(s), too few to calibrate the category alone';
    var changeTxt = r.change_7d == null ? 'no 7-day change reported, so momentum is neutral' :
      'its TVL moved ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '% in 7 days; the factor moves at 90% of that change, capped between −30% and +50%';
    var html =
      '<button class="close" id="d-close" aria-label="Close">×</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="star">★</span>' : '') + '</h2>' +
      '<p class="d-meta">Rank #' + r.rank + ' · ' + esc(r.category) + ' · ' + esc((r.chains || []).join(', ') || '—') +
      ' · <span class="pill ' + r.tier + '">' + r.tier + '</span>' + (r.watchlist ? ' · on the watchlist' : '') + '</p>' +
      '<div class="eq">' +
      '<div class="term"><span class="t-label">TVL</span><span class="t-val">' + money(r.tvl_usd) + '</span></div><span class="op">×</span>' +
      '<div class="term"><span class="t-label">Multiple</span><span class="t-val">' + r.multiple.toFixed(3) + '×</span></div><span class="op">×</span>' +
      '<div class="term"><span class="t-label">Momentum</span><span class="t-val">' + r.momentum.toFixed(3) + '×</span></div><span class="op">×</span>' +
      '<div class="term"><span class="t-label">Maturity</span><span class="t-val">' + r.maturity.toFixed(3) + '×</span></div><span class="op">=</span>' +
      '<div class="term result"><span class="t-label">Implied value</span><span class="t-val">' + money(r.implied_value_usd) + '</span></div></div>' +
      '<ul class="factors">' +
      '<li><strong>TVL ' + money(r.tvl_usd) + '</strong> — value locked in the protocol on ' + esc(meta.as_of || 'the snapshot date') + ', the base the multiple is applied to.</li>' +
      '<li><strong>Category multiple ' + r.multiple.toFixed(3) + '×</strong> — ' + esc(multNote) + '.</li>' +
      '<li><strong>Momentum ' + r.momentum.toFixed(3) + '×</strong> — ' + esc(changeTxt) + '.</li>' +
      '<li><strong>Maturity ' + r.maturity.toFixed(3) + '×</strong> — tracked for ' + r.age_days + ' days; protocols start at 0.80× and reach full weight at 900 days.</li></ul>' +
      (r.why ? '<p class="why">' + esc(r.why) + '</p>' : '') +
      '<h3>Farm plan</h3><ol class="steps">' +
      (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    els.detail.innerHTML = html;
    els.detail.hidden = false;
    $('d-close').addEventListener('click', function () {
      els.detail.hidden = true; state.selected = null; render();
    });
    render();
  }

  els.body.addEventListener('click', function (ev) {
    var tr = ev.target.closest ? ev.target.closest('tr[data-slug]') : null;
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  els.board.querySelectorAll('th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = k === 'name' ? 1 : -1; if (k === 'rank') state.sortDir = 1; }
      render();
    });
  });
  ['q', 'cat', 'chain', 'tier', 'watch'].forEach(function (id) {
    els[id].addEventListener('input', render);
    els[id].addEventListener('change', render);
  });

  /* screenshot hooks: ?detail=<slug>, ?tier=Prime, ?watchlist=1 */
  var params = new URLSearchParams(window.location.search);
  if (params.get('tier')) els.tier.value = params.get('tier');
  if (params.get('category')) els.cat.value = params.get('category');
  if (params.get('chain')) els.chain.value = params.get('chain');
  if (params.get('watchlist') === '1') els.watch.checked = true;
  render();
  if (params.get('detail')) openDetail(params.get('detail'));
})();
