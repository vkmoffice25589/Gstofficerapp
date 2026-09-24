/* ===== Generate Arrear Notice — stepper wizard (Search GSTIN -> Demands -> Notice Type & Filters -> Generate) ===== */

var _wizGSTIN = null;
var _wizNoticeType = 'both';   // 'intimation' | 'urgent' | 'both'
/* Section 62 (best-judgment assessment) demands are not treated as confirmed
   arrears by default — 'exclude' unless the officer explicitly opts in via the
   "Include Section 62" toggle or the Advanced Filters drawer. */
var _wizSection62 = 'exclude'; // 'all' | 'exclude'

/* ===== Upload panels (DCR + Taxpayer Register) ===== */

function renderWizardStepper() {
  var hasDCR = AppState.cases.length > 0;
  var hasReg = hasRegisterData();
  var bothReady = hasDCR && hasReg;

  if (typeof renderDCRSection === 'function') renderDCRSection();
  if (typeof renderTpRegSection === 'function') renderTpRegSection();

  var genBtn = document.getElementById('wiz-generate-notice-btn');
  if (genBtn) genBtn.disabled = !bothReady;

  var banner = document.getElementById('wiz-ready-banner');
  if (banner) banner.style.display = bothReady ? 'flex' : 'none';

  if (bothReady && !_wizBothUploadedNotified) {
    _wizBothUploadedNotified = true;
    showToast('✅ Both files uploaded successfully. Ready to issue notice.');
  } else if (!bothReady) {
    _wizBothUploadedNotified = false;
  }
}

/* Still used as a quick-link target from the "Upload Taxpayer Register"
   shortcut button on the Issue Notice tab (see index.html). */
function wizChevronGoToTaxpayerRegister() {
  var section = document.getElementById('wizard-tpreg-section');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* DCR/Taxpayer Register upload now lives on its own page (#page-dataupload).
   Once both are ready, "proceed" means leaving that page and landing on
   Generate Arrear Notice, which will render the tabs section itself. */
function wizProceedToNoticeGeneration() {
  if (!AppState.cases.length || !hasRegisterData()) return;
  nav('bulknotice');
}

/* Generate Arrear Notice's own page renderer — shows the enforcement tabs
   if DCR + Taxpayer Register are both ready, otherwise shows an inline
   empty-state (in case the popup gets dismissed) plus a popup prompting the
   officer to go upload them, so it's never a silent dead end. */
function renderBulkNoticePage() {
  var hasDCR = AppState.cases.length > 0;
  var hasReg = hasRegisterData();
  var bothReady = hasDCR && hasReg;

  var tabsSection = document.getElementById('bulknotice-tabs-section');
  var notReady = document.getElementById('bulknotice-not-ready');
  if (tabsSection) tabsSection.style.display = bothReady ? 'block' : 'none';
  if (notReady) notReady.style.display = bothReady ? 'none' : 'block';

  if (!bothReady) {
    var msg = document.getElementById('bulknotice-not-ready-msg');
    if (msg) {
      msg.textContent = (!hasDCR && !hasReg) ? 'Upload both DCR and the Taxpayer Register to start generating notices and taking recovery action.'
        : !hasDCR ? 'Upload the DCR — the Taxpayer Register is already in.'
        : 'Upload the Taxpayer Register — the DCR is already in.';
    }
    openDataUploadPrompt(hasDCR, hasReg);
  }
}

function openDataUploadPrompt(hasDCR, hasReg) {
  var status = document.getElementById('dataupload-prompt-status');
  if (status) {
    status.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' + (hasDCR ? '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--ink3);"></i>') + ' DCR</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">' + (hasReg ? '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--ink3);"></i>') + ' Taxpayer Register</div>';
  }
  var overlay = document.getElementById('dataupload-prompt-overlay');
  if (overlay) overlay.classList.add('show');
}
function closeDataUploadPrompt() {
  var overlay = document.getElementById('dataupload-prompt-overlay');
  if (overlay) overlay.classList.remove('show');
}

