/* ===== Issue Notice (Copy) — independent duplicate of the Issue Notice
   wizard in wizard.js, for the officer to remodify separately without
   touching the original tab. Uses its own wiz2-* element IDs and its own
   state (_wiz2*), scoped to #bulk-tab-notice2 so it can never read or
   mutate the original tab's DOM/state.

   Reused as-is from wizard.js (no tab-specific state or IDs, so no need
   to duplicate): tdb(), dayBadge(), wizPageNumberList(), showDemandBreakdown(),
   closeDemandBreakdown(), openWizExclusionGuide(), closeWizExclusionGuide(),
   NOTICE_REQUIRED_FIELDS. renderWizardStepper() (wizard.js) also drives this
   tab's Generate button disabled state alongside the original's. ===== */

var _wiz2GSTIN = null;
var _wiz2NoticeType = 'both';   // 'intimation' | 'urgent' | 'both'
var _wiz2Section62 = 'exclude'; // 'all' | 'exclude'

/* ===== Section 1: Search GSTIN ===== */

function wiz2SearchGSTIN() {
  var gstin = (document.getElementById('wiz2-gstin-input').value || '').trim().toUpperCase();
  document.getElementById('wiz2-gstin-input').value = gstin;
  var hint = document.getElementById('wiz2-gstin-hint');
  var detailsBar = document.getElementById('wiz2-taxpayer-details');

  if (!gstin) { hint.textContent = '⚠️ Enter a GSTIN'; return; }
  if (gstin.length !== 15) { hint.textContent = '⚠️ GSTIN must be 15 characters (got ' + gstin.length + ')'; return; }

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  if (!cases.length) {
    hint.textContent = '⚠️ ' + gstin + ' not found in imported DCR data';
    detailsBar.style.display = 'none';
    document.getElementById('wiz2-demand-section').style.display = 'none';
    return;
  }

  hint.textContent = '';
  _wiz2GSTIN = gstin;
  var reg = AppState.addressCache[gstin] || {};
  var eligibleCases = cases.filter(isValidCase).filter(isNoticeEligible);
  var pendTotal = eligibleCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  var legalName = cases[0].legalName || '—';
  var displayName = taxpayerDisplayName(gstin, legalName);

  detailsBar.style.display = 'flex';
  detailsBar.innerHTML =
    tdb('Trade Name', xe(displayName))
    + tdb('Legal Name', xe(taxpayerLegalNameCell(gstin, legalName)))
    + tdb('Status', reg.regStatus ? (isCollectible(gstin) ? '<span class="pill pill-green">' + xe(reg.regStatus) + '</span>' : '<span class="pill pill-red">' + xe(reg.regStatus) + '</span>') : '<span class="pill pill-gray">Unknown</span>')
    + tdb('Total Pending Arrear (₹)', '<span style="color:var(--red);">' + fmt(pendTotal) + '</span>')
    + tdb('No. of Demands', String(eligibleCases.length))
    + '<div class="tdb-item tdb-action"><button type="button" class="eye-btn" title="View Notice History" onclick="goToNoticeHistory(\'' + gstin + '\')"><i class="fa-solid fa-eye"></i></button></div>';

  document.getElementById('wiz2-demand-section').style.display = 'block';
  _wiz2PageSize = 10; _wiz2CurrentPage = 1;
  wiz2ResetDrawerFilters();
  _wiz2SelectedDemandIds = new Set(
    wiz2BaseCasesForNotice().filter(function (c) { return !wiz2IsFlagged(c); }).map(function (c) { return c.demandId; })
  );
  updateQuickFilterCounts2();
  applyWizardFiltersAndRender2();
}

function wiz2ClearGSTIN() {
  _wiz2GSTIN = null;
  document.getElementById('wiz2-gstin-input').value = '';
  document.getElementById('wiz2-gstin-hint').textContent = '';
  document.getElementById('wiz2-taxpayer-details').style.display = 'none';
  document.getElementById('wiz2-demand-section').style.display = 'none';
  document.getElementById('wiz2-gstin-input').focus();
}

/* ===== Section 2: Demands table (day-badges) + quick filters + Advanced Filters drawer ===== */

