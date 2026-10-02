/* ===== Bank Attachments — same search/demand-table UX as Issue Notice
   (js/wizard-copy.js), but with a hard ≥90-day age filter (Section 79(1)(a)
   — a demand younger than 90 days is never eligible for bank attachment,
   so unlike Issue Notice's flagged-but-visible categories, it's excluded
   from the table outright, not just unticked). Status-excluded and
   Section 62 demands among the ≥90-day set ARE shown, flagged, and
   unticked by default, exactly like Issue Notice — the officer can still
   tick one to override. Document generation (Letter to Bank + Form
   DRC-13) is unchanged — only the selection UI matches Issue Notice. ===== */

var _baGSTIN = null;
var _baSection62 = 'exclude'; // 'all' | 'exclude'
var _baFilteredCases = [];
var _baSelectedDemandIds = new Set();
var _baPageSize = 10;          // number, or 'all'
var _baCurrentPage = 1;
var _ifscCache = {};

var BA_EMPTY_DETAILS = '<div class="isc-empty"><i class="fa-solid fa-building-columns"></i> Taxpayer details will appear here after you search. Only demands &ge; 90 days old (Section 79(1)(a)) are shown.</div>';

function baIsFlagged(c) {
  if (isStatusExcluded(c)) return true;
  if (isSection62(c) && _baSection62 !== 'all') return true;
  return false;
}

/* Demands eligible for bank attachment at all: valid, positive pending,
   and ≥90 days old (a null/unparseable date is treated as eligible rather
   than silently dropped). This is the hard legal gate — status-excluded
   and Section 62 demands within this set are flagged, not removed. */
function baBaseCases() {
  if (!_baGSTIN) return [];
  return AppState.cases.filter(function (c) { return c.gstin === _baGSTIN; }).filter(isValidCase).filter(function (c) {
    if ((Number(c.pend_total) || 0) <= 0) return false;
    var age = getDemandAgeDays(c);
    return age === null || age >= 90;
  });
}

/* Unique GSTINs whose GSTIN, DCR legal name or register trade name contains q. */
function baFindTaxpayers(q) {
  var seen = {}, out = [];
  AppState.cases.forEach(function (c) {
    if (!c.gstin || seen[c.gstin]) return;
    var reg = AppState.addressCache[c.gstin] || {};
    var hay = (c.gstin + ' ' + (c.legalName || '') + ' ' + (reg.tradeName || '')).toUpperCase();
    if (hay.indexOf(q) !== -1) { seen[c.gstin] = true; out.push({ gstin: c.gstin, name: taxpayerDisplayName(c.gstin, c.legalName) }); }
  });
  return out;
}

function baHideSuggest() { document.getElementById('ba-suggest').classList.remove('show'); }

function baShowSuggest(matches, total) {
  var box = document.getElementById('ba-suggest');
  box.innerHTML = matches.map(function (m) {
    return '<div class="isc-sug-item" onmousedown="baPickTaxpayer(\'' + m.gstin + '\')"><strong>' + xe(m.name) + '</strong><span>' + m.gstin + '</span></div>';
  }).join('') + (total > matches.length ? '<div class="isc-sug-more">' + (total - matches.length) + ' more — keep typing to narrow down</div>' : '');
  box.classList.add('show');
}

function baSearchSuggest() {
  var q = (document.getElementById('ba-gstin-input').value || '').trim().toUpperCase();
  document.getElementById('ba-gstin-hint').textContent = '';
  if (q.length < 3 || q.length === 15) { baHideSuggest(); return; }
  var m = baFindTaxpayers(q);
  if (!m.length) { baHideSuggest(); return; }
  baShowSuggest(m.slice(0, 8), m.length);
}

function baPickTaxpayer(gstin) {
  document.getElementById('ba-gstin-input').value = gstin;
  baHideSuggest();
  baLoadGSTIN(gstin);
}

function baSearchGSTIN() {
  var input = document.getElementById('ba-gstin-input');
  var q = (input.value || '').trim().toUpperCase();
  var hint = document.getElementById('ba-gstin-hint');
  baHideSuggest();

  if (!q) { hint.textContent = '⚠️ Enter a GSTIN or Trade Name'; return; }
  if (q.length === 15) { input.value = q; baLoadGSTIN(q); return; }

  var m = baFindTaxpayers(q);
  if (!m.length) {
    hint.textContent = '⚠️ No taxpayer matching "' + q + '" in imported DCR data';
    return;
  }
  if (m.length === 1) { baPickTaxpayer(m[0].gstin); return; }
  hint.textContent = m.length + ' taxpayers match — pick one below';
  baShowSuggest(m.slice(0, 8), m.length);
}