/* Tracks whether the "both files uploaded" popup has already fired for the
   current pair of uploads, so it shows once per DCR+Register combination
   rather than on every stepper re-render. */
var _wizBothUploadedNotified = false;


/* ===== Section 1: Search GSTIN ===== */

function wizSearchGSTIN() {
  var gstin = (document.getElementById('wiz-gstin-input').value || '').trim().toUpperCase();
  document.getElementById('wiz-gstin-input').value = gstin;
  var hint = document.getElementById('wiz-gstin-hint');
  var detailsBar = document.getElementById('wiz-taxpayer-details');

  if (!gstin) { hint.textContent = '⚠️ Enter a GSTIN'; return; }
  if (gstin.length !== 15) { hint.textContent = '⚠️ GSTIN must be 15 characters (got ' + gstin.length + ')'; return; }

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  if (!cases.length) {
    hint.textContent = '⚠️ ' + gstin + ' not found in imported DCR data';
    detailsBar.style.display = 'none';
    document.getElementById('wiz-demand-section').style.display = 'none';
    return;
  }

  hint.textContent = '';
  _wizGSTIN = gstin;
  var reg = AppState.addressCache[gstin] || {};
  // Eligible-only (not just isValidCase) so this bar matches the demand picker below it —
  // demands with zero/negative pending or an excluded status are real DCR rows but never notice-able.
  var eligibleCases = cases.filter(isValidCase).filter(isNoticeEligible);
  var pendTotal = eligibleCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  // Trade Name comes from the Taxpayer Register, matched by GSTIN — the
  // register file only ever carries a trade name, not a legal name. Legal
  // Name always comes from the DCR record itself. When the register has no
  // trade name for this GSTIN (not uploaded, or no match), fall back to
  // showing the DCR legal name so the primary name field is never blank.
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

  document.getElementById('wiz-demand-section').style.display = 'block';
  _wizSelectedDemandIds = new Set();
  _wizPageSize = 10; _wizCurrentPage = 1;
  wizResetDrawerFilters();
  updateQuickFilterCounts();
  applyWizardFiltersAndRender();
}

function wizClearGSTIN() {
  _wizGSTIN = null;
  document.getElementById('wiz-gstin-input').value = '';
  document.getElementById('wiz-gstin-hint').textContent = '';
  document.getElementById('wiz-taxpayer-details').style.display = 'none';
  document.getElementById('wiz-demand-section').style.display = 'none';
  document.getElementById('wiz-gstin-input').focus();
}

function tdb(label, val) { return '<div class="tdb-item"><div class="tdb-label">' + label + '</div><div class="tdb-val">' + val + '</div></div>'; }

/* ===== Section 2: Demands table (day-badges) + quick filters + Advanced Filters drawer ===== */

function dayBadge(age) {
  if (age === null) return '<span class="day-badge d-orange">—</span>';
  var cls = age < 60 ? 'd-green' : age < 90 ? 'd-orange' : 'd-red';
  return '<span class="day-badge ' + cls + '">' + age + '</span>';
}

/* The full notice-eligible case list for the searched GSTIN, before any
   quick/advanced filter is applied — used both as the filter base and to
   compute the quick-filter chip counts. */
function wizBaseEligibleCases() {
  if (!_wizGSTIN) return [];
  return AppState.cases.filter(function (c) { return c.gstin === _wizGSTIN; }).filter(isValidCase).filter(isNoticeEligible);
}

function updateQuickFilterCounts() {
  var raw = wizBaseEligibleCases();
  var sec62 = raw.filter(function (c) { return String(c.section || '').trim() === '62'; }).length;
  var base = _wizSection62 === 'all' ? raw : raw.filter(function (c) { return String(c.section || '').trim() !== '62'; });
  var intimation = base.filter(function (c) { return isNoticeTypeMatch(c, 'intimation'); }).length;
  var urgent = base.filter(function (c) { return isNoticeTypeMatch(c, 'urgent'); }).length;
  var setText = function (id, n) { var el = document.getElementById(id); if (el) el.textContent = n; };
  setText('qf-count-all', base.length);
  setText('qf-count-intimation', intimation);
  setText('qf-count-urgent', urgent);
  setText('qf-count-section62', sec62);
}

