/* ===== Property Attachment — Section 79(1)(d). Same search/demand-table UX as
   Issue Notice, Bank Attachment and Third-Party Notice (js/wizard-copy.js,
   js/bank-attachment.js, js/third-party-notice.js): search-with-autocomplete,
   taxpayer details card, quick filters and a flagged-but-visible checkbox
   demand table. Like the third-party notice there is no age gate — any
   demand with positive pending is shown, status-excluded / Section 62
   demands are flagged and left unticked. Generate opens a Properties
   modal: a defaulter can have several properties attached at once, each
   row gets the SAME ticked demands and amount, one attachment record and
   one order per property, bundled into a ZIP. ===== */

var _paGSTIN = null;
var _paSection62 = 'exclude'; // 'all' | 'exclude'
var _paFilteredCases = [];
var _paSelectedDemandIds = new Set();
var _paPageSize = 10;          // number, or 'all'
var _paCurrentPage = 1;

var PA_EMPTY_DETAILS = '<div class="isc-empty"><i class="fa-solid fa-house-lock"></i> Defaulter taxpayer details will appear here after you search.</div>';

function paIsFlagged(c) {
  if (isStatusExcluded(c)) return true;
  if (isSection62(c) && _paSection62 !== 'all') return true;
  return false;
}

/* Demands eligible for a third-party notice: valid and with real pending
   tax — no age gate (unlike Bank Attachment's hard ≥90-day Section
   79(1)(a) requirement). Status-excluded and Section 62 demands are
   flagged, not removed — the officer can still tick one to override. */
function paBaseCases() {
  if (!_paGSTIN) return [];
  return AppState.cases.filter(function (c) { return c.gstin === _paGSTIN; }).filter(isValidCase).filter(function (c) { return (Number(c.pend_total) || 0) > 0; });
}

/* Unique GSTINs whose GSTIN, DCR legal name or register trade name contains q. */
function paFindTaxpayers(q) {
  var seen = {}, out = [];
  AppState.cases.forEach(function (c) {
    if (!c.gstin || seen[c.gstin]) return;
    var reg = AppState.addressCache[c.gstin] || {};
    var hay = (c.gstin + ' ' + (c.legalName || '') + ' ' + (reg.tradeName || '')).toUpperCase();
    if (hay.indexOf(q) !== -1) { seen[c.gstin] = true; out.push({ gstin: c.gstin, name: taxpayerDisplayName(c.gstin, c.legalName) }); }
  });
  return out;
}

function paHideSuggest() { document.getElementById('pa-suggest').classList.remove('show'); }

function paShowSuggest(matches, total) {
  var box = document.getElementById('pa-suggest');
  box.innerHTML = matches.map(function (m) {
    return '<div class="isc-sug-item" onmousedown="paPickTaxpayer(\'' + m.gstin + '\')"><strong>' + xe(m.name) + '</strong><span>' + m.gstin + '</span></div>';
  }).join('') + (total > matches.length ? '<div class="isc-sug-more">' + (total - matches.length) + ' more — keep typing to narrow down</div>' : '');
  box.classList.add('show');
}

function paSearchSuggest() {
  var q = (document.getElementById('pa-gstin-input').value || '').trim().toUpperCase();
  document.getElementById('pa-gstin-hint').textContent = '';
  if (q.length < 3 || q.length === 15) { paHideSuggest(); return; }
  var m = paFindTaxpayers(q);
  if (!m.length) { paHideSuggest(); return; }
  paShowSuggest(m.slice(0, 8), m.length);
}

function paPickTaxpayer(gstin) {
  document.getElementById('pa-gstin-input').value = gstin;
  paHideSuggest();
  paLoadGSTIN(gstin);
}