function baLoadGSTIN(gstin) {
  var hint = document.getElementById('ba-gstin-hint');
  var detailsBar = document.getElementById('ba-taxpayer-details');

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  if (!cases.length) {
    hint.textContent = '⚠️ ' + gstin + ' not found in imported DCR data';
    detailsBar.innerHTML = BA_EMPTY_DETAILS;
    document.getElementById('ba-demand-section').style.display = 'none';
    return;
  }

  hint.textContent = '';
  _baGSTIN = gstin;
  var reg = AppState.addressCache[gstin] || {};
  var legalName = cases[0].legalName || '—';
  var displayName = taxpayerDisplayName(gstin, legalName);
  var statusPill = reg.regStatus ? (isCollectible(gstin) ? '<span class="pill pill-green">' + xe(reg.regStatus) + '</span>' : '<span class="pill pill-red">' + xe(reg.regStatus) + '</span>') : '<span class="pill pill-gray">Status unknown</span>';
  var eligibleCases = baBaseCases();
  var pendTotal = eligibleCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  detailsBar.innerHTML =
    '<div class="isc-icon"><i class="fa-solid fa-building-columns"></i></div>'
    + '<div class="isc-info">'
    +   '<div class="isc-info-title">Taxpayer Details</div>'
    +   '<div class="isc-gstin">' + xe(gstin) + ' ' + statusPill + '</div>'
    +   '<div class="isc-name">' + xe(displayName) + '</div>'
    +   '<div class="isc-addr">' + (reg.address ? xe(reg.address) : 'Address not available — upload the Taxpayer Register') + '</div>'
    +   '<div class="isc-meta"><span>Pending (&ge;90d) <strong>' + fmt(pendTotal) + '</strong></span><span>Demands <strong>' + eligibleCases.length + '</strong></span></div>'
    + '</div>'
    + '<div class="isc-actions">'
    +   '<button type="button" class="isc-view-btn" onclick="goToRecoveryProfile(\'' + gstin + '\')">View Full Details <i class="fa-solid fa-arrow-right"></i></button>'
    +   '<button type="button" class="isc-link-btn" onclick="goToNoticeHistory(\'' + gstin + '\')"><i class="fa-solid fa-clock-rotate-left"></i> Notice History</button>'
    + '</div>';

  if (!eligibleCases.length) {
    document.getElementById('ba-demand-section').style.display = 'none';
    showToast('⚠️ No demands ≥ 90 days found for this taxpayer. Bank attachment requires demands older than 90 days.');
    return;
  }

  document.getElementById('ba-demand-section').style.display = 'block';
  _baSection62 = 'exclude';
  _baSelectedDemandIds = new Set(eligibleCases.filter(function (c) { return !baIsFlagged(c); }).map(function (c) { return c.demandId; }));
  baUpdateQuickFilterCounts();
  baApplyFiltersAndRender();
}

function baClearGSTIN() {
  _baGSTIN = null;
  document.getElementById('ba-gstin-input').value = '';
  document.getElementById('ba-gstin-hint').textContent = '';
  baHideSuggest();
  document.getElementById('ba-taxpayer-details').innerHTML = BA_EMPTY_DETAILS;
  document.getElementById('ba-demand-section').style.display = 'none';
  document.getElementById('ba-gstin-input').focus();
}

function baUpdateQuickFilterCounts() {
  var base = baBaseCases();
  var sec62 = base.filter(function (c) { return isSection62(c); }).length;
  var setText = function (id, n) { var el = document.getElementById(id); if (el) el.textContent = n; };
  setText('ba-qf-count-all', base.length);
  setText('ba-qf-count-section62', sec62);
}

function baUpdateQuickFilterActiveState() {
  var sec62Chip = document.querySelector('#bulk-tab-bankatt .qf-chip[data-qf="section62"]');
  if (sec62Chip) sec62Chip.classList.toggle('active', _baSection62 === 'all');
}