function updateQuickFilterActiveState() {
  var active = 'all';
  if (_wizNoticeType === 'urgent') active = 'urgent';
  else if (_wizNoticeType === 'intimation') active = 'intimation';
  document.querySelectorAll('.qf-chip[data-qf="all"], .qf-chip[data-qf="intimation"], .qf-chip[data-qf="urgent"]').forEach(function (chip) {
    chip.classList.toggle('active', chip.getAttribute('data-qf') === active);
  });
  var sec62Chip = document.querySelector('.qf-chip[data-qf="section62"]');
  if (sec62Chip) sec62Chip.classList.toggle('active', _wizSection62 === 'all');
}

function quickFilterAll() {
  wizResetDrawerFilters();
  applyWizardFiltersAndRender();
  updateWizFilterBadgeAndTags();
}
function quickFilterIntimation() {
  _wizNoticeType = 'intimation';
  syncDrawerCardsToState();
  applyWizardFiltersAndRender();
  updateWizFilterBadgeAndTags();
}
function quickFilterUrgent() {
  _wizNoticeType = 'urgent';
  syncDrawerCardsToState();
  applyWizardFiltersAndRender();
  updateWizFilterBadgeAndTags();
}
/* Independent toggle, not part of the All/Intimation/Urgent radio group —
   Section 62 demands stay excluded from every view until the officer opts in. */
function toggleSection62Included() {
  _wizSection62 = _wizSection62 === 'all' ? 'exclude' : 'all';
  syncDrawerCardsToState();
  applyWizardFiltersAndRender();
  updateWizFilterBadgeAndTags();
}

/* Reflect _wizNoticeType/_wizSection62 onto the drawer's card selection state. */
function syncDrawerCardsToState() {
  document.querySelectorAll('.notice-type-card').forEach(function (c) { c.classList.toggle('selected', c.getAttribute('data-type') === _wizNoticeType); });
  document.querySelectorAll('.filter-card').forEach(function (c) { c.classList.toggle('selected', c.getAttribute('data-mode') === _wizSection62); });
}

/* Card clicks inside the drawer only update the draft selection — the
   demand table isn't touched until "Apply Filters" is clicked. */
function selectWizNoticeType(type, el) {
  _wizNoticeType = type;
  document.querySelectorAll('.notice-type-card').forEach(function (c) { c.classList.remove('selected'); });
  el.classList.add('selected');
}
function selectWizSectionFilter(mode, el) {
  _wizSection62 = mode;
  document.querySelectorAll('.filter-card').forEach(function (c) { c.classList.remove('selected'); });
  el.classList.add('selected');
}

/* Resets the drawer's fields to defaults. Does NOT re-render the table or
   close the drawer — call applyWizardFiltersAndRender() separately if the
   reset should take effect immediately. */
function wizResetDrawerFilters() {
  _wizNoticeType = 'both'; _wizSection62 = 'exclude';
  syncDrawerCardsToState();
  ['wiz-order-date-from', 'wiz-order-date-to', 'wiz-tax-period-from', 'wiz-tax-period-to'].forEach(function (id) { document.getElementById(id).value = ''; });
  document.getElementById('wiz-demand-type').value = 'All';
}

function wizClearAllFilters() {
  wizResetDrawerFilters();
  applyWizardFiltersAndRender();
  updateWizFilterBadgeAndTags();
}

function wizApplyFilters() {
  applyWizardFiltersAndRender();
  updateWizFilterBadgeAndTags();
  closeWizFilterDrawer();
}

var _wizDrawerSnapshot = null;