function paSearchGSTIN() {
  var input = document.getElementById('pa-gstin-input');
  var q = (input.value || '').trim().toUpperCase();
  var hint = document.getElementById('pa-gstin-hint');
  paHideSuggest();

  if (!q) { hint.textContent = '⚠️ Enter a GSTIN or Trade Name'; return; }
  if (q.length === 15) { input.value = q; paLoadGSTIN(q); return; }

  var m = paFindTaxpayers(q);
  if (!m.length) {
    hint.textContent = '⚠️ No taxpayer matching "' + q + '" in imported DCR data';
    return;
  }
  if (m.length === 1) { paPickTaxpayer(m[0].gstin); return; }
  hint.textContent = m.length + ' taxpayers match — pick one below';
  paShowSuggest(m.slice(0, 8), m.length);
}

function paLoadGSTIN(gstin) {
  var hint = document.getElementById('pa-gstin-hint');
  var detailsBar = document.getElementById('pa-taxpayer-details');

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  if (!cases.length) {
    hint.textContent = '⚠️ ' + gstin + ' not found in imported DCR data';
    detailsBar.innerHTML = PA_EMPTY_DETAILS;
    document.getElementById('pa-demand-section').style.display = 'none';
    return;
  }

  hint.textContent = '';
  _paGSTIN = gstin;
  var reg = AppState.addressCache[gstin] || {};
  var legalName = cases[0].legalName || '—';
  var displayName = taxpayerDisplayName(gstin, legalName);
  var statusPill = reg.regStatus ? (isCollectible(gstin) ? '<span class="pill pill-green">' + xe(reg.regStatus) + '</span>' : '<span class="pill pill-red">' + xe(reg.regStatus) + '</span>') : '<span class="pill pill-gray">Status unknown</span>';
  var eligibleCases = paBaseCases();
  var pendTotal = eligibleCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  detailsBar.innerHTML =
    '<div class="isc-icon"><i class="fa-solid fa-house-lock"></i></div>'
    + '<div class="isc-info">'
    +   '<div class="isc-info-title">Defaulter Taxpayer</div>'
    +   '<div class="isc-gstin">' + xe(gstin) + ' ' + statusPill + '</div>'
    +   '<div class="isc-name">' + xe(displayName) + '</div>'
    +   '<div class="isc-addr">' + (reg.address ? xe(reg.address) : 'Address not available — upload the Taxpayer Register') + '</div>'
    +   '<div class="isc-meta"><span>Pending <strong>' + fmt(pendTotal) + '</strong></span><span>Demands <strong>' + eligibleCases.length + '</strong></span></div>'
    + '</div>'
    + '<div class="isc-actions">'
    +   '<button type="button" class="isc-view-btn" onclick="goToTaxpayerCase(\'' + gstin + '\')">View Full Details <i class="fa-solid fa-arrow-right"></i></button>'
    +   '<button type="button" class="isc-link-btn" onclick="goToNoticeHistory(\'' + gstin + '\')"><i class="fa-solid fa-clock-rotate-left"></i> Notice History</button>'
    + '</div>';

  if (!eligibleCases.length) {
    document.getElementById('pa-demand-section').style.display = 'none';
    showToast('⚠️ No demands with pending arrear found for this taxpayer.');
    return;
  }

  document.getElementById('pa-demand-section').style.display = 'block';
  var paSticky = document.getElementById('pa-sticky-taxpayer');
  paSticky.textContent = displayName;
  paSticky.style.display = 'block';
  _paSection62 = 'exclude';
  _paSelectedDemandIds = new Set(eligibleCases.filter(function (c) { return !paIsFlagged(c); }).map(function (c) { return c.demandId; }));
  paUpdateQuickFilterCounts();
  paApplyFiltersAndRender();
  document.getElementById('pa-demand-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function paClearGSTIN() {
  _paGSTIN = null;
  document.getElementById('pa-gstin-input').value = '';
  document.getElementById('pa-gstin-hint').textContent = '';
  paHideSuggest();
  document.getElementById('pa-taxpayer-details').innerHTML = PA_EMPTY_DETAILS;
  document.getElementById('pa-demand-section').style.display = 'none';
  document.getElementById('pa-gstin-input').focus();
}

function paUpdateQuickFilterCounts() {
  var base = paBaseCases();
  var sec62 = base.filter(function (c) { return isSection62(c); }).length;
  var setText = function (id, n) { var el = document.getElementById(id); if (el) el.textContent = n; };
  setText('tp-qf-count-all', base.length);
  setText('tp-qf-count-section62', sec62);
}

function paUpdateQuickFilterActiveState() {
  var sec62Chip = document.querySelector('#bulk-tab-property .qf-chip[data-qf="section62"]');
  if (sec62Chip) sec62Chip.classList.toggle('active', _paSection62 === 'all');
}

function paQuickFilterAll() {
  _paSection62 = 'exclude';
  paSyncSection62Selection();
  paApplyFiltersAndRender();
}

function paToggleSection62() {
  _paSection62 = _paSection62 === 'all' ? 'exclude' : 'all';
  paSyncSection62Selection();
  paApplyFiltersAndRender();
}

function paSyncSection62Selection() {
  _paFilteredCases.filter(function (c) { return isSection62(c); }).forEach(function (c) {
    if (_paSection62 === 'all') _paSelectedDemandIds.add(c.demandId);
    else _paSelectedDemandIds.delete(c.demandId);
  });
}

function paApplyFiltersAndRender() {
  if (!_paGSTIN) return;
  _paFilteredCases = paBaseCases();
  _paCurrentPage = 1;
  paRenderDemandTable();
  paUpdateQuickFilterActiveState();
  paUpdateQuickFilterCounts();
}

function paRenderDemandTable() {
  var wrap = document.getElementById('pa-demand-table-wrap');
  var cases = _paFilteredCases;
  if (!cases.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No demands match the current filters for this taxpayer.</div></div>';
    paUpdateSelectionSummary();
    return;
  }

  var pageSize = _paPageSize === 'all' ? cases.length : _paPageSize;
  var totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  if (_paCurrentPage > totalPages) _paCurrentPage = totalPages;
  if (_paCurrentPage < 1) _paCurrentPage = 1;
  var startIdx = (_paCurrentPage - 1) * pageSize;
  var pageCases = cases.slice(startIdx, startIdx + pageSize);

  var rows = pageCases.map(function (c, i) {
    var age = getDemandAgeDays(c);
    var checked = _paSelectedDemandIds.has(c.demandId) ? ' checked' : '';
    var flagged = paIsFlagged(c);
    var badge = !flagged ? '' : (isStatusExcluded(c)
      ? ' <span class="pill pill-orange wiz-excluded-badge" title="Not notice-eligible by default (higher forum / closed / refund status) — tick the box to include it anyway">Excluded</span>'
      : ' <span class="pill pill-gold wiz-excluded-badge" title="Section 62 best-judgment assessment — not treated as a confirmed arrear by default, tick the box (or the Include Section 62 chip) to include it anyway">Section 62</span>');
    var statusCell = xe(c.demandStatus) + badge;
    return '<tr' + (flagged ? ' class="wiz-row-excluded"' : '') + '>'
      + '<td><input type="checkbox" class="wiz-case-chk" data-demand="' + xe(c.demandId) + '" data-amt="' + (Number(c.pend_total) || 0) + '"' + checked + ' onchange="paToggleCaseCheck(this)"></td>'
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
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="pa-select-all" onchange="paToggleSelectAll(this.checked)"></th><th>Sl.No.</th><th>Tax Period</th><th>Demand ID</th><th>Order Date</th><th>Section</th><th>Days</th><th>Demand Status</th><th>Pending Arrear (₹)</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + paPaginationHTML(cases.length, totalPages);
  paUpdateSelectionSummary();
}

function paPaginationHTML(total, totalPages) {
  var pageBtns = wizPageNumberList(_paCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _paCurrentPage ? ' active' : '') + '" onclick="paGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');

  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_paPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_paPageSize === 'all' ? ' selected' : '') + '>All</option>';

  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="paGoToPage(-1)"' + (_paCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="paGoToPage(1)"' + (_paCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="paSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}

function paSetPageSize(val) {
  _paPageSize = val === 'all' ? 'all' : parseInt(val, 10);
  _paCurrentPage = 1;
  paRenderDemandTable();
}
function paGoToPage(delta) {
  _paCurrentPage += delta;
  paRenderDemandTable();
}
function paGoToPageNum(n) {
  _paCurrentPage = n;
  paRenderDemandTable();
}

function paToggleCaseCheck(el) {
  var id = el.getAttribute('data-demand');
  if (el.checked) _paSelectedDemandIds.add(id); else _paSelectedDemandIds.delete(id);
  paUpdateSelectionSummary();
}

function paToggleSelectAll(checked) {
  _paFilteredCases.forEach(function (c) {
    if (checked) { if (!paIsFlagged(c)) _paSelectedDemandIds.add(c.demandId); }
    else _paSelectedDemandIds.delete(c.demandId);
  });
  paRenderDemandTable();
}

function paSelectedCases() {
  var filteredIds = new Set(_paFilteredCases.map(function (c) { return c.demandId; }));
  return AppState.cases.filter(function (c) { return c.gstin === _paGSTIN && _paSelectedDemandIds.has(c.demandId) && filteredIds.has(c.demandId); });
}

function paUpdateSelectionSummary() {
  var totalAvailable = _paFilteredCases.length;
  var selected = paSelectedCases();
  var total = selected.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var barSummary = document.getElementById('pa-bar-summary');
  var barTotal = document.getElementById('pa-bar-total');
  var headTotal = document.getElementById('pa-head-total');
  var headCount = document.getElementById('pa-head-count');
  if (barSummary) barSummary.textContent = selected.length + ' of ' + totalAvailable + ' selected';
  if (barTotal) barTotal.textContent = fmt(total);
  if (headTotal) headTotal.textContent = fmt(total);
  if (headCount) headCount.textContent = selected.length + ' of ' + totalAvailable + ' selected';

  var selectAll = document.getElementById('pa-select-all');
  if (selectAll) {
    var eligibleFiltered = _paFilteredCases.filter(function (c) { return !paIsFlagged(c); });
    var allChecked = eligibleFiltered.length > 0 && eligibleFiltered.every(function (c) { return _paSelectedDemandIds.has(c.demandId); });
    var someChecked = _paFilteredCases.some(function (c) { return _paSelectedDemandIds.has(c.demandId); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

/* ===== Properties to Attach modal — editable rows (description, location /
   survey no., estimated value), one saved attachment + one order each. ===== */
var _paPendingFormat = null;
var _paPropertyRows = [];

function paBlankPropertyRow() { return { desc: '', loc: '', value: '' }; }

function paGenerate(format) {
  if (!_paGSTIN) { showToast('⚠️ Search and select a defaulter taxpayer first'); return; }
  if (!paSelectedCases().length) { showToast('⚠️ Select at least one demand'); return; }
  _paPendingFormat = format;
  _paPropertyRows = [paBlankPropertyRow(), paBlankPropertyRow()];

  var sel = paSelectedCases();
  var total = sel.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  document.getElementById('pa-bulk-modal-sub').textContent = sel.length + ' demand(s) ticked — each property below will be attached for the full ' + fmt(total);
  document.getElementById('pa-bulk-date').value = todayISO();
  var btn = document.getElementById('pa-bulk-generate-btn');
  btn.innerHTML = '<i class="fa-solid fa-file-' + (format === 'pdf' ? 'pdf' : 'word') + '"></i> Generate ' + (format === 'pdf' ? 'PDF' : 'Word') + ' (ZIP)';

  paRenderPropertyRows();
  document.getElementById('pa-property-modal-overlay').classList.add('show');
}

function paClosePropertyModal() {
  document.getElementById('pa-property-modal-overlay').classList.remove('show');
}

function paRenderPropertyRows() {
  var wrap = document.getElementById('pa-property-rows-wrap');
  wrap.innerHTML = '<div class="table-scroll"><table class="tp-debtor-table"><thead><tr>'
    + '<th style="width:30px;">#</th><th>Property Description *</th><th>Location / Survey No.</th><th style="width:150px;">Estimated Value (₹)</th><th></th>'
    + '</tr></thead><tbody>'
    + _paPropertyRows.map(function (r, i) {
      return '<tr>'
        + '<td>' + (i + 1) + '</td>'
        + '<td><input type="text" value="' + xe(r.desc) + '" placeholder="e.g. Commercial building" oninput="paUpdatePropertyRow(' + i + ',\'desc\',this.value)"/></td>'
        + '<td><input type="text" value="' + xe(r.loc) + '" placeholder="e.g. S.No. 145/2, Ambattur" oninput="paUpdatePropertyRow(' + i + ',\'loc\',this.value)"/></td>'
        + '<td><input type="text" inputmode="decimal" value="' + xe(r.value) + '" oninput="paUpdatePropertyRow(' + i + ',\'value\',this.value)"/></td>'
        + '<td><button type="button" class="btn btn-outline btn-xs" onclick="paRemovePropertyRow(' + i + ')" title="Remove row"><i class="fa-solid fa-trash"></i></button></td>'
        + '</tr>';
    }).join('') + '</tbody></table></div>';
}

/* Mutates row state only — no re-render — so typing doesn't steal focus. */
function paUpdatePropertyRow(i, field, value) {
  if (_paPropertyRows[i]) _paPropertyRows[i][field] = value;
}

function paAddPropertyRow() {
  _paPropertyRows.push(paBlankPropertyRow());
  paRenderPropertyRows();
}

function paRemovePropertyRow(i) {
  _paPropertyRows.splice(i, 1);
  paRenderPropertyRows();
}

async function paConfirmGenerate() {
  var format = _paPendingFormat;
  var cases = paSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand'); return; }

  var rows = _paPropertyRows.filter(function (r) { return r.desc.trim() || r.loc.trim() || String(r.value).trim(); });
  if (!rows.length) { showToast('⚠️ Add at least one property'); return; }
  if (rows.some(function (r) { return !r.desc.trim(); })) { showToast('⚠️ Every row needs a Property Description'); return; }
  var parsed = rows.map(function (r) { return parseFloat(String(r.value).replace(/[, ]/g, '')) || 0; });
  var missingLoc = rows.filter(function (r) { return !r.loc.trim(); }).length;
  var missingVal = parsed.filter(function (v) { return !v; }).length;
  var warn = [];
  if (missingLoc) warn.push(missingLoc + ' row(s) have no Location / Survey No.');
  if (missingVal) warn.push(missingVal + ' row(s) have no Estimated Value (prints "₹0")');
  if (warn.length && !confirm('⚠️ ' + warn.join('\n⚠️ ') + '\n\nGenerate anyway?')) return;

  var c0 = cases[0];
  var totalAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var date = document.getElementById('pa-bulk-date').value || todayISO();
  var caseSnap = caseSnapshots(cases);

  var saved = rows.map(function (r, i) {
    var pa = {
      id: uid('prop'), gstin: _paGSTIN, legalName: c0.legalName, cases: caseSnap, totalAmt: totalAmt,
      propertyDescription: r.desc.trim(), propertyLocation: r.loc.trim(), propertyValue: parsed[i],
      officer: '', date: date,
      released: false, releasedDate: '', releasedReason: '', releasedPetitionDate: '', releasedAddr: '', releasedNarrative: '',
      createdAt: new Date().toISOString()
    };
    AppState.propertyAttachments.push(pa);
    return pa;
  });
  persist();
  renderPropertyList();
  updateSidebar();

  paClosePropertyModal();
  paClearAll();
  showToast('⏳ Generating ' + saved.length + ' order(s)...');

  var cfg = getSettings();
  await window.LibsReady;
  var zip = new JSZip();
  var ext = format === 'pdf' ? 'pdf' : 'docx';
  var builds = saved.map(function (pa, i) {
    var p = format === 'pdf' ? buildPropertyAttachmentPdfBlob(pa, cfg) : buildPropertyAttachmentDocx(pa, cfg);
    return p.then(function (blob) {
      zip.file('PropertyAttachment_' + (i + 1) + '_' + pa.gstin + '.' + ext, blob);
    });
  });
  Promise.all(builds).then(function () {
    return zip.generateAsync({ type: 'blob' });
  }).then(function (zipBlob) {
    downloadBlob(zipBlob, 'Property_Attachments_' + todayISO() + '.zip');
    showToast('✅ Downloaded ' + saved.length + ' order(s) as ZIP');
  });
}

/* Lightweight read-only preview of the selected demands + total, mirroring
   tpPreview() — opened in a new tab, generates/saves nothing. */
function paPreview() {
  var cases = paSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand to preview'); return; }
  var total = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var rows = cases.map(function (c) {
    return '<tr><td>' + xe(c.taxPeriod) + '</td><td>' + xe(c.demandId) + '</td><td>' + xe(c.section) + '</td><td>' + fmtDate(c.dcr_date || c.demandDate) + '</td><td style="text-align:right;">' + fmt0(c.pend_total) + '</td></tr>';
  }).join('');
  var win = window.open('', '_blank');
  if (!win) { showToast('⚠️ Enable pop-ups to preview'); return; }
  win.document.write(
    '<html><head><title>Property Attachment Preview</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2b42;} h2{text-align:center;margin:4px 0;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #c8d3e0;padding:8px;font-size:12px;} th{background:#f7f9fc;}</style></head><body>'
    + '<h2>PROPERTY ATTACHMENT (SECTION 79(1)(d)) — PREVIEW</h2>'
    + '<p><strong>Defaulter GSTIN:</strong> ' + xe(_paGSTIN) + ' — each property attached will carry this same amount.</p>'
    + '<table><thead><tr><th>Tax Period</th><th>Demand ID</th><th>Section</th><th>Order Date</th><th>Pending (₹)</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p style="margin-top:16px;font-weight:bold;">Total Amount: ₹' + fmt0(total) + '</p>'
    + '</body></html>'
  );
  win.document.close();
}

/* Redownloads an already-saved property attachment order — used by
   Notice History's unified ledger to re-fetch a document without
   re-running the whole search/select/save flow. */
function paDownloadSaved(id, fmt) {
  var pa = AppState.propertyAttachments.find(function (x) { return x.id === id; });
  if (!pa) return;
  var cfg = getSettings();
  if (fmt === 'pdf') generatePropertyAttachmentPDF(pa, cfg);
  else buildPropertyAttachmentDocx(pa, cfg).then(function (blob) { downloadBlob(blob, 'PropertyAttachment_' + pa.gstin + '_' + todayISO() + '.docx'); });
}

function paClearAll() {
  _paGSTIN = null; _paSection62 = 'exclude'; _paFilteredCases = []; _paSelectedDemandIds = new Set(); _paPropertyRows = [];
  var g = document.getElementById('pa-gstin-input'); if (g) g.value = '';
  document.getElementById('pa-gstin-hint').textContent = '';
  paHideSuggest();
  document.getElementById('pa-taxpayer-details').innerHTML = PA_EMPTY_DETAILS;
  document.getElementById('pa-demand-section').style.display = 'none';
  document.getElementById('pa-sticky-taxpayer').style.display = 'none';
  paUpdateSelectionSummary();
}

function renderPropertyList() {
  var wrap = document.getElementById('property-list');
  if (!wrap) return;
  var list = AppState.propertyAttachments.filter(function (p) { return !p.released; }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  if (!list.length) { wrap.innerHTML = '<div class="empty-sub">No active property attachments — see the Release Attachment tab for released ones.</div>'; return; }
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Taxpayer</th><th>Property</th><th>Value</th><th>Demand Amount</th><th></th></tr></thead><tbody>'
    + list.map(function (p) {
      return '<tr><td>' + fmtDate(p.date) + '</td><td>' + xe(taxpayerDisplayName(p.gstin, p.legalName)) + '<br><span class="gstin-cell">' + xe(p.gstin) + '</span></td>'
        + '<td>' + xe(p.propertyDescription) + '</td><td>' + fmt(p.propertyValue) + '</td><td><div class="amount-cell pending">' + fmt(p.totalAmt) + '</div></td>'
        + '<td><button class="btn btn-orange btn-xs" onclick="relGoToRelease(\'property\',\'' + p.id + '\')"><i class="fa-solid fa-unlock"></i> Release</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}