function wiz2IsFlagged(c) {
  if (isStatusExcluded(c)) return true;
  if (isSection62(c) && _wiz2Section62 !== 'all') return true;
  return false;
}

function wiz2BaseCasesForNotice() {
  if (!_wiz2GSTIN) return [];
  return AppState.cases.filter(function (c) { return c.gstin === _wiz2GSTIN; }).filter(isValidCase).filter(function (c) { return (Number(c.pend_total) || 0) > 0; });
}

function updateQuickFilterCounts2() {
  var base = wiz2BaseCasesForNotice();
  var sec62 = base.filter(function (c) { return isSection62(c); }).length;
  var intimation = base.filter(function (c) { return isNoticeTypeMatch(c, 'intimation'); }).length;
  var urgent = base.filter(function (c) { return isNoticeTypeMatch(c, 'urgent'); }).length;
  var setText = function (id, n) { var el = document.getElementById(id); if (el) el.textContent = n; };
  setText('qf2-count-all', base.length);
  setText('qf2-count-intimation', intimation);
  setText('qf2-count-urgent', urgent);
  setText('qf2-count-section62', sec62);
}

function updateQuickFilterActiveState2() {
  var panel = document.getElementById('bulk-tab-notice2');
  if (!panel) return;
  var active = 'all';
  if (_wiz2NoticeType === 'urgent') active = 'urgent';
  else if (_wiz2NoticeType === 'intimation') active = 'intimation';
  panel.querySelectorAll('.qf-chip[data-qf="all"], .qf-chip[data-qf="intimation"], .qf-chip[data-qf="urgent"]').forEach(function (chip) {
    chip.classList.toggle('active', chip.getAttribute('data-qf') === active);
  });
  var sec62Chip = panel.querySelector('.qf-chip[data-qf="section62"]');
  if (sec62Chip) sec62Chip.classList.toggle('active', _wiz2Section62 === 'all');
}

function quickFilterAll2() {
  wiz2ResetDrawerFilters();
  wiz2SyncSection62Selection();
  applyWizardFiltersAndRender2();
  updateWizFilterBadgeAndTags2();
}
function quickFilterIntimation2() {
  _wiz2NoticeType = 'intimation';
  syncDrawerCardsToState2();
  applyWizardFiltersAndRender2();
  updateWizFilterBadgeAndTags2();
}
function quickFilterUrgent2() {
  _wiz2NoticeType = 'urgent';
  syncDrawerCardsToState2();
  applyWizardFiltersAndRender2();
  updateWizFilterBadgeAndTags2();
}
function toggleSection62Included2() {
  _wiz2Section62 = _wiz2Section62 === 'all' ? 'exclude' : 'all';
  syncDrawerCardsToState2();
  wiz2SyncSection62Selection();
  applyWizardFiltersAndRender2();
  updateWizFilterBadgeAndTags2();
}

function syncDrawerCardsToState2() {
  var panel = document.getElementById('bulk-tab-notice2');
  if (!panel) return;
  panel.querySelectorAll('.notice-type-card').forEach(function (c) { c.classList.toggle('selected', c.getAttribute('data-type') === _wiz2NoticeType); });
  panel.querySelectorAll('.filter-card').forEach(function (c) { c.classList.toggle('selected', c.getAttribute('data-mode') === _wiz2Section62); });
}

function selectWizNoticeType2(type, el) {
  _wiz2NoticeType = type;
  var panel = document.getElementById('bulk-tab-notice2');
  if (panel) panel.querySelectorAll('.notice-type-card').forEach(function (c) { c.classList.remove('selected'); });
  el.classList.add('selected');
}
function selectWizSectionFilter2(mode, el) {
  _wiz2Section62 = mode;
  var panel = document.getElementById('bulk-tab-notice2');
  if (panel) panel.querySelectorAll('.filter-card').forEach(function (c) { c.classList.remove('selected'); });
  el.classList.add('selected');
}

function wiz2ResetDrawerFilters() {
  _wiz2NoticeType = 'both'; _wiz2Section62 = 'exclude';
  syncDrawerCardsToState2();
  ['wiz2-order-date-from', 'wiz2-order-date-to', 'wiz2-tax-period-from', 'wiz2-tax-period-to'].forEach(function (id) { document.getElementById(id).value = ''; });
  document.getElementById('wiz2-demand-type').value = 'All';
}