function openWizFilterDrawer() {
  _wizDrawerSnapshot = {
    noticeType: _wizNoticeType, section62: _wizSection62,
    odFrom: document.getElementById('wiz-order-date-from').value,
    odTo: document.getElementById('wiz-order-date-to').value,
    tpFrom: document.getElementById('wiz-tax-period-from').value,
    tpTo: document.getElementById('wiz-tax-period-to').value,
    demandType: document.getElementById('wiz-demand-type').value
  };
  document.getElementById('wiz-filter-drawer').classList.add('show');
  document.getElementById('wiz-filter-drawer-overlay').classList.add('show');
}

/* Closes WITHOUT applying — restores whatever was actually applied to the
   table before the drawer was opened, discarding any unapplied clicks. */
function cancelWizFilterDrawer() {
  var s = _wizDrawerSnapshot;
  if (s) {
    _wizNoticeType = s.noticeType; _wizSection62 = s.section62;
    syncDrawerCardsToState();
    document.getElementById('wiz-order-date-from').value = s.odFrom;
    document.getElementById('wiz-order-date-to').value = s.odTo;
    document.getElementById('wiz-tax-period-from').value = s.tpFrom;
    document.getElementById('wiz-tax-period-to').value = s.tpTo;
    document.getElementById('wiz-demand-type').value = s.demandType;
  }
  closeWizFilterDrawer();
}

function closeWizFilterDrawer() {
  document.getElementById('wiz-filter-drawer').classList.remove('show');
  document.getElementById('wiz-filter-drawer-overlay').classList.remove('show');
}

/* Active-filter badge (on Advanced Filters), quick-filter chip highlight, and
   the "Showing X of Y demands" summary + tag row above the table. */
