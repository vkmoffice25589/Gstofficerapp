/* ===== Third-Party Debtor Notice (Form GST DRC-13, Section 79(1)(c)) — same
   search/demand-table UX as Issue Notice and Bank Attachment (js/wizard-copy.js,
   js/bank-attachment.js): search-with-autocomplete, taxpayer details card,
   quick filters, and a flagged-but-visible checkbox demand table. Unlike Bank
   Attachment there is no hard ≥90-day age gate here — any demand with
   positive pending is shown, with status-excluded/Section 62 demands flagged
   and left unticked (same as Issue Notice), since there's no equivalent
   statutory age threshold for a Section 79(1)(c) third-party notice.
   Document generation (DRC-13 to the third party) is unchanged — only the
   selection UI matches Bank Attachment, including generating via a Debtor
   Details modal opened from Generate PDF/Word. ===== */

var _tpGSTIN = null;
var _tpSection62 = 'exclude'; // 'all' | 'exclude'
var _tpFilteredCases = [];
var _tpSelectedDemandIds = new Set();
var _tpPageSize = 10;          // number, or 'all'
var _tpCurrentPage = 1;

var TP_EMPTY_DETAILS = '<div class="isc-empty"><i class="fa-solid fa-user-group"></i> Defaulter taxpayer details will appear here after you search.</div>';

function tpIsFlagged(c) {
  if (isStatusExcluded(c)) return true;
  if (isSection62(c) && _tpSection62 !== 'all') return true;
  return false;
}

/* Demands eligible for a third-party notice: valid and with real pending
   tax — no age gate (unlike Bank Attachment's hard ≥90-day Section
   79(1)(a) requirement). Status-excluded and Section 62 demands are
   flagged, not removed — the officer can still tick one to override. */
function tpBaseCases() {
  if (!_tpGSTIN) return [];
  return AppState.cases.filter(function (c) { return c.gstin === _tpGSTIN; }).filter(isValidCase).filter(function (c) { return (Number(c.pend_total) || 0) > 0; });
}

/* Unique GSTINs whose GSTIN, DCR legal name or register trade name contains q. */
function tpFindTaxpayers(q) {
  var seen = {}, out = [];
  AppState.cases.forEach(function (c) {
    if (!c.gstin || seen[c.gstin]) return;
    var reg = AppState.addressCache[c.gstin] || {};
    var hay = (c.gstin + ' ' + (c.legalName || '') + ' ' + (reg.tradeName || '')).toUpperCase();
    if (hay.indexOf(q) !== -1) { seen[c.gstin] = true; out.push({ gstin: c.gstin, name: taxpayerDisplayName(c.gstin, c.legalName) }); }
  });
  return out;
}

function tpHideSuggest() { document.getElementById('tp-suggest').classList.remove('show'); }

function tpShowSuggest(matches, total) {
  var box = document.getElementById('tp-suggest');
  box.innerHTML = matches.map(function (m) {
    return '<div class="isc-sug-item" onmousedown="tpPickTaxpayer(\'' + m.gstin + '\')"><strong>' + xe(m.name) + '</strong><span>' + m.gstin + '</span></div>';
  }).join('') + (total > matches.length ? '<div class="isc-sug-more">' + (total - matches.length) + ' more — keep typing to narrow down</div>' : '');
  box.classList.add('show');
}

function tpSearchSuggest() {
  var q = (document.getElementById('tp-gstin-input').value || '').trim().toUpperCase();
  document.getElementById('tp-gstin-hint').textContent = '';
  if (q.length < 3 || q.length === 15) { tpHideSuggest(); return; }
  var m = tpFindTaxpayers(q);
  if (!m.length) { tpHideSuggest(); return; }
  tpShowSuggest(m.slice(0, 8), m.length);
}

function tpPickTaxpayer(gstin) {
  document.getElementById('tp-gstin-input').value = gstin;
  tpHideSuggest();
  tpLoadGSTIN(gstin);
}