function wiz2ClearAllFilters() {
  wiz2ResetDrawerFilters();
  wiz2SyncSection62Selection();
  applyWizardFiltersAndRender2();
  updateWizFilterBadgeAndTags2();
}

function wizApplyFilters2() {
  wiz2SyncSection62Selection();
  applyWizardFiltersAndRender2();
  updateWizFilterBadgeAndTags2();
  closeWizFilterDrawer2();
}

var _wiz2DrawerSnapshot = null;

function openWizFilterDrawer2() {
  _wiz2DrawerSnapshot = {
    noticeType: _wiz2NoticeType, section62: _wiz2Section62,
    odFrom: document.getElementById('wiz2-order-date-from').value,
    odTo: document.getElementById('wiz2-order-date-to').value,
    tpFrom: document.getElementById('wiz2-tax-period-from').value,
    tpTo: document.getElementById('wiz2-tax-period-to').value,
    demandType: document.getElementById('wiz2-demand-type').value
  };
  document.getElementById('wiz2-filter-drawer').classList.add('show');
  document.getElementById('wiz2-filter-drawer-overlay').classList.add('show');
}

function cancelWizFilterDrawer2() {
  var s = _wiz2DrawerSnapshot;
  if (s) {
    _wiz2NoticeType = s.noticeType; _wiz2Section62 = s.section62;
    syncDrawerCardsToState2();
    document.getElementById('wiz2-order-date-from').value = s.odFrom;
    document.getElementById('wiz2-order-date-to').value = s.odTo;
    document.getElementById('wiz2-tax-period-from').value = s.tpFrom;
    document.getElementById('wiz2-tax-period-to').value = s.tpTo;
    document.getElementById('wiz2-demand-type').value = s.demandType;
  }
  closeWizFilterDrawer2();
}

function closeWizFilterDrawer2() {
  document.getElementById('wiz2-filter-drawer').classList.remove('show');
  document.getElementById('wiz2-filter-drawer-overlay').classList.remove('show');
}