function updateWizFilterBadgeAndTags() {
  updateQuickFilterActiveState();
  updateQuickFilterCounts();

  var badge = document.getElementById('wiz-filters-badge');
  var tagsWrap = document.getElementById('wiz-active-filter-tags');
  var odFrom = document.getElementById('wiz-order-date-from').value;
  var odTo = document.getElementById('wiz-order-date-to').value;
  var tpFrom = (document.getElementById('wiz-tax-period-from').value || '').trim();
  var tpTo = (document.getElementById('wiz-tax-period-to').value || '').trim();
  var demandType = document.getElementById('wiz-demand-type').value;

  var tags = [];
  if (_wizNoticeType !== 'both') tags.push(_wizNoticeType === 'urgent' ? 'Urgent ≥ 90 days' : 'Intimation < 90 days');
  if (_wizSection62 === 'all') tags.push('Section 62 included');
  if (demandType && demandType !== 'All') tags.push(demandType);
  if (odFrom || odTo) tags.push('Order Date: ' + (odFrom ? fmtDate(odFrom) : '…') + ' – ' + (odTo ? fmtDate(odTo) : '…'));
  if (tpFrom || tpTo) tags.push('Tax Period: ' + (tpFrom || '…') + ' – ' + (tpTo || '…'));

  if (badge) {
    if (tags.length) { badge.textContent = String(tags.length); badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }

  if (tagsWrap) {
    if (!tags.length) { tagsWrap.style.display = 'none'; tagsWrap.innerHTML = ''; return; }
    var shown = _wizFilteredCases.length;
    var total = wizBaseEligibleCases().length;
    tagsWrap.style.display = 'flex';
    tagsWrap.innerHTML = '<span class="filter-summary-count">Showing ' + shown + ' of ' + total + ' demands</span>'
      + tags.map(function (t) { return '<span class="filter-tag">' + xe(t) + '</span>'; }).join('')
      + '<button type="button" class="filter-tag-clear" onclick="wizClearAllFilters()"><i class="fa-solid fa-xmark"></i> Clear All</button>';
  }
}

function applyWizardFiltersAndRender() {
  if (!_wizGSTIN) return;
  var odFrom = document.getElementById('wiz-order-date-from').value;
  var odTo = document.getElementById('wiz-order-date-to').value;
  var tpFrom = (document.getElementById('wiz-tax-period-from').value || '').trim();
  var tpTo = (document.getElementById('wiz-tax-period-to').value || '').trim();
  var demandType = document.getElementById('wiz-demand-type').value;

  var cases = wizBaseEligibleCases();

  cases = cases.filter(function (c) {
    if (_wizNoticeType === 'both') return true;
    return isNoticeTypeMatch(c, _wizNoticeType);
  });
  if (_wizSection62 === 'exclude') cases = cases.filter(function (c) { return String(c.section || '').trim() !== '62'; });
  // Every demand in this system is a Tax demand — Interest/Penalty/Other are
  // real options in the dropdown but honestly match zero rows, since that
  // breakdown doesn't exist in the DCR data.
  if (demandType && demandType !== 'All') cases = cases.filter(function () { return demandType === 'Tax'; });
  if (odFrom || odTo) {
    cases = cases.filter(function (c) {
      var d = parseDcrDate(c.dcr_date || c.demandDate);
      if (!d) return true; // can't parse — don't drop it
      if (odFrom && d < new Date(odFrom)) return false;
      if (odTo && d > new Date(odTo + 'T23:59:59')) return false;
      return true;
    });
  }
  if (tpFrom) cases = cases.filter(function (c) { return (c.taxPeriod || '').toUpperCase().indexOf(tpFrom.toUpperCase()) !== -1; });
  if (tpTo) cases = cases.filter(function (c) { return (c.taxPeriod || '').toUpperCase().indexOf(tpTo.toUpperCase()) !== -1; });

  renderWizardDemandTable(cases);
  updateQuickFilterActiveState();
}

var _wizPageSize = 10;          // number, or 'all'
var _wizCurrentPage = 1;
var _wizFilteredCases = [];      // full filtered set (every page)
var _wizSelectedDemandIds = new Set(); // persists across pagination + filter changes

function renderWizardDemandTable(cases) {
  _wizFilteredCases = cases;
  _wizCurrentPage = 1;
  renderWizardTablePage();
}

function renderWizardTablePage() {
  var wrap = document.getElementById('wiz-demand-table-wrap');
  var cases = _wizFilteredCases;

  if (!cases.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No demands match the current filters for this taxpayer.</div></div>';
    wizUpdateSelectionSummary();
    return;
  }

  var pageSize = _wizPageSize === 'all' ? cases.length : _wizPageSize;
  var totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  if (_wizCurrentPage > totalPages) _wizCurrentPage = totalPages;
  if (_wizCurrentPage < 1) _wizCurrentPage = 1;
  var startIdx = (_wizCurrentPage - 1) * pageSize;
  var pageCases = cases.slice(startIdx, startIdx + pageSize);

  var rows = pageCases.map(function (c, i) {
    var age = getDemandAgeDays(c);
    var checked = _wizSelectedDemandIds.has(c.demandId) ? ' checked' : '';
    return '<tr>'
      + '<td><input type="checkbox" class="wiz-case-chk" data-demand="' + xe(c.demandId) + '" data-amt="' + (Number(c.pend_total) || 0) + '"' + checked + ' onchange="wizToggleCaseCheck(this)"></td>'
      + '<td>' + (startIdx + i + 1) + '</td>'
      + '<td>' + xe(c.taxPeriod) + '</td>'
      + '<td class="demand-id">' + xe(c.demandId) + '</td>'
      + '<td>' + fmtDate(c.dcr_date || c.demandDate) + '</td>'
      + '<td style="text-align:center;">' + xe(c.section) + '</td>'
      + '<td style="text-align:center;">' + dayBadge(age) + '</td>'
      + '<td>' + xe(c.demandStatus) + '</td>'
      + '<td><div class="amount-cell pending clickable" onclick="showDemandBreakdown(\'' + xe(c.demandId) + '\')" title="Click for IGST/CGST/SGST/CESS breakdown">' + fmt(c.pend_total) + '</div></td>'
      + '</tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="wiz-select-all" onchange="wizToggleSelectAll(this.checked)"></th><th>Sl.No.</th><th>Tax Period</th><th>Demand ID</th><th>Order Date</th><th>Section</th><th>Days</th><th>Demand Status</th><th>Pending Arrear (₹)</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div class="day-legend"><span><span class="dot green"></span>&lt; 60 days</span><span><span class="dot orange"></span>60 – 89 days</span><span><span class="dot red"></span>&ge; 90 days</span></div>'
    + wizPaginationHTML(cases.length, startIdx, pageCases.length, totalPages);

  wizUpdateSelectionSummary();
}

/* Tax-head breakdown popup for a single demand's Pending Arrear amount —
   opened from the Issue Notice wizard's demand table. */
function showDemandBreakdown(demandId) {
  var c = AppState.cases.find(function (x) { return x.demandId === demandId; });
  if (!c) return;
  document.getElementById('dbk-sub').textContent = 'Demand ID: ' + c.demandId + (c.taxPeriod ? '  ·  Tax Period: ' + c.taxPeriod : '');
  var heads = [['IGST', c.pend_igst], ['CGST', c.pend_cgst], ['SGST', c.pend_sgst], ['CESS', c.pend_cess]];
  document.getElementById('dbk-body').innerHTML =
    '<table style="width:100%;border-collapse:collapse;">' + heads.map(function (h) {
      return '<tr><td style="padding:8px 0;color:var(--muted-text);">' + h[0] + '</td>'
        + '<td style="padding:8px 0;text-align:right;"><div class="amount-cell">' + fmt(h[1]) + '</div></td></tr>';
    }).join('')
    + '<tr><td style="padding:12px 0 0;font-weight:700;border-top:1px solid var(--border);color:var(--navy-text);">Total Pending</td>'
    + '<td style="padding:12px 0 0;text-align:right;border-top:1px solid var(--border);"><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td></tr>'
    + '</table>';
  document.getElementById('demand-breakdown-overlay').classList.add('show');
}

function closeDemandBreakdown() {
  document.getElementById('demand-breakdown-overlay').classList.remove('show');
}

function wizPaginationHTML(total, startIdx, pageCount, totalPages) {
  var pageBtns = wizPageNumberList(_wizCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _wizCurrentPage ? ' active' : '') + '" onclick="wizGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');

  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_wizPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_wizPageSize === 'all' ? ' selected' : '') + '>All</option>';

  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="wizGoToPage(-1)"' + (_wizCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="wizGoToPage(1)"' + (_wizCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="wizSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}

/* Classic "1 2 3 ... 8 9 10" windowed page list with ellipses for the gaps. */
function wizPageNumberList(current, total) {
  if (total <= 1) return [1];
  var delta = 1;
  var range = [];
  for (var i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) range.push(i);
  }
  var withDots = [];
  var last = null;
  range.forEach(function (i) {
    if (last !== null) {
      if (i - last === 2) withDots.push(last + 1);
      else if (i - last > 1) withDots.push('...');
    }
    withDots.push(i);
    last = i;
  });
  return withDots;
}

function wizSetPageSize(val) {
  _wizPageSize = val === 'all' ? 'all' : parseInt(val, 10);
  _wizCurrentPage = 1;
  renderWizardTablePage();
}
function wizGoToPage(delta) {
  _wizCurrentPage += delta;
  renderWizardTablePage();
}
function wizGoToPageNum(n) {
  _wizCurrentPage = n;
  renderWizardTablePage();
}

function wizToggleCaseCheck(el) {
  var id = el.getAttribute('data-demand');
  if (el.checked) _wizSelectedDemandIds.add(id); else _wizSelectedDemandIds.delete(id);
  wizUpdateSelectionSummary();
}

/* Selects/deselects every demand in the current filtered set — every page,
   not just the one currently visible. */
function wizToggleSelectAll(checked) {
  _wizFilteredCases.forEach(function (c) {
    if (checked) _wizSelectedDemandIds.add(c.demandId); else _wizSelectedDemandIds.delete(c.demandId);
  });
  renderWizardTablePage();
}

function wizUpdateSelectionSummary() {
  var totalAvailable = _wizFilteredCases.length;
  var selectedCases = wizSelectedCases();
  var total = selectedCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var barSummary = document.getElementById('wiz-bar-summary');
  var barTotal = document.getElementById('wiz-bar-total');
  var headTotal = document.getElementById('wiz-head-total');
  var headCount = document.getElementById('wiz-head-count');
  if (barSummary) barSummary.textContent = selectedCases.length + ' of ' + totalAvailable + ' selected';
  if (barTotal) barTotal.textContent = fmt(total);
  if (headTotal) headTotal.textContent = fmt(total);
  if (headCount) headCount.textContent = selectedCases.length + ' of ' + totalAvailable + ' selected';

  var selectAll = document.getElementById('wiz-select-all');
  if (selectAll) {
    var allChecked = totalAvailable > 0 && _wizFilteredCases.every(function (c) { return _wizSelectedDemandIds.has(c.demandId); });
    var someChecked = _wizFilteredCases.some(function (c) { return _wizSelectedDemandIds.has(c.demandId); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

/* ===== Selected cases + notice building (splits by age bucket when "Both" is selected) ===== */

/* "Selected" is scoped to what's actually in the current filtered view, so
   the on-screen count/total and the generated notice always agree with what
   the officer can see. A demand's checked state is still remembered in
   _wizSelectedDemandIds if a filter temporarily hides it, so it reappears
   checked once back in view — it just doesn't count while hidden. */
function wizSelectedCases() {
  var filteredIds = new Set(_wizFilteredCases.map(function (c) { return c.demandId; }));
  return AppState.cases.filter(function (c) { return c.gstin === _wizGSTIN && _wizSelectedDemandIds.has(c.demandId) && filteredIds.has(c.demandId); });
}

function wizBuildNotices() {
  var cases = wizSelectedCases();
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
      id: uid('notice'), gstin: _wizGSTIN, legalName: c0.legalName, cases: caseSnapshots(list), pendAmt: pendAmt,
      type: kind === 'urgent' ? 'demand' : 'reminder', noticeKind: kind,
      num: 'NOT/' + new Date().getFullYear() + '/' + String(seq).padStart(4, '0'),
      date: todayISO(), replyDate: kind === 'urgent' ? '' : addDaysISO(todayISO(), 30),
      address: (AppState.addressCache[_wizGSTIN] || {}).address || '', details: '',
      createdAt: new Date().toISOString()
    });
  });
  return out;
}

function wizGenerateNotice() {
  if (!AppState.cases.length || !hasRegisterData()) { showToast('⚠️ Upload DCR and Taxpayer Register before generating a notice'); return; }
  var noticesToSave = wizBuildNotices();
  if (!noticesToSave.length) return;
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

function previewWizardNotice() {
  var cases = wizSelectedCases();
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
    + '<p><strong>To:</strong> ' + xe(cases[0].legalName) + ' (GSTIN: ' + xe(_wizGSTIN) + ')</p>'
    + '<table><thead><tr><th>Tax Period</th><th>Demand ID</th><th>Section</th><th>Order Date</th><th>Pending (₹)</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p style="margin-top:16px;font-weight:bold;">Total Amount Payable: ₹' + fmt0(pendAmt) + '</p>'
    + '</body></html>'
  );
  win.document.close();
}

/* Entry point from other pages (Reports "Notice" action, Dashboard quick action) */
function openNoticeModal(gstin) {
  nav('bulknotice');
  var tabEl = document.querySelector('#page-bulknotice .tab[data-tab="notice"]');
  bulkTab('notice', tabEl);
  if (gstin) {
    document.getElementById('wiz-gstin-input').value = gstin;
    wizSearchGSTIN();
  }
}