function tpSearchGSTIN() {
  var input = document.getElementById('tp-gstin-input');
  var q = (input.value || '').trim().toUpperCase();
  var hint = document.getElementById('tp-gstin-hint');
  tpHideSuggest();

  if (!q) { hint.textContent = '⚠️ Enter a GSTIN or Trade Name'; return; }
  if (q.length === 15) { input.value = q; tpLoadGSTIN(q); return; }

  var m = tpFindTaxpayers(q);
  if (!m.length) {
    hint.textContent = '⚠️ No taxpayer matching "' + q + '" in imported DCR data';
    return;
  }
  if (m.length === 1) { tpPickTaxpayer(m[0].gstin); return; }
  hint.textContent = m.length + ' taxpayers match — pick one below';
  tpShowSuggest(m.slice(0, 8), m.length);
}

function tpLoadGSTIN(gstin) {
  var hint = document.getElementById('tp-gstin-hint');
  var detailsBar = document.getElementById('tp-taxpayer-details');

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  if (!cases.length) {
    hint.textContent = '⚠️ ' + gstin + ' not found in imported DCR data';
    detailsBar.innerHTML = TP_EMPTY_DETAILS;
    document.getElementById('tp-demand-section').style.display = 'none';
    return;
  }

  hint.textContent = '';
  _tpGSTIN = gstin;
  var reg = AppState.addressCache[gstin] || {};
  var legalName = cases[0].legalName || '—';
  var displayName = taxpayerDisplayName(gstin, legalName);
  var statusPill = reg.regStatus ? (isCollectible(gstin) ? '<span class="pill pill-green">' + xe(reg.regStatus) + '</span>' : '<span class="pill pill-red">' + xe(reg.regStatus) + '</span>') : '<span class="pill pill-gray">Status unknown</span>';
  var eligibleCases = tpBaseCases();
  var pendTotal = eligibleCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  detailsBar.innerHTML =
    '<div class="isc-icon"><i class="fa-solid fa-user-group"></i></div>'
    + '<div class="isc-info">'
    +   '<div class="isc-info-title">Defaulter Taxpayer</div>'
    +   '<div class="isc-gstin">' + xe(gstin) + ' ' + statusPill + '</div>'
    +   '<div class="isc-name">' + xe(displayName) + '</div>'
    +   '<div class="isc-addr">' + (reg.address ? xe(reg.address) : 'Address not available — upload the Taxpayer Register') + '</div>'
    +   '<div class="isc-meta"><span>Pending <strong>' + fmt(pendTotal) + '</strong></span><span>Demands <strong>' + eligibleCases.length + '</strong></span></div>'
    + '</div>'
    + '<div class="isc-actions">'
    +   '<button type="button" class="isc-view-btn" onclick="goToRecoveryProfile(\'' + gstin + '\')">View Full Details <i class="fa-solid fa-arrow-right"></i></button>'
    +   '<button type="button" class="isc-link-btn" onclick="goToNoticeHistory(\'' + gstin + '\')"><i class="fa-solid fa-clock-rotate-left"></i> Notice History</button>'
    + '</div>';

  if (!eligibleCases.length) {
    document.getElementById('tp-demand-section').style.display = 'none';
    showToast('⚠️ No demands with pending arrear found for this taxpayer.');
    return;
  }

  document.getElementById('tp-demand-section').style.display = 'block';
  var tpSticky = document.getElementById('tp-sticky-taxpayer');
  tpSticky.textContent = displayName;
  tpSticky.style.display = 'block';
  _tpSection62 = 'exclude';
  _tpSelectedDemandIds = new Set(eligibleCases.filter(function (c) { return !tpIsFlagged(c); }).map(function (c) { return c.demandId; }));
  tpUpdateQuickFilterCounts();
  tpApplyFiltersAndRender();
  document.getElementById('tp-demand-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function tpClearGSTIN() {
  _tpGSTIN = null;
  document.getElementById('tp-gstin-input').value = '';
  document.getElementById('tp-gstin-hint').textContent = '';
  tpHideSuggest();
  document.getElementById('tp-taxpayer-details').innerHTML = TP_EMPTY_DETAILS;
  document.getElementById('tp-demand-section').style.display = 'none';
  document.getElementById('tp-gstin-input').focus();
}

function tpUpdateQuickFilterCounts() {
  var base = tpBaseCases();
  var sec62 = base.filter(function (c) { return isSection62(c); }).length;
  var setText = function (id, n) { var el = document.getElementById(id); if (el) el.textContent = n; };
  setText('tp-qf-count-all', base.length);
  setText('tp-qf-count-section62', sec62);
}

function tpUpdateQuickFilterActiveState() {
  var sec62Chip = document.querySelector('#bulk-tab-thirdparty .qf-chip[data-qf="section62"]');
  if (sec62Chip) sec62Chip.classList.toggle('active', _tpSection62 === 'all');
}

function tpQuickFilterAll() {
  _tpSection62 = 'exclude';
  tpSyncSection62Selection();
  tpApplyFiltersAndRender();
}

function tpToggleSection62() {
  _tpSection62 = _tpSection62 === 'all' ? 'exclude' : 'all';
  tpSyncSection62Selection();
  tpApplyFiltersAndRender();
}

function tpSyncSection62Selection() {
  _tpFilteredCases.filter(function (c) { return isSection62(c); }).forEach(function (c) {
    if (_tpSection62 === 'all') _tpSelectedDemandIds.add(c.demandId);
    else _tpSelectedDemandIds.delete(c.demandId);
  });
}

function tpApplyFiltersAndRender() {
  if (!_tpGSTIN) return;
  _tpFilteredCases = tpBaseCases();
  _tpCurrentPage = 1;
  tpRenderDemandTable();
  tpUpdateQuickFilterActiveState();
  tpUpdateQuickFilterCounts();
}

function tpRenderDemandTable() {
  var wrap = document.getElementById('tp-demand-table-wrap');
  var cases = _tpFilteredCases;
  if (!cases.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No demands match the current filters for this taxpayer.</div></div>';
    tpUpdateSelectionSummary();
    return;
  }

  var pageSize = _tpPageSize === 'all' ? cases.length : _tpPageSize;
  var totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  if (_tpCurrentPage > totalPages) _tpCurrentPage = totalPages;
  if (_tpCurrentPage < 1) _tpCurrentPage = 1;
  var startIdx = (_tpCurrentPage - 1) * pageSize;
  var pageCases = cases.slice(startIdx, startIdx + pageSize);

  var rows = pageCases.map(function (c, i) {
    var age = getDemandAgeDays(c);
    var checked = _tpSelectedDemandIds.has(c.demandId) ? ' checked' : '';
    var flagged = tpIsFlagged(c);
    var badge = !flagged ? '' : (isStatusExcluded(c)
      ? ' <span class="pill pill-orange wiz-excluded-badge" title="Not notice-eligible by default (higher forum / closed / refund status) — tick the box to include it anyway">Excluded</span>'
      : ' <span class="pill pill-gold wiz-excluded-badge" title="Section 62 best-judgment assessment — not treated as a confirmed arrear by default, tick the box (or the Include Section 62 chip) to include it anyway">Section 62</span>');
    var statusCell = xe(c.demandStatus) + badge;
    return '<tr' + (flagged ? ' class="wiz-row-excluded"' : '') + '>'
      + '<td><input type="checkbox" class="wiz-case-chk" data-demand="' + xe(c.demandId) + '" data-amt="' + (Number(c.pend_total) || 0) + '"' + checked + ' onchange="tpToggleCaseCheck(this)"></td>'
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
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="tp-select-all" onchange="tpToggleSelectAll(this.checked)"></th><th>Sl.No.</th><th>Tax Period</th><th>Demand ID</th><th>Order Date</th><th>Section</th><th>Days</th><th>Demand Status</th><th>Pending Arrear (₹)</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + tpPaginationHTML(cases.length, totalPages);
  tpUpdateSelectionSummary();
}

function tpPaginationHTML(total, totalPages) {
  var pageBtns = wizPageNumberList(_tpCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _tpCurrentPage ? ' active' : '') + '" onclick="tpGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');

  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_tpPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_tpPageSize === 'all' ? ' selected' : '') + '>All</option>';

  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="tpGoToPage(-1)"' + (_tpCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="tpGoToPage(1)"' + (_tpCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="tpSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}

function tpSetPageSize(val) {
  _tpPageSize = val === 'all' ? 'all' : parseInt(val, 10);
  _tpCurrentPage = 1;
  tpRenderDemandTable();
}
function tpGoToPage(delta) {
  _tpCurrentPage += delta;
  tpRenderDemandTable();
}
function tpGoToPageNum(n) {
  _tpCurrentPage = n;
  tpRenderDemandTable();
}

function tpToggleCaseCheck(el) {
  var id = el.getAttribute('data-demand');
  if (el.checked) _tpSelectedDemandIds.add(id); else _tpSelectedDemandIds.delete(id);
  tpUpdateSelectionSummary();
}

function tpToggleSelectAll(checked) {
  _tpFilteredCases.forEach(function (c) {
    if (checked) { if (!tpIsFlagged(c)) _tpSelectedDemandIds.add(c.demandId); }
    else _tpSelectedDemandIds.delete(c.demandId);
  });
  tpRenderDemandTable();
}

function tpSelectedCases() {
  var filteredIds = new Set(_tpFilteredCases.map(function (c) { return c.demandId; }));
  return AppState.cases.filter(function (c) { return c.gstin === _tpGSTIN && _tpSelectedDemandIds.has(c.demandId) && filteredIds.has(c.demandId); });
}

function tpUpdateSelectionSummary() {
  var totalAvailable = _tpFilteredCases.length;
  var selected = tpSelectedCases();
  var total = selected.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var barSummary = document.getElementById('tp-bar-summary');
  var barTotal = document.getElementById('tp-bar-total');
  var headTotal = document.getElementById('tp-head-total');
  var headCount = document.getElementById('tp-head-count');
  if (barSummary) barSummary.textContent = selected.length + ' of ' + totalAvailable + ' selected';
  if (barTotal) barTotal.textContent = fmt(total);
  if (headTotal) headTotal.textContent = fmt(total);
  if (headCount) headCount.textContent = selected.length + ' of ' + totalAvailable + ' selected';

  var selectAll = document.getElementById('tp-select-all');
  if (selectAll) {
    var eligibleFiltered = _tpFilteredCases.filter(function (c) { return !tpIsFlagged(c); });
    var allChecked = eligibleFiltered.length > 0 && eligibleFiltered.every(function (c) { return _tpSelectedDemandIds.has(c.demandId); });
    var someChecked = _tpFilteredCases.some(function (c) { return _tpSelectedDemandIds.has(c.demandId); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

/* ===== Multiple Third Parties modal — a defaulter's arrear can legally be
   pursued from several third parties at once (each independently liable
   for the full amount until whoever pays first), so instead of one
   debtor's details per Generate click, this opens an editable table where
   the officer adds as many third parties as needed (default a few blank
   rows, "+ Add Row" for more). Every row gets the SAME ticked demands and
   the SAME full amount — only the recipient differs — and Generate saves
   one thirdPartyNotices record per row, builds every document, and bundles
   them into a single ZIP (same JSZip pattern as the existing Bulk Notice
   zip in notices.js). ===== */
var _tpPendingFormat = null;
var _tpDebtorRows = [];

function tpBlankDebtorRow() { return { legal: '', trade: '', gstin: '', mobile: '', email: '', addr: '' }; }

function tpGenerate(format) {
  if (!_tpGSTIN) { showToast('⚠️ Search and select a defaulter taxpayer first'); return; }
  if (!tpSelectedCases().length) { showToast('⚠️ Select at least one demand'); return; }
  _tpPendingFormat = format;
  _tpDebtorRows = [tpBlankDebtorRow(), tpBlankDebtorRow(), tpBlankDebtorRow()];

  var total = tpSelectedCases().reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  document.getElementById('tp-bulk-modal-sub').textContent = tpSelectedCases().length + ' demand(s) ticked — each third party below will be issued notice for the full ' + fmt(total);
  document.getElementById('tp-bulk-date').value = todayISO();
  var btn = document.getElementById('tp-bulk-generate-btn');
  btn.innerHTML = '<i class="fa-solid fa-file-' + (format === 'pdf' ? 'pdf' : 'word') + '"></i> Generate ' + (format === 'pdf' ? 'PDF' : 'Word') + ' (ZIP)';

  tpRenderDebtorRows();
  document.getElementById('tp-debtor-modal-overlay').classList.add('show');
}

function tpCloseDebtorModal() {
  document.getElementById('tp-debtor-modal-overlay').classList.remove('show');
}

function tpRenderDebtorRows() {
  var wrap = document.getElementById('tp-debtor-rows-wrap');
  wrap.innerHTML = '<div class="table-scroll"><table class="tp-debtor-table"><thead><tr>'
    + '<th style="width:30px;">#</th><th>Name *</th><th>Trade Name</th><th>GSTIN</th><th>Address *</th><th>Mobile</th><th>Email</th><th></th>'
    + '</tr></thead><tbody>'
    + _tpDebtorRows.map(function (r, i) {
      return '<tr>'
        + '<td>' + (i + 1) + '</td>'
        + '<td><input type="text" value="' + xe(r.legal) + '" oninput="tpUpdateDebtorRow(' + i + ',\'legal\',this.value)"/></td>'
        + '<td><input type="text" value="' + xe(r.trade) + '" oninput="tpUpdateDebtorRow(' + i + ',\'trade\',this.value)"/></td>'
        + '<td><input type="text" value="' + xe(r.gstin) + '" oninput="tpUpdateDebtorRow(' + i + ',\'gstin\',this.value)"/></td>'
        + '<td><input type="text" value="' + xe(r.addr) + '" oninput="tpUpdateDebtorRow(' + i + ',\'addr\',this.value)"/></td>'
        + '<td><input type="text" value="' + xe(r.mobile) + '" oninput="tpUpdateDebtorRow(' + i + ',\'mobile\',this.value)"/></td>'
        + '<td><input type="text" value="' + xe(r.email) + '" oninput="tpUpdateDebtorRow(' + i + ',\'email\',this.value)"/></td>'
        + '<td><button type="button" class="btn btn-outline btn-xs" onclick="tpRemoveDebtorRow(' + i + ')" title="Remove row"><i class="fa-solid fa-trash"></i></button></td>'
        + '</tr>';
    }).join('') + '</tbody></table></div>';
}

/* Mutates row state only — no re-render — so typing in one cell doesn't
   rebuild the table and steal focus from the input. */
function tpUpdateDebtorRow(i, field, value) {
  if (_tpDebtorRows[i]) _tpDebtorRows[i][field] = value;
}

function tpAddDebtorRow() {
  _tpDebtorRows.push(tpBlankDebtorRow());
  tpRenderDebtorRows();
}

function tpRemoveDebtorRow(i) {
  _tpDebtorRows.splice(i, 1);
  tpRenderDebtorRows();
}

async function tpConfirmGenerate() {
  var format = _tpPendingFormat;
  var cases = tpSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand'); return; }

  var rows = _tpDebtorRows.filter(function (r) {
    return r.legal.trim() || r.trade.trim() || r.gstin.trim() || r.addr.trim() || r.mobile.trim() || r.email.trim();
  });
  if (!rows.length) { showToast('⚠️ Add at least one third party'); return; }
  if (rows.some(function (r) { return !r.legal.trim(); })) { showToast('⚠️ Every row needs a Name'); return; }
  var missingAddr = rows.filter(function (r) { return !r.addr.trim(); }).length;
  if (missingAddr && !confirm('⚠️ ' + missingAddr + ' row(s) are missing an Address — it will print blank on those notices. Generate anyway?')) return;

  var c0 = cases[0];
  var totalAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var date = document.getElementById('tp-bulk-date').value || todayISO();
  var caseSnap = caseSnapshots(cases);

  var saved = rows.map(function (r) {
    var tp = {
      id: uid('tp'), defaulterGstin: _tpGSTIN, legalName: c0.legalName,
      debtorGstin: r.gstin.trim(), debtorLegal: r.legal.trim(), debtorTrade: r.trade.trim(),
      debtorMobile: r.mobile.trim(), debtorEmail: r.email.trim(), debtorAddr: r.addr.trim(),
      cases: caseSnap, totalAmt: totalAmt, date: date,
      released: false, releasedDate: '', releasedReason: '', releasedPetitionDate: '', releasedAddr: '', releasedNarrative: '',
      createdAt: new Date().toISOString()
    };
    AppState.thirdPartyNotices.push(tp);
    return tp;
  });
  persist();
  renderThirdPartyList();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();

  tpCloseDebtorModal();
  tpClearAll();
  showToast('⏳ Generating ' + saved.length + ' notice(s)...');

  var cfg = getSettings();
  await window.LibsReady;
  var zip = new JSZip();
  var ext = format === 'pdf' ? 'pdf' : 'docx';
  var builds = saved.map(function (tp) {
    var p = format === 'pdf' ? buildThirdPartyPdfBlob(tp, cfg) : buildThirdPartyDocx(tp, cfg);
    return p.then(function (blob) {
      var safeName = (tp.debtorLegal || 'ThirdParty').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'ThirdParty';
      zip.file('DRC13_' + safeName + '_' + tp.defaulterGstin + '.' + ext, blob);
    });
  });
  Promise.all(builds).then(function () {
    return zip.generateAsync({ type: 'blob' });
  }).then(function (zipBlob) {
    downloadBlob(zipBlob, 'ThirdParty_Notices_' + todayISO() + '.zip');
    showToast('✅ Downloaded ' + saved.length + ' notice(s) as ZIP');
  });
}

/* Lightweight read-only preview of the selected demands + total, mirroring
   baPreview() in bank-attachment.js — opened in a new tab rather than
   generating/saving anything. */
function tpPreview() {
  var cases = tpSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand to preview'); return; }
  var total = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var rows = cases.map(function (c) {
    return '<tr><td>' + xe(c.taxPeriod) + '</td><td>' + xe(c.demandId) + '</td><td>' + xe(c.section) + '</td><td>' + fmtDate(c.dcr_date || c.demandDate) + '</td><td style="text-align:right;">' + fmt0(c.pend_total) + '</td></tr>';
  }).join('');
  var win = window.open('', '_blank');
  if (!win) { showToast('⚠️ Enable pop-ups to preview'); return; }
  win.document.write(
    '<html><head><title>Third-Party Notice Preview</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2b42;} h2{text-align:center;margin:4px 0;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #c8d3e0;padding:8px;font-size:12px;} th{background:#f7f9fc;}</style></head><body>'
    + '<h2>THIRD-PARTY NOTICE (DRC-13) — PREVIEW</h2>'
    + '<p><strong>Defaulter GSTIN:</strong> ' + xe(_tpGSTIN) + ' — each third party notified will be issued this same amount.</p>'
    + '<table><thead><tr><th>Tax Period</th><th>Demand ID</th><th>Section</th><th>Order Date</th><th>Pending (₹)</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p style="margin-top:16px;font-weight:bold;">Total Amount: ₹' + fmt0(total) + '</p>'
    + '</body></html>'
  );
  win.document.close();
}

/* Redownloads an already-saved third-party notice's DRC-13 — used by
   Notice History's unified ledger to re-fetch a document without
   re-running the whole search/select/modal flow. */
function tpDownloadSaved(id, fmt) {
  var tp = AppState.thirdPartyNotices.find(function (x) { return x.id === id; });
  if (!tp) return;
  var cfg = getSettings();
  if (fmt === 'pdf') generateThirdPartyPDF(tp, cfg);
  else buildThirdPartyDocx(tp, cfg).then(function (blob) { downloadBlob(blob, 'DRC13_' + tp.defaulterGstin + '_' + todayISO() + '.docx'); });
}

function tpClearAll() {
  _tpGSTIN = null; _tpSection62 = 'exclude'; _tpFilteredCases = []; _tpSelectedDemandIds = new Set(); _tpDebtorRows = [];
  var g = document.getElementById('tp-gstin-input'); if (g) g.value = '';
  document.getElementById('tp-gstin-hint').textContent = '';
  tpHideSuggest();
  document.getElementById('tp-taxpayer-details').innerHTML = TP_EMPTY_DETAILS;
  document.getElementById('tp-demand-section').style.display = 'none';
  document.getElementById('tp-sticky-taxpayer').style.display = 'none';
  tpUpdateSelectionSummary();
}

function renderThirdPartyList() {
  var wrap = document.getElementById('third-party-list');
  if (!wrap) return;
  var list = AppState.thirdPartyNotices.filter(function (t) { return !t.released; }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  if (!list.length) { wrap.innerHTML = '<div class="empty-sub">No active third-party notices — see the Release Attachment tab for released ones.</div>'; return; }
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Defaulter</th><th>Third Party</th><th>Amount</th><th></th></tr></thead><tbody>'
    + list.map(function (t) {
      return '<tr><td>' + fmtDate(t.date) + '</td><td>' + xe(taxpayerDisplayName(t.defaulterGstin, t.legalName)) + '<br><span class="gstin-cell">' + xe(t.defaulterGstin) + '</span></td>'
        + '<td>' + xe(t.debtorLegal) + '</td><td><div class="amount-cell pending">' + fmt(t.totalAmt) + '</div></td>'
        + '<td><button class="btn btn-orange btn-xs" onclick="relGoToRelease(\'thirdparty\',\'' + t.id + '\')"><i class="fa-solid fa-unlock"></i> Release</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}