function updateWizFilterBadgeAndTags2() {
  updateQuickFilterActiveState2();
  updateQuickFilterCounts2();

  var badge = document.getElementById('wiz2-filters-badge');
  var tagsWrap = document.getElementById('wiz2-active-filter-tags');
  var odFrom = document.getElementById('wiz2-order-date-from').value;
  var odTo = document.getElementById('wiz2-order-date-to').value;
  var tpFrom = (document.getElementById('wiz2-tax-period-from').value || '').trim();
  var tpTo = (document.getElementById('wiz2-tax-period-to').value || '').trim();
  var demandType = document.getElementById('wiz2-demand-type').value;

  var tags = [];
  if (_wiz2NoticeType !== 'both') tags.push(_wiz2NoticeType === 'urgent' ? 'Urgent ≥ 90 days' : 'Intimation < 90 days');
  if (_wiz2Section62 === 'all') tags.push('Section 62 included');
  if (demandType && demandType !== 'All') tags.push(demandType);
  if (odFrom || odTo) tags.push('Order Date: ' + (odFrom ? fmtDate(odFrom) : '…') + ' – ' + (odTo ? fmtDate(odTo) : '…'));
  if (tpFrom || tpTo) tags.push('Tax Period: ' + (tpFrom || '…') + ' – ' + (tpTo || '…'));

  if (badge) {
    if (tags.length) { badge.textContent = String(tags.length); badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }

  if (tagsWrap) {
    if (!tags.length) { tagsWrap.style.display = 'none'; tagsWrap.innerHTML = ''; return; }
    var shown = _wiz2FilteredCases.length;
    var total = wiz2BaseCasesForNotice().length;
    tagsWrap.style.display = 'flex';
    tagsWrap.innerHTML = '<span class="filter-summary-count">Showing ' + shown + ' of ' + total + ' demands</span>'
      + tags.map(function (t) { return '<span class="filter-tag">' + xe(t) + '</span>'; }).join('')
      + '<button type="button" class="filter-tag-clear" onclick="wiz2ClearAllFilters()"><i class="fa-solid fa-xmark"></i> Clear All</button>';
  }
}

function applyWizardFiltersAndRender2() {
  if (!_wiz2GSTIN) return;
  var odFrom = document.getElementById('wiz2-order-date-from').value;
  var odTo = document.getElementById('wiz2-order-date-to').value;
  var tpFrom = (document.getElementById('wiz2-tax-period-from').value || '').trim();
  var tpTo = (document.getElementById('wiz2-tax-period-to').value || '').trim();
  var demandType = document.getElementById('wiz2-demand-type').value;

  var cases = wiz2BaseCasesForNotice();

  cases = cases.filter(function (c) {
    if (_wiz2NoticeType === 'both') return true;
    return isNoticeTypeMatch(c, _wiz2NoticeType);
  });
  if (demandType && demandType !== 'All') cases = cases.filter(function () { return demandType === 'Tax'; });
  if (odFrom || odTo) {
    cases = cases.filter(function (c) {
      var d = parseDcrDate(c.dcr_date || c.demandDate);
      if (!d) return true;
      if (odFrom && d < new Date(odFrom)) return false;
      if (odTo && d > new Date(odTo + 'T23:59:59')) return false;
      return true;
    });
  }
  if (tpFrom) cases = cases.filter(function (c) { return (c.taxPeriod || '').toUpperCase().indexOf(tpFrom.toUpperCase()) !== -1; });
  if (tpTo) cases = cases.filter(function (c) { return (c.taxPeriod || '').toUpperCase().indexOf(tpTo.toUpperCase()) !== -1; });

  renderWizardDemandTable2(cases);
  updateQuickFilterActiveState2();
}

var _wiz2PageSize = 10;
var _wiz2CurrentPage = 1;
var _wiz2FilteredCases = [];
var _wiz2SelectedDemandIds = new Set();

function renderWizardDemandTable2(cases) {
  _wiz2FilteredCases = cases;
  _wiz2CurrentPage = 1;
  renderWizardTablePage2();
}

function renderWizardTablePage2() {
  var wrap = document.getElementById('wiz2-demand-table-wrap');
  var cases = _wiz2FilteredCases;

  if (!cases.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No demands match the current filters for this taxpayer.</div></div>';
    wiz2UpdateSelectionSummary();
    return;
  }

  var pageSize = _wiz2PageSize === 'all' ? cases.length : _wiz2PageSize;
  var totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  if (_wiz2CurrentPage > totalPages) _wiz2CurrentPage = totalPages;
  if (_wiz2CurrentPage < 1) _wiz2CurrentPage = 1;
  var startIdx = (_wiz2CurrentPage - 1) * pageSize;
  var pageCases = cases.slice(startIdx, startIdx + pageSize);

  var rows = pageCases.map(function (c, i) {
    var age = getDemandAgeDays(c);
    var checked = _wiz2SelectedDemandIds.has(c.demandId) ? ' checked' : '';
    var flagged = wiz2IsFlagged(c);
    var badge = !flagged ? '' : (isStatusExcluded(c)
      ? ' <span class="pill pill-orange wiz-excluded-badge" title="Not notice-eligible by default (higher forum / closed / refund status) — tick the box to include it anyway">Excluded</span>'
      : ' <span class="pill pill-gold wiz-excluded-badge" title="Section 62 best-judgment assessment — not treated as a confirmed arrear by default, tick the box (or the Include Section 62 chip) to include it anyway">Section 62</span>');
    var statusCell = xe(c.demandStatus) + badge;
    return '<tr' + (flagged ? ' class="wiz-row-excluded"' : '') + '>'
      + '<td><input type="checkbox" class="wiz-case-chk" data-demand="' + xe(c.demandId) + '" data-amt="' + (Number(c.pend_total) || 0) + '"' + checked + ' onchange="wiz2ToggleCaseCheck(this)"></td>'
      + '<td>' + (startIdx + i + 1) + '</td>'
      + '<td>' + xe(c.taxPeriod) + '</td>'
      + '<td class="demand-id">' + xe(c.demandId) + '</td>'
      + '<td>' + fmtDate(c.dcr_date || c.demandDate) + '</td>'
      + '<td style="text-align:center;">' + xe(c.section) + '</td>'
      + '<td style="text-align:center;">' + dayBadge(age) + '</td>'
      + '<td>' + statusCell + '</td>'
      + '<td><div class="amount-cell pending clickable" onclick="showDemandBreakdown(\'' + xe(c.demandId) + '\')" title="Click for IGST/CGST/SGST/CESS breakdown">' + fmt(c.pend_total) + '</div></td>'
      + '</tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="wiz2-select-all" onchange="wiz2ToggleSelectAll(this.checked)"></th><th>Sl.No.</th><th>Tax Period</th><th>Demand ID</th><th>Order Date</th><th>Section</th><th>Days</th><th>Demand Status</th><th>Pending Arrear (₹)</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div class="day-legend"><span><span class="dot green"></span>&lt; 60 days</span><span><span class="dot orange"></span>60 – 89 days</span><span><span class="dot red"></span>&ge; 90 days</span></div>'
    + wiz2PaginationHTML(cases.length, startIdx, pageCases.length, totalPages);

  wiz2UpdateSelectionSummary();
}

function wiz2PaginationHTML(total, startIdx, pageCount, totalPages) {
  var pageBtns = wizPageNumberList(_wiz2CurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _wiz2CurrentPage ? ' active' : '') + '" onclick="wiz2GoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');

  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_wiz2PageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_wiz2PageSize === 'all' ? ' selected' : '') + '>All</option>';

  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="wiz2GoToPage(-1)"' + (_wiz2CurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="wiz2GoToPage(1)"' + (_wiz2CurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="wiz2SetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}

function wiz2SetPageSize(val) {
  _wiz2PageSize = val === 'all' ? 'all' : parseInt(val, 10);
  _wiz2CurrentPage = 1;
  renderWizardTablePage2();
}
function wiz2GoToPage(delta) {
  _wiz2CurrentPage += delta;
  renderWizardTablePage2();
}
function wiz2GoToPageNum(n) {
  _wiz2CurrentPage = n;
  renderWizardTablePage2();
}

function wiz2ToggleCaseCheck(el) {
  var id = el.getAttribute('data-demand');
  if (el.checked) _wiz2SelectedDemandIds.add(id); else _wiz2SelectedDemandIds.delete(id);
  wiz2UpdateSelectionSummary();
}

function wiz2ToggleSelectAll(checked) {
  _wiz2FilteredCases.forEach(function (c) {
    if (checked) { if (!wiz2IsFlagged(c)) _wiz2SelectedDemandIds.add(c.demandId); }
    else _wiz2SelectedDemandIds.delete(c.demandId);
  });
  renderWizardTablePage2();
}

function wiz2SyncSection62Selection() {
  _wiz2FilteredCases.filter(function (c) { return isSection62(c); }).forEach(function (c) {
    if (_wiz2Section62 === 'all') _wiz2SelectedDemandIds.add(c.demandId);
    else _wiz2SelectedDemandIds.delete(c.demandId);
  });
}

function wiz2UpdateSelectionSummary() {
  var totalAvailable = _wiz2FilteredCases.length;
  var selectedCases = wiz2SelectedCases();
  var total = selectedCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var barSummary = document.getElementById('wiz2-bar-summary');
  var barTotal = document.getElementById('wiz2-bar-total');
  var headTotal = document.getElementById('wiz2-head-total');
  var headCount = document.getElementById('wiz2-head-count');
  if (barSummary) barSummary.textContent = selectedCases.length + ' of ' + totalAvailable + ' selected';
  if (barTotal) barTotal.textContent = fmt(total);
  if (headTotal) headTotal.textContent = fmt(total);
  if (headCount) headCount.textContent = selectedCases.length + ' of ' + totalAvailable + ' selected';

  var selectAll = document.getElementById('wiz2-select-all');
  if (selectAll) {
    var eligibleFiltered = _wiz2FilteredCases.filter(function (c) { return !wiz2IsFlagged(c); });
    var allChecked = eligibleFiltered.length > 0 && eligibleFiltered.every(function (c) { return _wiz2SelectedDemandIds.has(c.demandId); });
    var someChecked = _wiz2FilteredCases.some(function (c) { return _wiz2SelectedDemandIds.has(c.demandId); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

/* ===== Selected cases + notice building ===== */

function wiz2SelectedCases() {
  var filteredIds = new Set(_wiz2FilteredCases.map(function (c) { return c.demandId; }));
  return AppState.cases.filter(function (c) { return c.gstin === _wiz2GSTIN && _wiz2SelectedDemandIds.has(c.demandId) && filteredIds.has(c.demandId); });
}

function wiz2BuildNotices() {
  var cases = wiz2SelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand'); return []; }
  var c0 = cases[0];
  var buckets = { intimation: [], urgent: [] };
  cases.forEach(function (c) {
    var age = getDemandAgeDays(c);
    (age !== null && age >= 90 ? buckets.urgent : buckets.intimation).push(c);
  });

  var out = [];
  var seq = AppState.notices.length;
  ['intimation', 'urgent'].forEach(function (kind) {
    var list = buckets[kind];
    if (!list.length) return;
    seq++;
    var pendAmt = list.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
    out.push({
      id: uid('notice'), gstin: _wiz2GSTIN, legalName: c0.legalName, cases: caseSnapshots(list), pendAmt: pendAmt,
      type: kind === 'urgent' ? 'demand' : 'reminder', noticeKind: kind,
      num: 'NOT/' + new Date().getFullYear() + '/' + String(seq).padStart(4, '0'),
      date: todayISO(), replyDate: kind === 'urgent' ? '' : addDaysISO(todayISO(), 30),
      address: (AppState.addressCache[_wiz2GSTIN] || {}).address || '', details: '',
      createdAt: new Date().toISOString()
    });
  });
  return out;
}

function wizGenerateNotice2() {
  if (!AppState.cases.length || !hasRegisterData()) { showToast('⚠️ Upload DCR and Taxpayer Register before generating a notice'); return; }
  var noticesToSave = wiz2BuildNotices();
  if (!noticesToSave.length) return;
  for (var i = 0; i < noticesToSave.length; i++) {
    if (!confirmMissingFields(noticesToSave[i], NOTICE_REQUIRED_FIELDS, 'Notice ' + noticesToSave[i].num)) return;
  }
  noticesToSave.forEach(function (n) { AppState.notices.push(n); });
  persist();
  updateSidebar();
  renderWizardStepper();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();

  var cfg = getSettings();
  Promise.all(noticesToSave.map(function (n) {
    return buildNoticeDocx(n, cfg).then(function (blob) { downloadBlob(blob, n.num.replace(/\//g, '_') + '.docx'); });
  })).then(function () {
    showToast('✅ ' + noticesToSave.length + ' notice(s) generated — ' + noticesToSave.map(function (n) { return n.num; }).join(', '));
  });
}

function previewWizardNotice2() {
  var cases = wiz2SelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand to preview'); return; }
  var cfg = getSettings();
  var pendAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var rows = cases.map(function (c) {
    return '<tr><td>' + xe(c.taxPeriod) + '</td><td>' + xe(c.demandId) + '</td><td>' + xe(c.section) + '</td><td>' + fmtDate(c.dcr_date || c.demandDate) + '</td><td style="text-align:right;">' + fmt0(c.pend_total) + '</td></tr>';
  }).join('');
  var win = window.open('', '_blank');
  if (!win) { showToast('⚠️ Enable pop-ups to preview'); return; }
  win.document.write(
    '<html><head><title>Notice Preview</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2b42;} h2,h3{text-align:center;margin:4px 0;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #c8d3e0;padding:8px;font-size:12px;} th{background:#f7f9fc;}</style></head><body>'
    + '<h3>OFFICE OF THE ' + xe((cfg.desig || '').toUpperCase()) + '</h3><h3>' + xe(cfg.circle) + '</h3><p style="text-align:center;">' + xe(cfg.addr1) + ' ' + xe(cfg.addr2) + '</p>'
    + '<h2>ARREAR NOTICE — PREVIEW</h2>'
    + '<p><strong>To:</strong> ' + xe(cases[0].legalName) + ' (GSTIN: ' + xe(_wiz2GSTIN) + ')</p>'
    + '<table><thead><tr><th>Tax Period</th><th>Demand ID</th><th>Section</th><th>Order Date</th><th>Pending (₹)</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p style="margin-top:16px;font-weight:bold;">Total Amount Payable: ₹' + fmt0(pendAmt) + '</p>'
    + '</body></html>'
  );
  win.document.close();
}
