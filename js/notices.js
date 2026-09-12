/* ===== Arrear Notice — Bulk Notice / Paste GSTINs (single-taxpayer flow lives in wizard.js) ===== */

var generatedBulkNotices = []; // in-memory only until persisted / downloaded
var _bulkSelectedIds = new Set();
var _bulkResultsElId = null; // which results panel ('bulk-all-results'|'bulk-paste-results') is currently active

/* Excel-style per-column filter/sort on the results table header.
   _bulkColumnFilters[col] is null (no filter) or a Set of allowed display values. */
var _bulkColumnFilters = { taxpayer: null, gstin: null, type: null, status: null };
var _bulkSort = null; // { col: 'taxpayer'|'gstin'|'type'|'status'|'demands'|'amount', dir: 'asc'|'desc' }
var _bulkCfpCol = null;        // column the open popover is editing
var _bulkCfpAllValues = [];    // unique display values for that column
var _bulkCfpChecked = new Set();

/* Notice-type/Section-62 selection state for the quick-filter chip bars —
   mirrors the Issue Notice wizard's _wizNoticeType/_wizSection62 pattern.
   noticeType '' means "All Demands" (both Intimation and Urgent, split per
   taxpayer at generation time, same as the wizard's "Both Notices" option). */
var _bulkFilterState = {
  all: { noticeType: '', sec62: 'exclude' },
  paste: { noticeType: '', sec62: 'exclude' }
};

function bulkTab(tab, el) {
  closeBulkColumnFilterPopover();
  document.querySelectorAll('#page-bulknotice .tab').forEach(function (t) { t.classList.remove('active'); });
  document.querySelectorAll('#page-bulknotice .bulk-tab-panel').forEach(function (p) { p.style.display = 'none'; });
  if (el) el.classList.add('active');
  var panel = document.getElementById('bulk-tab-' + tab);
  if (panel) panel.style.display = 'block';
  if (tab === 'all') updateBulkAllCount();
  if (tab === 'all' || tab === 'paste') { updateBulkQuickFilterCounts(tab); updateBulkFilterTags(tab); }
  if (tab === 'bankatt') renderBankAtts();
  if (tab === 'bankrelease') renderBankReleaseTab();
  var bar = document.getElementById('bulk-action-bar');
  if (bar) bar.style.display = (generatedBulkNotices.length && (tab === 'all' || tab === 'paste')) ? 'flex' : 'none';
}

function getBulkNoticeType(tab) {
  return (_bulkFilterState[tab] || {}).noticeType || '';
}
function bulkShouldExcludeSec62(tab) {
  return (_bulkFilterState[tab] || {}).sec62 !== 'all';
}

function bulkQuickFilter(tab, type) {
  _bulkFilterState[tab].noticeType = (type === 'all' ? '' : type);
  updateBulkQuickFilterActiveState(tab);
  if (tab === 'all') updateBulkAllCount();
  updateBulkFilterTags(tab);
}
/* Independent toggle, not part of the All/Intimation/Urgent chip group —
   Section 62 demands stay excluded from every view until the officer opts in. */
function bulkToggleSection62(tab) {
  _bulkFilterState[tab].sec62 = _bulkFilterState[tab].sec62 === 'all' ? 'exclude' : 'all';
  updateBulkQuickFilterActiveState(tab);
  updateBulkQuickFilterCounts(tab);
  if (tab === 'all') updateBulkAllCount();
  updateBulkFilterTags(tab);
}

function updateBulkQuickFilterActiveState(tab) {
  var st = _bulkFilterState[tab];
  var active = st.noticeType === 'urgent' ? 'urgent' : st.noticeType === 'intimation' ? 'intimation' : 'all';
  var bar = document.getElementById('bulk-' + tab + '-quick-filter-bar');
  if (!bar) return;
  bar.querySelectorAll('.qf-chip[data-qf="all"], .qf-chip[data-qf="intimation"], .qf-chip[data-qf="urgent"]').forEach(function (chip) {
    chip.classList.toggle('active', chip.getAttribute('data-qf') === active);
  });
  var sec62Chip = bar.querySelector('.qf-chip[data-qf="section62"]');
  if (sec62Chip) sec62Chip.classList.toggle('active', st.sec62 === 'all');
}

/* Live demand counts shown on each quick-filter chip, computed across the
   whole DCR (not just one taxpayer, unlike the wizard's per-GSTIN counts). */
function updateBulkQuickFilterCounts(tab) {
  var st = _bulkFilterState[tab];
  if (!st) return;
  var valid = AppState.cases.filter(isValidCase).filter(isNoticeEligible);
  var sec62Count = valid.filter(function (c) { return String(c.section || '').trim() === '62'; }).length;
  var base = st.sec62 === 'all' ? valid : valid.filter(function (c) { return String(c.section || '').trim() !== '62'; });
  var intimation = base.filter(function (c) { return isNoticeTypeMatch(c, 'intimation'); }).length;
  var urgent = base.filter(function (c) { return isNoticeTypeMatch(c, 'urgent'); }).length;
  var setText = function (id, n) { var el = document.getElementById(id); if (el) el.textContent = n; };
  setText('bulk-' + tab + '-qf-count-all', base.length);
  setText('bulk-' + tab + '-qf-count-intimation', intimation);
  setText('bulk-' + tab + '-qf-count-urgent', urgent);
  setText('bulk-' + tab + '-qf-count-section62', sec62Count);
}