function baQuickFilterAll() {
  _baSection62 = 'exclude';
  baSyncSection62Selection();
  baApplyFiltersAndRender();
}

function baToggleSection62() {
  _baSection62 = _baSection62 === 'all' ? 'exclude' : 'all';
  baSyncSection62Selection();
  baApplyFiltersAndRender();
}

function baSyncSection62Selection() {
  _baFilteredCases.filter(function (c) { return isSection62(c); }).forEach(function (c) {
    if (_baSection62 === 'all') _baSelectedDemandIds.add(c.demandId);
    else _baSelectedDemandIds.delete(c.demandId);
  });
}

function baApplyFiltersAndRender() {
  if (!_baGSTIN) return;
  _baFilteredCases = baBaseCases();
  _baCurrentPage = 1;
  baRenderDemandTable();
  baUpdateQuickFilterActiveState();
  baUpdateQuickFilterCounts();
}

function baRenderDemandTable() {
  var wrap = document.getElementById('ba-demand-table-wrap');
  var cases = _baFilteredCases;
  if (!cases.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No demands ≥ 90 days match the current filters for this taxpayer.</div></div>';
    baUpdateSelectionSummary();
    return;
  }

  var pageSize = _baPageSize === 'all' ? cases.length : _baPageSize;
  var totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  if (_baCurrentPage > totalPages) _baCurrentPage = totalPages;
  if (_baCurrentPage < 1) _baCurrentPage = 1;
  var startIdx = (_baCurrentPage - 1) * pageSize;
  var pageCases = cases.slice(startIdx, startIdx + pageSize);

  var rows = pageCases.map(function (c, i) {
    var age = getDemandAgeDays(c);
    var checked = _baSelectedDemandIds.has(c.demandId) ? ' checked' : '';
    var flagged = baIsFlagged(c);
    var badge = !flagged ? '' : (isStatusExcluded(c)
      ? ' <span class="pill pill-orange wiz-excluded-badge" title="Not notice-eligible by default (higher forum / closed / refund status) — tick the box to include it anyway">Excluded</span>'
      : ' <span class="pill pill-gold wiz-excluded-badge" title="Section 62 best-judgment assessment — not treated as a confirmed arrear by default, tick the box (or the Include Section 62 chip) to include it anyway">Section 62</span>');
    var statusCell = xe(c.demandStatus) + badge;
    return '<tr' + (flagged ? ' class="wiz-row-excluded"' : '') + '>'
      + '<td><input type="checkbox" class="wiz-case-chk" data-demand="' + xe(c.demandId) + '" data-amt="' + (Number(c.pend_total) || 0) + '"' + checked + ' onchange="baToggleCaseCheck(this)"></td>'
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
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="ba-select-all" onchange="baToggleSelectAll(this.checked)"></th><th>Sl.No.</th><th>Tax Period</th><th>Demand ID</th><th>Order Date</th><th>Section</th><th>Days</th><th>Demand Status</th><th>Pending Arrear (₹)</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + baPaginationHTML(cases.length, totalPages);
  baUpdateSelectionSummary();
}

function baPaginationHTML(total, totalPages) {
  var pageBtns = wizPageNumberList(_baCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _baCurrentPage ? ' active' : '') + '" onclick="baGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');

  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_baPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_baPageSize === 'all' ? ' selected' : '') + '>All</option>';

  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="baGoToPage(-1)"' + (_baCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="baGoToPage(1)"' + (_baCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="baSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}

function baSetPageSize(val) {
  _baPageSize = val === 'all' ? 'all' : parseInt(val, 10);
  _baCurrentPage = 1;
  baRenderDemandTable();
}
function baGoToPage(delta) {
  _baCurrentPage += delta;
  baRenderDemandTable();
}
function baGoToPageNum(n) {
  _baCurrentPage = n;
  baRenderDemandTable();
}

function baToggleCaseCheck(el) {
  var id = el.getAttribute('data-demand');
  if (el.checked) _baSelectedDemandIds.add(id); else _baSelectedDemandIds.delete(id);
  baUpdateSelectionSummary();
}

function baToggleSelectAll(checked) {
  _baFilteredCases.forEach(function (c) {
    if (checked) { if (!baIsFlagged(c)) _baSelectedDemandIds.add(c.demandId); }
    else _baSelectedDemandIds.delete(c.demandId);
  });
  baRenderDemandTable();
}

function baSelectedCases() {
  var filteredIds = new Set(_baFilteredCases.map(function (c) { return c.demandId; }));
  return AppState.cases.filter(function (c) { return c.gstin === _baGSTIN && _baSelectedDemandIds.has(c.demandId) && filteredIds.has(c.demandId); });
}

function baUpdateSelectionSummary() {
  var totalAvailable = _baFilteredCases.length;
  var selected = baSelectedCases();
  var total = selected.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var barSummary = document.getElementById('ba-bar-summary');
  var barTotal = document.getElementById('ba-bar-total');
  var headTotal = document.getElementById('ba-head-total');
  var headCount = document.getElementById('ba-head-count');
  if (barSummary) barSummary.textContent = selected.length + ' of ' + totalAvailable + ' selected';
  if (barTotal) barTotal.textContent = fmt(total);
  if (headTotal) headTotal.textContent = fmt(total);
  if (headCount) headCount.textContent = selected.length + ' of ' + totalAvailable + ' selected';

  var selectAll = document.getElementById('ba-select-all');
  if (selectAll) {
    var eligibleFiltered = _baFilteredCases.filter(function (c) { return !baIsFlagged(c); });
    var allChecked = eligibleFiltered.length > 0 && eligibleFiltered.every(function (c) { return _baSelectedDemandIds.has(c.demandId); });
    var someChecked = _baFilteredCases.some(function (c) { return _baSelectedDemandIds.has(c.demandId); });
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

function validateIFSCFormat(ifsc) { return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc); }

async function _ifscFetch(url, timeoutMs) {
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    var res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function _ifscNormalise(raw) {
  var d = raw && raw.contents ? (function () { try { return JSON.parse(raw.contents); } catch (e) { return null; } })() : raw;
  if (!d) return null;
  var bank = d.BANK || d.bank || d.Bank;
  var branch = d.BRANCH || d.branch || d.Branch;
  if (!bank) return null;
  return { bank: bank, branch: branch || '', address: d.ADDRESS || d.address || '', city: d.CITY || d.city || '' };
}

async function lookupIFSC(ifsc) {
  ifsc = (ifsc || '').trim().toUpperCase().replace(/\s+/g, '');
  if (_ifscCache[ifsc]) return _ifscCache[ifsc];
  var sources = [
    'https://ifsc.razorpay.com/' + ifsc,
    'https://api.allorigins.win/get?url=' + encodeURIComponent('https://ifsc.razorpay.com/' + ifsc)
  ];
  for (var i = 0; i < sources.length; i++) {
    var raw = await _ifscFetch(sources[i], 6000);
    if (!raw) continue;
    var data = _ifscNormalise(raw);
    if (data) { _ifscCache[ifsc] = data; return data; }
  }
  return null;
}

async function autoFillFromIFSC() {
  var ifsc = (document.getElementById('ba-ifsc').value || '').trim().toUpperCase().replace(/\s+/g, '');
  var statusEl = document.getElementById('ba-bank-status');

  if (!ifsc) { statusEl.textContent = '⚠️ Please enter an IFSC code'; statusEl.style.color = 'var(--orange)'; return; }
  if (ifsc.length !== 11 || !validateIFSCFormat(ifsc)) { statusEl.textContent = '⚠️ Invalid IFSC format — should be like SBIN0015984'; statusEl.style.color = 'var(--orange)'; return; }
  document.getElementById('ba-ifsc').value = ifsc;

  statusEl.textContent = '⏳ Fetching bank details for ' + ifsc + '...';
  statusEl.style.color = 'var(--blue)';

  var data = await lookupIFSC(ifsc);
  if (data) {
    document.getElementById('ba-bank-name').value = data.bank;
    document.getElementById('ba-branch').value = data.branch;
    document.getElementById('ba-branch-addr').value = data.address;
    statusEl.textContent = '✅ ' + data.bank + (data.branch ? ' — ' + data.branch : '') + (data.city ? ', ' + data.city : '');
    statusEl.style.color = 'var(--green)';
  } else {
    statusEl.innerHTML = '❌ Could not fetch details — please fill Bank Name and Branch manually';
    statusEl.style.color = 'var(--red)';
    document.getElementById('ba-bank-name').focus();
  }
}

var BANK_ATT_REQUIRED_FIELDS = [['accno', 'Bank Account No.'], ['pan', 'PAN No.']];

/* Builds, validates and saves the selected demands as a bank attachment
   record in AppState.bankAtts — shared by both the PDF and Word generate
   buttons, which only differ in which document format they export
   afterward. Returns the saved record, or null if nothing was generated
   (validation failed, nothing selected, required fields missing). */
function baFinalizeAttachment() {
  if (!_baGSTIN) { showToast('⚠️ Search and select a taxpayer first'); return null; }
  var cases = baSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand to attach'); return null; }
  var bankName = document.getElementById('ba-bank-name').value.trim();
  var ifsc = document.getElementById('ba-ifsc').value.trim();
  if (!bankName || !ifsc) { showToast('⚠️ Bank name and IFSC are required'); return null; }
  var draftFields = { accno: document.getElementById('ba-accno').value.trim(), pan: document.getElementById('ba-pan').value.trim() };
  if (!confirmMissingFields(draftFields, BANK_ATT_REQUIRED_FIELDS, 'This bank attachment (Form DRC-13)')) return null;

  var c0 = cases[0];
  var totalAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  var b = {
    id: uid('bank'), gstin: _baGSTIN, legalName: c0.legalName, cases: caseSnapshots(cases), totalAmt: totalAmt,
    bankName: bankName, branch: document.getElementById('ba-branch').value.trim(),
    branchAddr: document.getElementById('ba-branch-addr').value.trim(), ifsc: ifsc,
    accno: document.getElementById('ba-accno').value.trim(), accType: document.getElementById('ba-acctype').value,
    pan: document.getElementById('ba-pan').value.trim(),
    ref: 'BA/' + new Date().getFullYear() + '/' + String(AppState.bankAtts.length + 1).padStart(4, '0'),
    date: document.getElementById('ba-date').value || todayISO(),
    officer: document.getElementById('ba-officer').value.trim(),
    released: false, releasedDate: '', releasedReason: '',
    createdAt: new Date().toISOString()
  };

  AppState.bankAtts.push(b);
  persist();
  renderBankAtts();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  return b;
}

/* format: 'pdf' | 'word'. Rather than pinning the Bank Details form on
   screen, it opens in a modal once demands are actually selected — the
   demand table gets the full screen while picking, and the (fairly long)
   bank form gets a focused dialog instead of being squeezed into a
   permanently-visible sticky strip. baConfirmGenerate() (the modal's own
   button) does the actual save-and-export, regenerating fresh from saved
   fields rather than persisting the file itself, same as every other
   document type in this app. */
var _baPendingFormat = null;

function baGenerate(format) {
  if (!_baGSTIN) { showToast('⚠️ Search and select a taxpayer first'); return; }
  if (!baSelectedCases().length) { showToast('⚠️ Select at least one demand to attach'); return; }
  _baPendingFormat = format;
  var btn = document.getElementById('ba-modal-generate-btn');
  btn.innerHTML = '<i class="fa-solid fa-file-' + (format === 'pdf' ? 'pdf' : 'word') + '"></i> Generate ' + (format === 'pdf' ? 'PDF' : 'Word');
  document.getElementById('ba-bank-modal-overlay').classList.add('show');
}

function baCloseBankModal() {
  document.getElementById('ba-bank-modal-overlay').classList.remove('show');
}

function baConfirmGenerate() {
  var format = _baPendingFormat;
  var b = baFinalizeAttachment();
  if (!b) return; // validation failed — stays open on the modal with its own toast
  baCloseBankModal();
  showToast('✅ Bank attachment ' + b.ref + ' saved — generating documents...');
  baClearAll();
  var cfg = getSettings();
  if (format === 'pdf') {
    generateBankLetterPDF(b, cfg);
    generateBankDrc13PDF(b, cfg);
  } else {
    buildBankLetterDocx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Letter.docx'); });
    buildBankDrc13Docx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_DRC13.docx'); });
  }
}

/* Lightweight read-only preview of the selected demands + total, mirroring
   previewWizardNotice2() in wizard-copy.js — opened in a new tab rather
   than generating/saving anything. */
function baPreview() {
  var cases = baSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand to preview'); return; }
  var total = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var rows = cases.map(function (c) {
    return '<tr><td>' + xe(c.taxPeriod) + '</td><td>' + xe(c.demandId) + '</td><td>' + xe(c.section) + '</td><td>' + fmtDate(c.dcr_date || c.demandDate) + '</td><td style="text-align:right;">' + fmt0(c.pend_total) + '</td></tr>';
  }).join('');
  var win = window.open('', '_blank');
  if (!win) { showToast('⚠️ Enable pop-ups to preview'); return; }
  win.document.write(
    '<html><head><title>Bank Attachment Preview</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2b42;} h2{text-align:center;margin:4px 0;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #c8d3e0;padding:8px;font-size:12px;} th{background:#f7f9fc;}</style></head><body>'
    + '<h2>BANK ATTACHMENT — PREVIEW</h2>'
    + '<p><strong>GSTIN:</strong> ' + xe(_baGSTIN) + ' &nbsp; <strong>Bank:</strong> ' + xe(document.getElementById('ba-bank-name').value || '—') + '</p>'
    + '<table><thead><tr><th>Tax Period</th><th>Demand ID</th><th>Section</th><th>Order Date</th><th>Pending (₹)</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p style="margin-top:16px;font-weight:bold;">Total Amount Attached: ₹' + fmt0(total) + '</p>'
    + '</body></html>'
  );
  win.document.close();
}

function baClearAll() {
  _baGSTIN = null; _baSection62 = 'exclude'; _baFilteredCases = []; _baSelectedDemandIds = new Set();
  ['ba-gstin-input', 'ba-ifsc', 'ba-bank-name', 'ba-branch', 'ba-branch-addr', 'ba-accno', 'ba-pan', 'ba-officer'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('ba-gstin-hint').textContent = '';
  baHideSuggest();
  document.getElementById('ba-taxpayer-details').innerHTML = BA_EMPTY_DETAILS;
  document.getElementById('ba-demand-section').style.display = 'none';
  document.getElementById('ba-bank-status').textContent = '';
  document.getElementById('ba-date').value = todayISO();
}

function renderBankAtts() {
  var wrap = document.getElementById('bank-atts-list');
  if (!wrap) return;
  var active = AppState.bankAtts.filter(function (b) { return !b.released; });
  if (!active.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-building-columns" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Active Bank Attachments</div><div class="empty-sub">Attachments you create will appear here until released — see the Release Attachment tab for released ones</div></div>';
    return;
  }
  var list = active.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  wrap.innerHTML = list.map(function (b) {
    return '<div class="ba-card">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">'
      + '<div><div style="font-weight:700;font-size:13px;">' + xe(taxpayerDisplayName(b.gstin, b.legalName)) + '</div><div class="gstin-cell">' + xe(b.gstin) + '</div></div>'
      + '<span class="pill pill-red">Active</span>'
      + '</div>'
      + '<div class="info-grid" style="margin-top:10px;">'
      + '<div class="info-item"><div class="info-label">Bank</div><div class="info-val" style="font-size:12px;">' + xe(b.bankName) + '</div></div>'
      + '<div class="info-item"><div class="info-label">IFSC</div><div class="info-val" style="font-size:12px;">' + xe(b.ifsc) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Account No.</div><div class="info-val" style="font-size:12px;">' + xe(b.accno || '—') + '</div></div>'
      + '<div class="info-item"><div class="info-label">Attached Amount</div><div class="info-val" style="color:var(--red);">' + fmt(b.totalAmt) + '</div></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center;">'
      + '<span style="font-size:11px;color:var(--ink3);">Letter to Bank:</span>'
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadLetter(\'' + b.id + '\',\'docx\')"><i class="fa-solid fa-file-word"></i> Word</button>'
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadLetter(\'' + b.id + '\',\'pdf\')"><i class="fa-solid fa-file-pdf"></i> PDF</button>'
      + '<span style="font-size:11px;color:var(--ink3);margin-left:6px;">DRC-13:</span>'
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadDrc13(\'' + b.id + '\',\'docx\')"><i class="fa-solid fa-file-word"></i> Word</button>'
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadDrc13(\'' + b.id + '\',\'pdf\')"><i class="fa-solid fa-file-pdf"></i> PDF</button>'
      + '<button class="btn btn-orange btn-xs" onclick="baGoToRelease(\'' + b.id + '\')"><i class="fa-solid fa-unlock"></i> Release</button>'
      + '</div></div>';
  }).join('');
}

function baDownloadLetter(id, fmt) {
  var b = AppState.bankAtts.find(function (x) { return x.id === id; });
  if (!b) return;
  var cfg = getSettings();
  if (fmt === 'pdf') generateBankLetterPDF(b, cfg);
  else buildBankLetterDocx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Letter.docx'); });
}
function baDownloadDrc13(id, fmt) {
  var b = AppState.bankAtts.find(function (x) { return x.id === id; });
  if (!b) return;
  var cfg = getSettings();
  if (fmt === 'pdf') generateBankDrc13PDF(b, cfg);
  else buildBankDrc13Docx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_DRC13.docx'); });
}

/* ===== Release Attachment tab — search across every active bank
   attachment, then release the selected one with the full Release Order
   (matching the office's "Bank release Reference" format) generated as
   Word + PDF. Replaces the old bare reason-only modal, which couldn't
   capture the case-specific facts (petition date, taxpayer address,
   narrative) the real release order needs. ===== */
var RELEASE_REASONS = ['Demand Paid', 'First Appeal Filed', 'WP Filed & Stay Obtained', 'Revision - Demand Nullified'];
var RELEASE_NARRATIVE_TEMPLATES = {
  'Demand Paid': 'The taxpayer has since remitted the outstanding demand in full and has furnished proof of payment to this office.',
  'First Appeal Filed': 'The taxpayer has filed a reply to this office stating that they have filed a First Appeal against the demand along with the requisite pre-deposit, and has furnished proof of the same.',
  'WP Filed & Stay Obtained': 'The taxpayer has filed a reply to this office stating that they have filed a writ petition before the Honourable High Court and have complied with the conditions ordered therein.',
  'Revision - Demand Nullified': 'The demand against the taxpayer has been nullified pursuant to a revision order passed by the competent authority, a copy of which has been furnished to this office.'
};
var _brSelectedId = null;

function renderBankReleaseTab() {
  var s = document.getElementById('br-search'); if (s) s.value = '';
  var r = document.getElementById('br-search-results'); if (r) r.style.display = 'none';
  var f = document.getElementById('br-form-card'); if (f) f.style.display = 'none';
  _brSelectedId = null;
  renderReleasedList();
}

function brSearchAttachment(query) {
  var resultsEl = document.getElementById('br-search-results');
  query = (query || '').trim().toUpperCase();
  if (query.length < 2) { resultsEl.style.display = 'none'; return; }
  var matches = AppState.bankAtts.filter(function (b) { return !b.released; }).filter(function (b) {
    return (b.gstin || '').toUpperCase().indexOf(query) !== -1 || (b.legalName || '').toUpperCase().indexOf(query) !== -1 || (b.bankName || '').toUpperCase().indexOf(query) !== -1;
  }).slice(0, 12);
  resultsEl.innerHTML = matches.length
    ? matches.map(function (b) { return '<div class="gs-item" onclick="brSelectAttachment(\'' + b.id + '\')"><strong>' + xe(taxpayerDisplayName(b.gstin, b.legalName)) + '</strong><br><span style="color:var(--ink3);font-family:var(--mono);font-size:10px;">' + xe(b.gstin) + ' • ' + xe(b.bankName) + '</span></div>'; }).join('')
    : '<div class="gs-item">No active attachments found</div>';
  resultsEl.style.display = 'block';
}

function brSelectAttachment(id) {
  var b = AppState.bankAtts.find(function (x) { return x.id === id; });
  if (!b) return;
  _brSelectedId = id;
  document.getElementById('br-search').value = b.legalName;
  document.getElementById('br-search-results').style.display = 'none';

  document.getElementById('br-selected-name').textContent = b.legalName;
  document.getElementById('br-selected-sub').textContent = b.gstin;
  document.getElementById('br-selected-info').innerHTML =
    '<div class="info-item"><div class="info-label">Bank</div><div class="info-val" style="font-size:12px;">' + xe(b.bankName) + '</div></div>'
    + '<div class="info-item"><div class="info-label">IFSC</div><div class="info-val" style="font-size:12px;">' + xe(b.ifsc) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Account No.</div><div class="info-val" style="font-size:12px;">' + xe(b.accno || '—') + '</div></div>'
    + '<div class="info-item"><div class="info-label">Attached Amount</div><div class="info-val" style="color:var(--red);">' + fmt(b.totalAmt) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Attachment Ref.</div><div class="info-val" style="font-size:12px;">' + xe(b.ref) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Attached On</div><div class="info-val" style="font-size:12px;">' + fmtDate(b.date) + '</div></div>';

  var reasonSel = document.getElementById('br-reason');
  reasonSel.innerHTML = RELEASE_REASONS.map(function (r) { return '<option value="' + xe(r) + '">' + xe(r) + '</option>'; }).join('');
  document.getElementById('br-release-date').value = todayISO();
  document.getElementById('br-petition-date').value = '';
  var addr = AppState.addressCache[b.gstin] || AppState.addressCache[(b.gstin || '').toUpperCase()];
  document.getElementById('br-addr').value = (addr && addr.address) || '';
  document.getElementById('br-narrative').value = RELEASE_NARRATIVE_TEMPLATES[RELEASE_REASONS[0]];

  document.getElementById('br-form-card').style.display = 'block';
  document.getElementById('br-form-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function brReasonChanged() {
  var reason = document.getElementById('br-reason').value;
  document.getElementById('br-narrative').value = RELEASE_NARRATIVE_TEMPLATES[reason] || '';
}

function brGenerateRelease() {
  var b = AppState.bankAtts.find(function (x) { return x.id === _brSelectedId; });
  if (!b) { showToast('⚠️ Select an attachment first'); return; }
  var narrative = document.getElementById('br-narrative').value.trim();
  if (!narrative) { showToast('⚠️ Enter the case details for the release order'); return; }

  b.released = true;
  b.releasedDate = document.getElementById('br-release-date').value || todayISO();
  b.releasedReason = document.getElementById('br-reason').value;
  b.releasedPetitionDate = document.getElementById('br-petition-date').value;
  b.releasedAddr = document.getElementById('br-addr').value.trim();
  b.releasedNarrative = narrative;
  persist();

  showToast('✅ Attachment released — generating release order...');
  var cfg = getSettings();
  buildBankReleaseDocx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Release.docx'); });
  generateBankReleasePDF(b, cfg);

  renderBankReleaseTab();
  renderBankAtts();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
}

function renderReleasedList() {
  var wrap = document.getElementById('br-released-list');
  if (!wrap) return;
  var list = AppState.bankAtts.filter(function (b) { return b.released; })
    .sort(function (a, b) { return new Date(b.releasedDate || 0) - new Date(a.releasedDate || 0); });
  if (!list.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No attachments released yet.</div></div>';
    return;
  }
  wrap.innerHTML = list.map(function (b) {
    return '<div class="ba-card released">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">'
      + '<div><div style="font-weight:700;font-size:13px;">' + xe(taxpayerDisplayName(b.gstin, b.legalName)) + '</div><div class="gstin-cell">' + xe(b.gstin) + '</div></div>'
      + '<span class="pill pill-gray">Released ' + fmtDate(b.releasedDate) + '</span>'
      + '</div>'
      + '<div class="info-grid" style="margin-top:10px;">'
      + '<div class="info-item"><div class="info-label">Bank</div><div class="info-val" style="font-size:12px;">' + xe(b.bankName) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Reason</div><div class="info-val" style="font-size:12px;">' + xe(b.releasedReason || '—') + '</div></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + b.id + '\',\'docx\')"><i class="fa-solid fa-file-word"></i> Release Order (Word)</button>'
      + '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + b.id + '\',\'pdf\')"><i class="fa-solid fa-file-pdf"></i> PDF</button>'
      + '</div></div>';
  }).join('');
}

function brDownloadRelease(id, fmt) {
  var b = AppState.bankAtts.find(function (x) { return x.id === id; });
  if (!b) return;
  var cfg = getSettings();
  if (fmt === 'pdf') generateBankReleasePDF(b, cfg);
  else buildBankReleaseDocx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Release.docx'); });
}

/* Jump straight from a card's "Release" button in the Bank Attachment
   tab into the Release Attachment tab, with that attachment pre-selected. */
function baGoToRelease(id) {
  var tabEl = document.querySelector('#page-bulknotice .tab[data-tab="bankrelease"]');
  bulkTab('bankrelease', tabEl);
  brSelectAttachment(id);
}