/* Reads the Order Date / Tax Period Advanced Filters for a bulk tab ('all'|'paste')
   into the {odFrom, odTo, tpFrom, tpTo} shape getTaxpayerMap expects. */
function readBulkAdvancedFilters(tab) {
  var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
  return {
    odFrom: val('bulk-' + tab + '-od-from'),
    odTo: val('bulk-' + tab + '-od-to'),
    tpFrom: (val('bulk-' + tab + '-tp-from') || '').trim(),
    tpTo: (val('bulk-' + tab + '-tp-to') || '').trim()
  };
}

function toggleBulkAdvancedFilters(tab) {
  var el = document.getElementById('bulk-' + tab + '-advanced');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function clearBulkAdvancedFilters(tab) {
  ['od-from', 'od-to', 'tp-from', 'tp-to'].forEach(function (suffix) {
    var el = document.getElementById('bulk-' + tab + '-' + suffix);
    if (el) el.value = '';
  });
  if (tab === 'all') updateBulkAllCount();
  updateBulkFilterTags(tab);
}

/* Resets the quick-filter chips, Section 62 toggle and Advanced Filters back
   to defaults for one bulk tab — the "Clear All" action on the active-filter
   tags row. */
function bulkClearAllFilters(tab) {
  _bulkFilterState[tab] = { noticeType: '', sec62: 'exclude' };
  updateBulkQuickFilterActiveState(tab);
  updateBulkQuickFilterCounts(tab);
  clearBulkAdvancedFilters(tab); // also resets the date/period inputs and re-runs the count/tags
}

/* Shows the currently-active quick/advanced filters as removable-looking tags
   below the chip bar, plus (on the 'all' tab, which has a live taxpayer count)
   a "Showing X of Y taxpayers" summary — mirrors the Issue Notice wizard's
   own active-filter-tags row so bulk filtering is just as visible. */
function updateBulkFilterTags(tab) {
  var tagsWrap = document.getElementById('bulk-' + tab + '-active-filter-tags');
  if (!tagsWrap) return;
  var st = _bulkFilterState[tab];
  if (!st) return;
  var opts = readBulkAdvancedFilters(tab);

  var tags = [];
  if (st.noticeType === 'urgent') tags.push('Urgent ≥ 90 days');
  else if (st.noticeType === 'intimation') tags.push('Intimation < 90 days');
  if (st.sec62 === 'all') tags.push('Section 62 included');
  if (opts.odFrom || opts.odTo) tags.push('Order Date: ' + (opts.odFrom ? fmtDate(opts.odFrom) : '…') + ' – ' + (opts.odTo ? fmtDate(opts.odTo) : '…'));
  if (opts.tpFrom || opts.tpTo) tags.push('Tax Period: ' + (opts.tpFrom || '…') + ' – ' + (opts.tpTo || '…'));

  if (!tags.length) { tagsWrap.style.display = 'none'; tagsWrap.innerHTML = ''; return; }

  var summary = '';
  if (tab === 'all') {
    var filteredMap = getTaxpayerMap(getBulkNoticeType('all'), bulkShouldExcludeSec62('all'), opts);
    var baselineMap = getTaxpayerMap('', false, {});
    summary = '<span class="filter-summary-count">Showing ' + Object.keys(filteredMap).length + ' of ' + Object.keys(baselineMap).length + ' taxpayers</span>';
  }

  tagsWrap.style.display = 'flex';
  tagsWrap.innerHTML = summary
    + tags.map(function (t) { return '<span class="filter-tag">' + xe(t) + '</span>'; }).join('')
    + '<button type="button" class="filter-tag-clear" onclick="bulkClearAllFilters(\'' + tab + '\')"><i class="fa-solid fa-xmark"></i> Clear All</button>';
}

/* ===== Bulk Notice (all recoverable taxpayers matching filters) ===== */

function updateBulkAllCount() {
  var el = document.getElementById('bulk-all-count');
  if (!el) return;
  var noticeType = getBulkNoticeType('all');
  var excludeSec62 = bulkShouldExcludeSec62('all');
  var opts = readBulkAdvancedFilters('all');
  var map = getTaxpayerMap(noticeType, excludeSec62, opts);
  el.textContent = Object.keys(map).length;
  updateBulkQuickFilterCounts('all');
  updateBulkFilterTags('all');

  var funnelEl = document.getElementById('bulk-all-funnel');
  if (funnelEl) {
    var f = bulkFilterFunnel(noticeType, excludeSec62, opts);
    funnelEl.textContent = f.totalValid + ' valid demands → ' + f.eligible + ' notice-eligible → '
      + f.typeMatched + ' match ' + (noticeType || 'any') + ' age → '
      + f.sec62Matched + ' after Section 62 filter → ' + f.final + ' after date/period filters ('
      + f.finalGstins + ' taxpayers)';
  }
}

function generateBulkAll() {
  var noticeType = getBulkNoticeType('all');
  var excludeSec62 = bulkShouldExcludeSec62('all');
  var map = getTaxpayerMap(noticeType, excludeSec62, readBulkAdvancedFilters('all'));
  runBulkGeneration(map, noticeType, 'bulk-all-results');
}

function generateBulkPaste() {
  var raw = document.getElementById('bulk-paste-gstins').value || '';
  var pasted = raw.split(/[\n,;]+/).map(function (s) { return s.trim().toUpperCase(); }).filter(function (s) { return s.length >= 10; });
  if (!pasted.length) { showToast('⚠️ Paste at least one GSTIN'); return; }

  var noticeType = getBulkNoticeType('paste');
  var excludeSec62 = bulkShouldExcludeSec62('paste');
  var fullMap = getTaxpayerMap(noticeType, excludeSec62, readBulkAdvancedFilters('paste'));
  var map = {};
  pasted.forEach(function (g) { if (fullMap[g]) map[g] = fullMap[g]; });

  if (!Object.keys(map).length) { showToast('⚠️ None of the pasted GSTINs have eligible demands'); return; }
  runBulkGeneration(map, noticeType, 'bulk-paste-results');
}

function makeBulkNotice(t, cases, kind, seq) {
  var pendAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  return {
    id: uid('notice'), gstin: t.gstin, legalName: t.legalName, cases: caseSnapshots(cases), pendAmt: pendAmt,
    type: kind === 'urgent' ? 'demand' : 'reminder', noticeKind: kind,
    num: 'NOT/' + new Date().getFullYear() + '/' + String(seq).padStart(4, '0'),
    date: todayISO(), replyDate: kind === 'urgent' ? '' : addDaysISO(todayISO(), 30),
    address: (AppState.addressCache[t.gstin] || {}).address || '', details: '',
    createdAt: new Date().toISOString()
  };
}

/* noticeType '' ("All Demands") means each taxpayer's cases may span both
   age buckets — split them the same way the wizard's wizBuildNotices() does,
   producing up to 2 notices (Intimation + Urgent) per taxpayer. Otherwise
   getTaxpayerMap already pre-filtered every case to the single requested
   bucket, so one notice per taxpayer is correct as before. */
function runBulkGeneration(map, noticeType, resultsElId) {
  var seq = AppState.notices.length;
  generatedBulkNotices = [];
  Object.values(map).forEach(function (t) {
    if (noticeType) {
      seq++;
      generatedBulkNotices.push(makeBulkNotice(t, t.cases, noticeType, seq));
    } else {
      var buckets = { intimation: [], urgent: [] };
      t.cases.forEach(function (c) {
        var age = getDemandAgeDays(c);
        (age !== null && age >= 90 ? buckets.urgent : buckets.intimation).push(c);
      });
      ['intimation', 'urgent'].forEach(function (kind) {
        if (!buckets[kind].length) return;
        seq++;
        generatedBulkNotices.push(makeBulkNotice(t, buckets[kind], kind, seq));
      });
    }
  });
  // Default display order — sorted once, here, at generation time. Rows keep
  // this position after that (even if a demand edit changes their amount) so
  // an officer editing one taxpayer's demands doesn't lose track of the row.
  // Explicit sorting from here on is only ever the officer's own choice via
  // the column filter button (_bulkSort).
  generatedBulkNotices.sort(function (a, b) { return b.pendAmt - a.pendAmt; });
  _bulkSelectedIds.clear();
  _bulkColumnFilters = { taxpayer: null, gstin: null, type: null, status: null };
  _bulkSort = null;
  _bulkResultsElId = resultsElId;
  renderBulkResults(resultsElId);
  showToast('✅ Generated ' + generatedBulkNotices.length + ' notices — review and save/download below');
}

/* Extracts the display value used for a column's filter/sort. */
/* The taxpayer's GST registration status (Active/Cancelled/Suspended/…) from
   the Taxpayer Register — 'Unknown' when that register hasn't been uploaded
   or has no entry for this GSTIN. Same source wizard.js's taxpayer bar uses. */
function bulkRegStatus(n) {
  var reg = AppState.addressCache[n.gstin] || {};
  return reg.regStatus || 'Unknown';
}

function bulkColumnValue(n, col) {
  if (col === 'taxpayer') return n.legalName || '';
  if (col === 'gstin') return n.gstin || '';
  if (col === 'type') return n.noticeKind === 'urgent' ? 'Urgent' : 'Intimation';
  if (col === 'status') return bulkRegStatus(n);
  if (col === 'demands') return n.cases.length;
  if (col === 'amount') return n.pendAmt;
  return '';
}

/* generatedBulkNotices, filtered by the active column filters and ordered by
   the active sort. With no sort chosen, rows keep generatedBulkNotices' own
   order (set once at generation time) instead of being re-sorted by amount
   on every render — otherwise editing one notice's demands (which changes
   its pendAmt) would make its row jump position or vanish from view mid-edit.
   Never mutates generatedBulkNotices itself, since selection/download/save
   logic all index into that array directly. */
function getBulkVisibleNotices() {
  var list = generatedBulkNotices.filter(function (n) {
    if (_bulkColumnFilters.taxpayer && !_bulkColumnFilters.taxpayer.has(n.legalName || '')) return false;
    if (_bulkColumnFilters.gstin && !_bulkColumnFilters.gstin.has(n.gstin || '')) return false;
    if (_bulkColumnFilters.type && !_bulkColumnFilters.type.has(n.noticeKind === 'urgent' ? 'Urgent' : 'Intimation')) return false;
    if (_bulkColumnFilters.status && !_bulkColumnFilters.status.has(bulkRegStatus(n))) return false;
    return true;
  });
  if (_bulkSort) {
    var col = _bulkSort.col, dir = _bulkSort.dir;
    list.sort(function (a, b) {
      var av = bulkColumnValue(a, col), bv = bulkColumnValue(b, col);
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  return list;
}

function addDaysISO(iso, days) {
  var d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function renderBulkResults(resultsElId) {
  var wrap = document.getElementById(resultsElId);
  var bar = document.getElementById('bulk-action-bar');
  closeBulkColumnFilterPopover();
  if (!wrap) return;
  if (!generatedBulkNotices.length) {
    wrap.innerHTML = '';
    if (bar) bar.style.display = 'none';
    return;
  }
  _bulkResultsElId = resultsElId;
  var visible = getBulkVisibleNotices();
  var rows = visible.map(function (n, i) {
    var idx = generatedBulkNotices.indexOf(n); // real index — visible list may be filtered/reordered
    var checked = _bulkSelectedIds.has(n.id) ? ' checked' : '';
    var typePill = n.noticeKind === 'urgent' ? '<span class="pill pill-red">Urgent</span>' : '<span class="pill pill-orange">Intimation</span>';
    var regStatus = bulkRegStatus(n);
    var statusPill = regStatus === 'Unknown' ? '<span class="pill pill-gray">Unknown</span>'
      : (isCollectible(n.gstin) ? '<span class="pill pill-green">' + xe(regStatus) + '</span>' : '<span class="pill pill-red">' + xe(regStatus) + '</span>');
    var tradeName = (AppState.addressCache[n.gstin] || {}).tradeName || '';
    var taxpayerCell = xe(tradeName || n.legalName);
    return '<tr><td><input type="checkbox" data-id="' + n.id + '" onchange="bulkToggleCaseCheck(this)"' + checked + '></td><td>' + (i + 1) + '</td>'
      + '<td>' + taxpayerCell + '</td><td class="gstin-cell">' + xe(n.gstin) + '</td>'
      + '<td style="cursor:pointer;" onclick="openBulkDemandEditor(' + idx + ')" title="Click to view/edit the demands included in this notice">' + typePill + '</td>'
      + '<td>' + statusPill + '</td>'
      + '<td><span class="count-link" onclick="openBulkDemandEditor(' + idx + ')" title="View ' + n.cases.length + ' demand' + (n.cases.length === 1 ? '' : 's') + '">' + n.cases.length + '</span></td>'
      + '<td><div class="amount-cell pending">' + fmt(n.pendAmt) + '</div></td>'
      + '<td><div style="display:flex;gap:4px;">'
      + '<button class="btn btn-outline btn-xs" title="Generate this notice only (Word)" onclick="downloadOneBulkNotice(' + idx + ',\'word\')"><i class="fa-solid fa-file-word"></i></button>'
      + '<button class="btn btn-outline btn-xs" title="Generate this notice only (PDF)" onclick="downloadOneBulkNotice(' + idx + ',\'pdf\')"><i class="fa-solid fa-file-pdf"></i></button>'
      + '</div></td></tr>';
  }).join('');
  var allChecked = visible.length > 0 && visible.every(function (n) { return _bulkSelectedIds.has(n.id); });

  function th(col, label) {
    var isActive = !!(_bulkColumnFilters[col] || (_bulkSort && _bulkSort.col === col));
    return '<th>' + label + '<button type="button" class="th-filter-btn' + (isActive ? ' active' : '') + '" onclick="openBulkColumnFilter(\'' + col + '\', this, event)" title="Filter / Sort"><i class="fa-solid fa-filter"></i></button></th>';
  }

  var countLabel = generatedBulkNotices.length + ' notices ready' + (visible.length !== generatedBulkNotices.length ? ' (' + visible.length + ' shown)' : '');
  wrap.innerHTML =
    '<div class="table-wrap" style="margin-top:14px;"><div class="table-toolbar"><strong style="font-size:12px;">' + countLabel + '</strong>'
    + '<div style="margin-left:auto;display:flex;gap:8px;">'
    + '<button class="btn btn-green btn-sm" onclick="saveAllBulkNotices()"><i class="fa-solid fa-floppy-disk"></i> Save All</button>'
    + '<button class="btn btn-blue btn-sm" onclick="downloadAllBulkNoticesZip()"><i class="fa-solid fa-file-word"></i> Download All (Word ZIP)</button>'
    + '<button class="btn btn-outline btn-sm" onclick="downloadAllBulkNoticesPdfZip()"><i class="fa-solid fa-file-pdf"></i> Download All (PDF ZIP)</button>'
    + '</div></div><div class="table-scroll"><table><thead><tr><th style="width:34px;"><input type="checkbox" id="bulk-select-all" onchange="bulkToggleSelectAll(this.checked)"' + (allChecked ? ' checked' : '') + '></th><th>Sl.No.</th>'
    + th('taxpayer', 'Taxpayer') + th('gstin', 'GSTIN') + th('type', 'Type') + th('status', 'Status') + th('demands', 'Demands') + th('amount', 'Amount')
    + '<th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  bulkUpdateSelectionSummary();
}

/* ===== Excel-style column filter/sort popover for the results table header ===== */

function closeBulkColumnFilterPopover() {
  var el = document.getElementById('bulk-col-filter-popover');
  if (el) el.remove();
  document.removeEventListener('mousedown', _bulkCfpOutsideHandler);
}

function _bulkCfpOutsideHandler(e) {
  var el = document.getElementById('bulk-col-filter-popover');
  if (el && !el.contains(e.target) && !e.target.closest('.th-filter-btn')) closeBulkColumnFilterPopover();
}

function openBulkColumnFilter(col, btnEl, evt) {
  if (evt) evt.stopPropagation();
  var existing = document.getElementById('bulk-col-filter-popover');
  var wasOpenForSameCol = existing && existing.getAttribute('data-col') === col;
  closeBulkColumnFilterPopover();
  if (wasOpenForSameCol) return;

  var isCategorical = (col === 'taxpayer' || col === 'gstin' || col === 'type' || col === 'status');
  var sortAscLabel = isCategorical ? 'Sort A to Z' : 'Sort Smallest to Largest';
  var sortDescLabel = isCategorical ? 'Sort Z to A' : 'Sort Largest to Smallest';

  var html = '<div class="cfp-sort-item" onclick="bulkApplySort(\'' + col + '\',\'asc\')"><i class="fa-solid fa-arrow-down-short-wide"></i> ' + sortAscLabel + '</div>'
    + '<div class="cfp-sort-item" onclick="bulkApplySort(\'' + col + '\',\'desc\')"><i class="fa-solid fa-arrow-up-short-wide"></i> ' + sortDescLabel + '</div>';

  if (isCategorical) {
    var hasFilter = !!_bulkColumnFilters[col];
    html += '<div class="cfp-divider"></div>'
      + '<div class="cfp-clear' + (hasFilter ? ' enabled' : '') + '" onclick="bulkClearColumnFilter(\'' + col + '\')"><i class="fa-solid fa-filter-circle-xmark"></i> Clear Filter</div>'
      + '<div class="cfp-divider"></div>'
      + '<input type="text" class="cfp-search" placeholder="Search..." oninput="renderBulkCfpList(this.value)">'
      + '<div class="cfp-list" id="bulk-cfp-list"></div>'
      + '<div class="cfp-actions"><button class="btn btn-outline btn-xs" onclick="closeBulkColumnFilterPopover()">Cancel</button><button class="btn btn-red btn-xs" onclick="bulkApplyColumnFilterFromPopover()">OK</button></div>';
  }

  var popover = document.createElement('div');
  popover.className = 'col-filter-popover';
  popover.id = 'bulk-col-filter-popover';
  popover.setAttribute('data-col', col);
  popover.innerHTML = html;
  document.body.appendChild(popover);

  var r = btnEl.getBoundingClientRect();
  var top = r.bottom + window.scrollY + 4;
  var left = r.left + window.scrollX;
  var maxLeft = window.scrollX + document.documentElement.clientWidth - 250;
  if (left > maxLeft) left = Math.max(8, maxLeft);
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';

  if (isCategorical) {
    _bulkCfpCol = col;
    var seen = {};
    _bulkCfpAllValues = [];
    generatedBulkNotices.forEach(function (n) {
      var v = bulkColumnValue(n, col);
      if (!seen[v]) { seen[v] = true; _bulkCfpAllValues.push(v); }
    });
    _bulkCfpAllValues.sort(function (a, b) { return a.localeCompare(b); });
    _bulkCfpChecked = _bulkColumnFilters[col] ? new Set(_bulkColumnFilters[col]) : new Set(_bulkCfpAllValues);
    renderBulkCfpList('');
  }

  setTimeout(function () { document.addEventListener('mousedown', _bulkCfpOutsideHandler); }, 0);
}

function renderBulkCfpList(search) {
  var wrap = document.getElementById('bulk-cfp-list');
  if (!wrap) return;
  var q = (search || '').toLowerCase();
  var values = _bulkCfpAllValues.filter(function (v) { return v.toLowerCase().indexOf(q) !== -1; });
  var allChecked = values.length > 0 && values.every(function (v) { return _bulkCfpChecked.has(v); });
  var rows = '<div class="cfp-item"><input type="checkbox" id="bulk-cfp-select-all"' + (allChecked ? ' checked' : '') + ' onchange="bulkCfpToggleSelectAll(this.checked)"><label for="bulk-cfp-select-all"><strong>(Select All)</strong></label></div>'
    + values.map(function (v, i) {
      var id = 'bulk-cfp-item-' + i;
      var checked = _bulkCfpChecked.has(v) ? ' checked' : '';
      return '<div class="cfp-item"><input type="checkbox" id="' + id + '" data-val="' + xe(v) + '"' + checked + ' onchange="bulkCfpToggleValue(this)"><label for="' + id + '">' + (v === '' ? '<em>(blank)</em>' : xe(v)) + '</label></div>';
    }).join('');
  wrap.innerHTML = rows;
}

function bulkCfpToggleValue(el) {
  var v = el.getAttribute('data-val');
  if (el.checked) _bulkCfpChecked.add(v); else _bulkCfpChecked.delete(v);
  var selectAll = document.getElementById('bulk-cfp-select-all');
  if (selectAll) {
    var boxes = document.querySelectorAll('#bulk-cfp-list .cfp-item input[data-val]');
    selectAll.checked = boxes.length > 0 && Array.from(boxes).every(function (cb) { return cb.checked; });
  }
}

function bulkCfpToggleSelectAll(checked) {
  document.querySelectorAll('#bulk-cfp-list .cfp-item input[data-val]').forEach(function (cb) {
    cb.checked = checked;
    var v = cb.getAttribute('data-val');
    if (checked) _bulkCfpChecked.add(v); else _bulkCfpChecked.delete(v);
  });
}

function bulkApplyColumnFilterFromPopover() {
  var col = _bulkCfpCol;
  _bulkColumnFilters[col] = (_bulkCfpChecked.size >= _bulkCfpAllValues.length) ? null : new Set(_bulkCfpChecked);
  closeBulkColumnFilterPopover();
  renderBulkResults(_bulkResultsElId);
}

function bulkClearColumnFilter(col) {
  _bulkColumnFilters[col] = null;
  closeBulkColumnFilterPopover();
  renderBulkResults(_bulkResultsElId);
}

function bulkApplySort(col, dir) {
  _bulkSort = { col: col, dir: dir };
  closeBulkColumnFilterPopover();
  renderBulkResults(_bulkResultsElId);
}

/* Lets the officer generate/download a single taxpayer's notice straight out of
   the bulk batch, the same way Issue Notice downloads one notice immediately —
   without having to Save All / download the whole ZIP first. */
function downloadOneBulkNotice(idx, format) {
  var n = generatedBulkNotices[idx];
  if (!n) return;
  var cfg = getSettings();
  if (format === 'word') {
    buildNoticeDocx(n, cfg).then(function (blob) { downloadBlob(blob, n.num.replace(/\//g, '_') + '.docx'); });
  } else {
    generateNoticePDF(n, cfg);
  }
}

function bulkToggleCaseCheck(el) {
  var id = el.getAttribute('data-id');
  if (el.checked) _bulkSelectedIds.add(id); else _bulkSelectedIds.delete(id);
  bulkUpdateSelectionSummary();
  var selectAll = document.getElementById('bulk-select-all');
  if (selectAll) {
    var visible = getBulkVisibleNotices();
    var allChecked = visible.length > 0 && visible.every(function (n) { return _bulkSelectedIds.has(n.id); });
    var someChecked = visible.some(function (n) { return _bulkSelectedIds.has(n.id); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

/* "Select all" in the header only toggles the currently-visible (filtered) rows. */
function bulkToggleSelectAll(checked) {
  getBulkVisibleNotices().forEach(function (n) {
    if (checked) _bulkSelectedIds.add(n.id); else _bulkSelectedIds.delete(n.id);
  });
  renderBulkResults(_bulkResultsElId);
}

function bulkSelectedNotices() {
  return generatedBulkNotices.filter(function (n) { return _bulkSelectedIds.has(n.id); });
}

function bulkUpdateSelectionSummary() {
  var selected = bulkSelectedNotices();
  var total = selected.reduce(function (s, n) { return s + (Number(n.pendAmt) || 0); }, 0);
  var barSummary = document.getElementById('bulk-bar-summary');
  var barTotal = document.getElementById('bulk-bar-total');
  var bar = document.getElementById('bulk-action-bar');
  if (barSummary) barSummary.textContent = selected.length + ' of ' + generatedBulkNotices.length + ' selected';
  if (barTotal) barTotal.textContent = fmt(total);
  if (bar) bar.style.display = generatedBulkNotices.length ? 'flex' : 'none';
}

/* Preview the selected taxpayers' notices side by side, before saving/downloading. */
function previewSelectedBulkNotices() {
  var selected = bulkSelectedNotices();
  if (!selected.length) { showToast('⚠️ Select at least one taxpayer to preview'); return; }
  var cfg = getSettings();
  var win = window.open('', '_blank');
  if (!win) { showToast('⚠️ Enable pop-ups to preview'); return; }
  var sections = selected.map(function (n) {
    var rows = n.cases.map(function (c) {
      return '<tr><td>' + xe(c.taxPeriod) + '</td><td>' + xe(c.demandId) + '</td><td>' + xe(c.section) + '</td><td>' + fmtDate(c.dcr_date || c.demandDate) + '</td><td style="text-align:right;">' + fmt0(c.pend_total) + '</td></tr>';
    }).join('');
    return '<h2>ARREAR NOTICE — PREVIEW</h2>'
      + '<p><strong>To:</strong> ' + xe(n.legalName) + ' (GSTIN: ' + xe(n.gstin) + ')</p>'
      + '<table><thead><tr><th>Tax Period</th><th>Demand ID</th><th>Section</th><th>Order Date</th><th>Pending (₹)</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<p style="margin-top:16px;font-weight:bold;">Total Amount Payable: ₹' + fmt0(n.pendAmt) + '</p><hr style="margin:28px 0;"/>';
  }).join('');
  win.document.write(
    '<html><head><title>Notice Preview</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2b42;} h2{text-align:center;margin:4px 0;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #c8d3e0;padding:8px;font-size:12px;} th{background:#f7f9fc;}</style></head><body>' + sections + '</body></html>'
  );
  win.document.close();
}

/* Saves and downloads (Word) only the checked taxpayers, the same way the
   Issue Notice wizard's "Generate Notice" button works for a single taxpayer. */
function generateSelectedBulkNotices() {
  var selected = bulkSelectedNotices();
  if (!selected.length) { showToast('⚠️ Select at least one taxpayer'); return; }
  selected.forEach(function (n) { AppState.notices.push(n); });
  var selectedIds = new Set(selected.map(function (n) { return n.id; }));
  generatedBulkNotices = generatedBulkNotices.filter(function (n) { return !selectedIds.has(n.id); });
  _bulkSelectedIds.clear();
  persist();
  updateSidebar();
  if (typeof renderNoticeHistoryPage === 'function') renderNoticeHistoryPage();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();

  var cfg = getSettings();
  Promise.all(selected.map(function (n) {
    return buildNoticeDocx(n, cfg).then(function (blob) { downloadBlob(blob, n.num.replace(/\//g, '_') + '.docx'); });
  })).then(function () {
    showToast('✅ ' + selected.length + ' notice(s) generated');
    renderBulkResults(_bulkResultsElId);
  });
}

/* ===== Bulk Notice — "Demands Included in Notice" editor (Type/Demands cell click) =====
   Same quick-filter-chip + checkbox-table pattern as the Issue Notice wizard's
   Step 2, scoped to one already-generated bulk notice so the officer can
   review/adjust exactly which of that taxpayer's demands are included. */
var _bdeIdx = null;          // index into generatedBulkNotices being edited
var _bdeCases = [];          // that taxpayer's full notice-eligible demand set
var _bdeSelectedIds = new Set();
var _bdeFilterType = 'all';  // 'all' | 'intimation' | 'urgent' — view only
var _bdeSec62 = 'exclude';   // 'exclude' | 'all' — view only

function openBulkDemandEditor(idx) {
  var n = generatedBulkNotices[idx];
  if (!n) return;
  _bdeIdx = idx;
  _bdeFilterType = 'all';
  _bdeSec62 = 'exclude';
  _bdeCases = AppState.cases.filter(function (c) { return c.gstin === n.gstin; }).filter(isValidCase).filter(isNoticeEligible);
  _bdeSelectedIds = new Set(n.cases.map(function (c) { return c.demandId; }));
  document.getElementById('bde-title').textContent = 'Demands Included in Notice — ' + n.num;
  document.getElementById('bde-sub').textContent = xe(n.legalName) + ' (' + xe(n.gstin) + ')';
  document.querySelectorAll('#bde-quick-filter-bar .qf-chip').forEach(function (c) { c.classList.toggle('active', c.getAttribute('data-qf') === 'all'); });
  updateBdeQuickFilterCounts();
  renderBdeTable();
  document.getElementById('bulk-demand-editor-overlay').classList.add('show');
}

function closeBulkDemandEditor() {
  document.getElementById('bulk-demand-editor-overlay').classList.remove('show');
  _bdeIdx = null;
}

function bdeQuickFilter(type) {
  _bdeFilterType = type;
  document.querySelectorAll('#bde-quick-filter-bar .qf-chip[data-qf="all"], #bde-quick-filter-bar .qf-chip[data-qf="intimation"], #bde-quick-filter-bar .qf-chip[data-qf="urgent"]').forEach(function (c) {
    c.classList.toggle('active', c.getAttribute('data-qf') === type);
  });
  renderBdeTable();
}

function bdeToggleSection62() {
  _bdeSec62 = _bdeSec62 === 'all' ? 'exclude' : 'all';
  var chip = document.querySelector('#bde-quick-filter-bar .qf-chip[data-qf="section62"]');
  if (chip) chip.classList.toggle('active', _bdeSec62 === 'all');
  updateBdeQuickFilterCounts();
  renderBdeTable();
}

function updateBdeQuickFilterCounts() {
  var sec62Count = _bdeCases.filter(function (c) { return String(c.section || '').trim() === '62'; }).length;
  var base = _bdeSec62 === 'all' ? _bdeCases : _bdeCases.filter(function (c) { return String(c.section || '').trim() !== '62'; });
  var intimation = base.filter(function (c) { return isNoticeTypeMatch(c, 'intimation'); }).length;
  var urgent = base.filter(function (c) { return isNoticeTypeMatch(c, 'urgent'); }).length;
  var setText = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  setText('bde-count-all', base.length);
  setText('bde-count-intimation', intimation);
  setText('bde-count-urgent', urgent);
  setText('bde-count-section62', sec62Count);
}

function bdeFilteredCases() {
  var base = _bdeSec62 === 'all' ? _bdeCases : _bdeCases.filter(function (c) { return String(c.section || '').trim() !== '62'; });
  if (_bdeFilterType === 'all') return base;
  return base.filter(function (c) { return isNoticeTypeMatch(c, _bdeFilterType); });
}

function renderBdeTable() {
  var wrap = document.getElementById('bde-table-wrap');
  var cases = bdeFilteredCases();
  if (!cases.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No demands match this filter.</div></div>';
    bdeUpdateSummary();
    return;
  }
  var allChecked = cases.every(function (c) { return _bdeSelectedIds.has(c.demandId); });
  var someChecked = cases.some(function (c) { return _bdeSelectedIds.has(c.demandId); });
  var rows = cases.map(function (c, i) {
    var age = getDemandAgeDays(c);
    var checked = _bdeSelectedIds.has(c.demandId) ? ' checked' : '';
    return '<tr>'
      + '<td><input type="checkbox" data-demand="' + xe(c.demandId) + '"' + checked + ' onchange="bdeToggleCaseCheck(this)"></td>'
      + '<td>' + (i + 1) + '</td>'
      + '<td>' + xe(c.taxPeriod) + '</td>'
      + '<td class="demand-id">' + xe(c.demandId) + '</td>'
      + '<td>' + fmtDate(c.dcr_date || c.demandDate) + '</td>'
      + '<td style="text-align:center;">' + xe(c.section) + '</td>'
      + '<td style="text-align:center;">' + dayBadge(age) + '</td>'
      + '<td>' + xe(c.demandStatus) + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td>'
      + '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr>'
    + '<th style="width:34px;"><input type="checkbox" id="bde-select-all" onchange="bdeToggleSelectAll(this.checked)"' + (allChecked ? ' checked' : (someChecked ? '' : '')) + '></th>'
    + '<th>Sl.No.</th><th>Tax Period</th><th>Demand ID</th><th>Order Date</th><th>Section</th><th>Age (Days)</th><th>Status</th><th>Amount</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  var selectAll = document.getElementById('bde-select-all');
  if (selectAll) selectAll.indeterminate = someChecked && !allChecked;
  bdeUpdateSummary();
}

function bdeToggleCaseCheck(el) {
  var id = el.getAttribute('data-demand');
  if (el.checked) _bdeSelectedIds.add(id); else _bdeSelectedIds.delete(id);
  bdeUpdateSummary();
  var cases = bdeFilteredCases();
  var selectAll = document.getElementById('bde-select-all');
  if (selectAll) {
    var allChecked = cases.length > 0 && cases.every(function (c) { return _bdeSelectedIds.has(c.demandId); });
    var someChecked = cases.some(function (c) { return _bdeSelectedIds.has(c.demandId); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

function bdeToggleSelectAll(checked) {
  bdeFilteredCases().forEach(function (c) {
    if (checked) _bdeSelectedIds.add(c.demandId); else _bdeSelectedIds.delete(c.demandId);
  });
  renderBdeTable();
}

function bdeUpdateSummary() {
  var selected = _bdeCases.filter(function (c) { return _bdeSelectedIds.has(c.demandId); });
  var total = selected.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var el = document.getElementById('bde-summary');
  if (el) el.textContent = selected.length + ' of ' + _bdeCases.length + ' selected — ' + fmt(total);
}

function applyBulkDemandEditor() {
  if (_bdeIdx === null) return;
  var selected = _bdeCases.filter(function (c) { return _bdeSelectedIds.has(c.demandId); });
  if (!selected.length) { showToast('⚠️ Select at least one demand'); return; }
  var n = generatedBulkNotices[_bdeIdx];
  if (!n) { closeBulkDemandEditor(); return; }
  n.cases = caseSnapshots(selected);
  n.pendAmt = selected.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  closeBulkDemandEditor();
  renderBulkResults(_bulkResultsElId);
  showToast('✅ Notice demands updated');
}

function saveAllBulkNotices() {
  if (!generatedBulkNotices.length) return;
  generatedBulkNotices.forEach(function (n) { AppState.notices.push(n); });
  var count = generatedBulkNotices.length;
  generatedBulkNotices = [];
  _bulkSelectedIds.clear();
  persist();
  updateSidebar();
  if (typeof renderNoticeHistoryPage === 'function') renderNoticeHistoryPage();
  updateBulkAllCount();
  document.getElementById('bulk-all-results') && (document.getElementById('bulk-all-results').innerHTML = '');
  document.getElementById('bulk-paste-results') && (document.getElementById('bulk-paste-results').innerHTML = '');
  var bar = document.getElementById('bulk-action-bar');
  if (bar) bar.style.display = 'none';
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  showToast('✅ ' + count + ' notices saved');
}

async function downloadAllBulkNoticesZip() {
  if (!generatedBulkNotices.length) return;
  await window.LibsReady;
  var cfg = getSettings();
  var zip = new JSZip();
  var built = 0;
  var promises = generatedBulkNotices.map(function (n) {
    return buildNoticeDocx(n, cfg).then(function (blob) {
      zip.file(n.num.replace(/\//g, '_') + '_' + n.gstin + '.docx', blob);
      built++;
    });
  });
  Promise.all(promises).then(function () {
    return zip.generateAsync({ type: 'blob' });
  }).then(function (zipBlob) {
    downloadBlob(zipBlob, 'Arrear_Notices_' + todayISO() + '.zip');
    showToast('✅ Downloaded ' + built + ' notices as ZIP');
  });
}

async function downloadAllBulkNoticesPdfZip() {
  if (!generatedBulkNotices.length) return;
  await window.LibsReady;
  var cfg = getSettings();
  var zip = new JSZip();
  var built = 0;
  var promises = generatedBulkNotices.map(function (n) {
    return buildNoticePdfBlob(n, cfg).then(function (blob) {
      zip.file(n.num.replace(/\//g, '_') + '_' + n.gstin + '.pdf', blob);
      built++;
    });
  });
  Promise.all(promises).then(function () {
    return zip.generateAsync({ type: 'blob' });
  }).then(function (zipBlob) {
    downloadBlob(zipBlob, 'Arrear_Notices_PDF_' + todayISO() + '.zip');
    showToast('✅ Downloaded ' + built + ' notices as PDF ZIP');
  });
}
