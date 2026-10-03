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
    +   '<button type="button" class="isc-view-btn" onclick="goToTaxpayerCase(\'' + gstin + '\')">View Full Details <i class="fa-solid fa-arrow-right"></i></button>'
    +   '<button type="button" class="isc-link-btn" onclick="goToNoticeHistory(\'' + gstin + '\')"><i class="fa-solid fa-clock-rotate-left"></i> Notice History</button>'
    + '</div>';

  if (!eligibleCases.length) {
    document.getElementById('ba-demand-section').style.display = 'none';
    showToast('⚠️ No demands ≥ 90 days found for this taxpayer. Bank attachment requires demands older than 90 days.');
    return;
  }

  document.getElementById('ba-demand-section').style.display = 'block';
  var baSticky = document.getElementById('ba-sticky-taxpayer');
  baSticky.textContent = displayName;
  baSticky.style.display = 'block';
  _baSection62 = 'exclude';
  _baSelectedDemandIds = new Set(eligibleCases.filter(function (c) { return !baIsFlagged(c); }).map(function (c) { return c.demandId; }));
  baUpdateQuickFilterCounts();
  baApplyFiltersAndRender();
  document.getElementById('ba-demand-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  document.getElementById('ba-sticky-taxpayer').style.display = 'none';
  document.getElementById('ba-bank-status').textContent = '';
  document.getElementById('ba-date').value = todayISO();
  baUpdateSelectionSummary();
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
      + '<button class="btn btn-orange btn-xs" onclick="relGoToRelease(\'bank\',\'' + b.id + '\')"><i class="fa-solid fa-unlock"></i> Release</button>'
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

/* ===== Release Attachment tab — unified across all three attachment
   types (Bank, Third-Party, Property). Lists every active (not yet
   released) attachment of any type, filterable by GSTIN/taxpayer, and
   releases the selected one with the matching Release Order (Word + PDF)
   — Bank uses buildBankReleaseDocx/generateBankReleasePDF, Third-Party
   uses buildThirdPartyReleaseDocx/generateThirdPartyReleasePDF, Property
   uses buildPropertyReleaseDocx/generatePropertyReleasePDF. Previously
   this tab only handled bank attachments; third-party and property
   attachments had no release concept at all. ===== */
var RELEASE_REASONS = ['Demand Paid', 'First Appeal Filed', 'WP Filed & Stay Obtained', 'Revision - Demand Nullified'];
var RELEASE_NARRATIVE_TEMPLATES = {
  'Demand Paid': 'The taxpayer has since remitted the outstanding demand in full and has furnished proof of payment to this office.',
  'First Appeal Filed': 'The taxpayer has filed a reply to this office stating that they have filed a First Appeal against the demand along with the requisite pre-deposit, and has furnished proof of the same.',
  'WP Filed & Stay Obtained': 'The taxpayer has filed a reply to this office stating that they have filed a writ petition before the Honourable High Court and have complied with the conditions ordered therein.',
  'Revision - Demand Nullified': 'The demand against the taxpayer has been nullified pursuant to a revision order passed by the competent authority, a copy of which has been furnished to this office.'
};
var _relFilters = { search: '', type: '', status: 'active', from: '', to: '' };
var _relSelectedKeys = new Set(); // "type|id", active rows only — see relToggleRowCheck
var _relPending = null; // { type: 'bank'|'thirdparty'|'property', id } or { bulk: true, keys: [...] }
var _relPageSize = 10;
var _relCurrentPage = 1;
var REL_TYPE_BADGE = {
  bank: '<span class="pill pill-blue"><i class="fa-solid fa-building-columns"></i> Bank</span>',
  thirdparty: '<span class="pill pill-purple"><i class="fa-solid fa-user-group"></i> Third-Party</span>',
  property: '<span class="pill pill-gold"><i class="fa-solid fa-house"></i> Property</span>'
};
function relTypeList(type) { return type === 'bank' ? AppState.bankAtts : type === 'thirdparty' ? AppState.thirdPartyNotices : AppState.propertyAttachments; }
function relTypeGstin(type, rec) { return type === 'thirdparty' ? rec.defaulterGstin : rec.gstin; }

function renderBankReleaseTab() {
  var g = document.getElementById('rel-gstin-filter'); if (g) g.value = _relFilters.search;
  var t = document.getElementById('rel-type-filter'); if (t) t.value = _relFilters.type;
  var s = document.getElementById('rel-status-filter'); if (s) s.value = _relFilters.status;
  var fd = document.getElementById('rel-from-date'); if (fd) fd.value = _relFilters.from;
  var td = document.getElementById('rel-to-date'); if (td) td.value = _relFilters.to;
  _relPending = null;
  renderReleaseSummaryCards();
  renderReleasableList();
}

/* Every attachment of any type, active or released — relFilteredAttachments()
   narrows this down for the table; renderReleaseSummaryCards() uses the
   unfiltered set so the KPI counts stay stable while the officer filters. */
function relAllAttachments() {
  var out = [];
  AppState.bankAtts.forEach(function (b) {
    out.push({ type: 'bank', id: b.id, gstin: b.gstin, legalName: b.legalName, label: (b.bankName || '—') + (b.branch ? ' — ' + b.branch : ''), amount: b.totalAmt, date: b.date, released: !!b.released });
  });
  AppState.thirdPartyNotices.forEach(function (t) {
    out.push({ type: 'thirdparty', id: t.id, gstin: t.defaulterGstin, legalName: t.legalName, label: t.debtorLegal || '—', amount: t.totalAmt, date: t.date, released: !!t.released });
  });
  AppState.propertyAttachments.forEach(function (p) {
    out.push({ type: 'property', id: p.id, gstin: p.gstin, legalName: p.legalName, label: p.propertyDescription || '—', amount: p.totalAmt, date: p.date, released: !!p.released });
  });
  return out;
}

function relFilteredAttachments() {
  var items = relAllAttachments();
  var f = _relFilters;
  if (f.search) items = items.filter(function (it) {
    return (it.gstin || '').toUpperCase().indexOf(f.search) !== -1 || (it.legalName || '').toUpperCase().indexOf(f.search) !== -1;
  });
  if (f.type) items = items.filter(function (it) { return it.type === f.type; });
  if (f.status === 'active') items = items.filter(function (it) { return !it.released; });
  else if (f.status === 'released') items = items.filter(function (it) { return it.released; });
  if (f.from) items = items.filter(function (it) { return it.date && it.date >= f.from; });
  if (f.to) items = items.filter(function (it) { return it.date && it.date <= f.to; });
  return items.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}

function kpiCard(color, icon, label, value, sub, onclick) {
  return '<div class="kpi-card ' + color + '" onclick="' + onclick + '">'
    + '<div class="kpi-icon"><i class="fa-solid ' + icon + '"></i></div>'
    + '<div class="kpi-label">' + label + '</div>'
    + '<div class="kpi-value ' + color + '">' + value + '</div>'
    + '<div class="kpi-sub">' + xe(sub) + '</div>'
    + '</div>';
}

function renderReleaseSummaryCards() {
  var grid = document.getElementById('rel-kpi-grid');
  if (!grid) return;
  var all = relAllAttachments();
  var active = all.filter(function (it) { return !it.released; });
  var released = all.filter(function (it) { return it.released; });
  var bank = all.filter(function (it) { return it.type === 'bank'; });
  var tp = all.filter(function (it) { return it.type === 'thirdparty'; });
  var prop = all.filter(function (it) { return it.type === 'property'; });
  var sum = function (arr) { return arr.reduce(function (s, it) { return s + (Number(it.amount) || 0); }, 0); };
  grid.innerHTML =
    kpiCard('blue', 'fa-layer-group', 'TOTAL ATTACHMENTS', String(all.length), 'Bank + Third-Party + Property', "relQuickFilter('status','')")
    + kpiCard('red', 'fa-lock', 'ACTIVE ATTACHMENTS', String(active.length), fmt(sum(active)), "relQuickFilter('status','active')")
    + kpiCard('green', 'fa-lock-open', 'RELEASED ATTACHMENTS', String(released.length), fmt(sum(released)), "relQuickFilter('status','released')")
    + kpiCard('blue', 'fa-building-columns', 'BANK ATTACHMENTS', String(bank.length), fmt(sum(bank)), "relQuickFilter('type','bank')")
    + kpiCard('purple', 'fa-user-group', 'THIRD-PARTY ATTACHMENTS', String(tp.length), fmt(sum(tp)), "relQuickFilter('type','thirdparty')")
    + kpiCard('gold', 'fa-house', 'PROPERTY ATTACHMENTS', String(prop.length), fmt(sum(prop)), "relQuickFilter('type','property')");
}

function relSearchChanged() {
  _relFilters.search = (document.getElementById('rel-gstin-filter').value || '').trim().toUpperCase();
  _relCurrentPage = 1;
  renderReleasableList();
}

function relApplyFilters() {
  _relFilters.search = (document.getElementById('rel-gstin-filter').value || '').trim().toUpperCase();
  _relFilters.type = document.getElementById('rel-type-filter').value;
  _relFilters.status = document.getElementById('rel-status-filter').value;
  _relFilters.from = document.getElementById('rel-from-date').value;
  _relFilters.to = document.getElementById('rel-to-date').value;
  _relCurrentPage = 1;
  renderReleasableList();
}

function relResetFilters() {
  _relFilters = { search: '', type: '', status: 'active', from: '', to: '' };
  var g = document.getElementById('rel-gstin-filter'); if (g) g.value = '';
  var t = document.getElementById('rel-type-filter'); if (t) t.value = '';
  var s = document.getElementById('rel-status-filter'); if (s) s.value = 'active';
  var fd = document.getElementById('rel-from-date'); if (fd) fd.value = '';
  var td = document.getElementById('rel-to-date'); if (td) td.value = '';
  _relCurrentPage = 1;
  renderReleasableList();
}

/* Clicking a summary card jumps straight to that filter, same convention
   as the Dashboard's own KPI cards. */
function relQuickFilter(key, value) {
  _relFilters[key] = value;
  var idMap = { status: 'rel-status-filter', type: 'rel-type-filter' };
  var el = document.getElementById(idMap[key]); if (el) el.value = value;
  _relCurrentPage = 1;
  renderReleasableList();
}

function renderReleasableList() {
  var wrap = document.getElementById('rel-list-wrap');
  if (!wrap) return;
  var items = relFilteredAttachments();

  if (!items.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No attachments match the current filters.</div></div>';
    relUpdateBulkBar();
    return;
  }

  var pageSize = _relPageSize === 'all' ? items.length : _relPageSize;
  var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  if (_relCurrentPage > totalPages) _relCurrentPage = totalPages;
  if (_relCurrentPage < 1) _relCurrentPage = 1;
  var startIdx = (_relCurrentPage - 1) * pageSize;
  var pageItems = items.slice(startIdx, startIdx + pageSize);

  var rows = pageItems.map(function (it, i) {
    var key = it.type + '|' + it.id;
    var chkCell = it.released
      ? '<input type="checkbox" disabled title="Released attachments can\'t be bulk-released">'
      : '<input type="checkbox" class="rel-row-chk" data-key="' + key + '"' + (_relSelectedKeys.has(key) ? ' checked' : '') + ' onchange="relToggleRowCheck(this)">';
    var statusPill = it.released ? '<span class="pill pill-gray">Released</span>' : '<span class="pill pill-red">Active</span>';
    var actionCell = it.released
      ? '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + it.type + '\',\'' + it.id + '\',\'docx\')" title="Release Order (Word)"><i class="fa-solid fa-file-word"></i></button> '
        + '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + it.type + '\',\'' + it.id + '\',\'pdf\')" title="Release Order (PDF)"><i class="fa-solid fa-file-pdf"></i></button>'
      : '<button class="btn btn-orange btn-xs" onclick="relSelectItem(\'' + it.type + '\',\'' + it.id + '\')"><i class="fa-solid fa-unlock"></i> Release</button>';
    return '<tr>'
      + '<td>' + chkCell + '</td>'
      + '<td>' + (startIdx + i + 1) + '</td>'
      + '<td>' + fmtDate(it.date) + '</td>'
      + '<td class="gstin-cell">' + xe(it.gstin) + '</td>'
      + '<td>' + xe(taxpayerDisplayName(it.gstin, it.legalName)) + '</td>'
      + '<td>' + REL_TYPE_BADGE[it.type] + '</td>'
      + '<td style="font-size:12px;">' + xe(it.label) + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(it.amount) + '</div></td>'
      + '<td>' + statusPill + '</td>'
      + '<td style="white-space:nowrap;">' + actionCell + '</td>'
      + '</tr>';
  }).join('');

  var allActiveKeys = items.filter(function (it) { return !it.released; }).map(function (it) { return it.type + '|' + it.id; });
  var allChecked = allActiveKeys.length > 0 && allActiveKeys.every(function (k) { return _relSelectedKeys.has(k); });
  var someChecked = allActiveKeys.some(function (k) { return _relSelectedKeys.has(k); });

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr>'
    + '<th><input type="checkbox" id="rel-select-all"' + (allChecked ? ' checked' : '') + ' onchange="relToggleSelectAll(this.checked)"></th>'
    + '<th>#</th><th>Date</th><th>GSTIN</th><th>Taxpayer Name</th><th>Type</th><th>Details</th><th>Amount (₹)</th><th>Status</th><th>Action</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + relPaginationHTML(items.length, totalPages);

  var selectAllEl = document.getElementById('rel-select-all');
  if (selectAllEl) selectAllEl.indeterminate = someChecked && !allChecked;
  relUpdateBulkBar();
}

function relPaginationHTML(total, totalPages) {
  var pageBtns = wizPageNumberList(_relCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _relCurrentPage ? ' active' : '') + '" onclick="relGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');
  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_relPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_relPageSize === 'all' ? ' selected' : '') + '>All</option>';
  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="relGoToPage(-1)"' + (_relCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="relGoToPage(1)"' + (_relCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="relSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}
function relSetPageSize(val) { _relPageSize = val === 'all' ? 'all' : parseInt(val, 10); _relCurrentPage = 1; renderReleasableList(); }
function relGoToPage(delta) { _relCurrentPage += delta; renderReleasableList(); }
function relGoToPageNum(n) { _relCurrentPage = n; renderReleasableList(); }

function relToggleRowCheck(el) {
  var key = el.getAttribute('data-key');
  if (el.checked) _relSelectedKeys.add(key); else _relSelectedKeys.delete(key);
  var allActiveKeys = relFilteredAttachments().filter(function (it) { return !it.released; }).map(function (it) { return it.type + '|' + it.id; });
  var selectAllEl = document.getElementById('rel-select-all');
  if (selectAllEl) {
    var allChecked = allActiveKeys.length > 0 && allActiveKeys.every(function (k) { return _relSelectedKeys.has(k); });
    selectAllEl.checked = allChecked;
    selectAllEl.indeterminate = !allChecked && allActiveKeys.some(function (k) { return _relSelectedKeys.has(k); });
  }
  relUpdateBulkBar();
}

function relToggleSelectAll(checked) {
  relFilteredAttachments().filter(function (it) { return !it.released; }).forEach(function (it) {
    var key = it.type + '|' + it.id;
    if (checked) _relSelectedKeys.add(key); else _relSelectedKeys.delete(key);
  });
  renderReleasableList();
}

function relUpdateBulkBar() {
  var bar = document.getElementById('rel-bulk-bar');
  if (!bar) return;
  if (_relSelectedKeys.size > 0) {
    bar.style.display = 'flex';
    document.getElementById('rel-bulk-count').textContent = _relSelectedKeys.size + ' selected';
  } else {
    bar.style.display = 'none';
  }
}

function relSelectItem(type, id) {
  var rec = relTypeList(type).find(function (x) { return x.id === id; });
  if (!rec) return;
  _relPending = { type: type, id: id };
  var gstin = relTypeGstin(type, rec);

  var addrFg = document.getElementById('rel-addr-fg'); if (addrFg) addrFg.style.display = '';
  document.getElementById('rel-modal-name').textContent = taxpayerDisplayName(gstin, rec.legalName);
  document.getElementById('rel-modal-sub').textContent = gstin;

  var infoHtml;
  if (type === 'bank') {
    infoHtml = '<div class="info-item"><div class="info-label">Bank</div><div class="info-val" style="font-size:12px;">' + xe(rec.bankName) + '</div></div>'
      + '<div class="info-item"><div class="info-label">IFSC</div><div class="info-val" style="font-size:12px;">' + xe(rec.ifsc) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Attachment Ref.</div><div class="info-val" style="font-size:12px;">' + xe(rec.ref) + '</div></div>';
  } else if (type === 'thirdparty') {
    infoHtml = '<div class="info-item"><div class="info-label">Third Party</div><div class="info-val" style="font-size:12px;">' + xe(rec.debtorLegal) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Notice Date</div><div class="info-val" style="font-size:12px;">' + fmtDate(rec.date) + '</div></div>';
  } else {
    infoHtml = '<div class="info-item"><div class="info-label">Property</div><div class="info-val" style="font-size:12px;">' + xe(rec.propertyDescription) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Location</div><div class="info-val" style="font-size:12px;">' + xe(rec.propertyLocation) + '</div></div>';
  }
  infoHtml += '<div class="info-item"><div class="info-label">Demand Amount</div><div class="info-val" style="color:var(--red);">' + fmt(rec.totalAmt) + '</div></div>';
  document.getElementById('rel-modal-info').innerHTML = infoHtml;

  var reasonSel = document.getElementById('rel-reason');
  reasonSel.innerHTML = RELEASE_REASONS.map(function (r) { return '<option value="' + xe(r) + '">' + xe(r) + '</option>'; }).join('');
  document.getElementById('rel-release-date').value = todayISO();
  document.getElementById('rel-petition-date').value = '';
  var addr = AppState.addressCache[gstin] || AppState.addressCache[(gstin || '').toUpperCase()];
  document.getElementById('rel-addr').value = type === 'thirdparty' ? (rec.debtorAddr || '') : ((addr && addr.address) || '');
  document.getElementById('rel-narrative').value = RELEASE_NARRATIVE_TEMPLATES[RELEASE_REASONS[0]];

  document.getElementById('rel-modal-overlay').classList.add('show');
}

/* Releases every checked row with one shared reason/date/narrative — each
   attachment still gets its own type-specific Release Order document, and
   its own address resolved automatically (bank/property from the DCR
   address cache, third-party from the debtor's own address on the
   notice), since a single typed address wouldn't make sense across
   different taxpayers/parties in the same batch. */
function relOpenBulkModal() {
  if (!_relSelectedKeys.size) return;
  _relPending = { bulk: true, keys: Array.from(_relSelectedKeys) };

  var addrFg = document.getElementById('rel-addr-fg'); if (addrFg) addrFg.style.display = 'none';
  document.getElementById('rel-modal-name').textContent = _relSelectedKeys.size + ' attachments selected';
  document.getElementById('rel-modal-sub').textContent = 'Bulk release';
  document.getElementById('rel-modal-info').innerHTML = '<div class="info-item" style="grid-column:1/-1;"><div class="info-label">Note</div><div class="info-val" style="font-size:12px;font-weight:400;">Each attachment\'s own address is used automatically for its Release Order.</div></div>';

  var reasonSel = document.getElementById('rel-reason');
  reasonSel.innerHTML = RELEASE_REASONS.map(function (r) { return '<option value="' + xe(r) + '">' + xe(r) + '</option>'; }).join('');
  document.getElementById('rel-release-date').value = todayISO();
  document.getElementById('rel-petition-date').value = '';
  document.getElementById('rel-addr').value = '';
  document.getElementById('rel-narrative').value = RELEASE_NARRATIVE_TEMPLATES[RELEASE_REASONS[0]];

  document.getElementById('rel-modal-overlay').classList.add('show');
}

function relReasonChanged() {
  var reason = document.getElementById('rel-reason').value;
  document.getElementById('rel-narrative').value = RELEASE_NARRATIVE_TEMPLATES[reason] || '';
}

function relCloseModal() {
  document.getElementById('rel-modal-overlay').classList.remove('show');
}

/* Marks one record released, fills its release fields and generates its
   Release Order (Word + PDF). addrOverride is the officer-typed address
   (single-release mode); omitted in bulk mode, where each record's own
   address is looked up instead. Shared by relConfirmRelease()'s single
   and bulk paths so the document-generation logic lives in one place. */
function relReleaseOne(type, id, reason, releaseDate, petitionDate, narrative, addrOverride) {
  var rec = relTypeList(type).find(function (x) { return x.id === id; });
  if (!rec) return;
  var gstin = relTypeGstin(type, rec);

  rec.released = true;
  rec.releasedDate = releaseDate;
  rec.releasedReason = reason;
  rec.releasedPetitionDate = petitionDate;
  rec.releasedNarrative = narrative;
  if (addrOverride !== undefined) {
    rec.releasedAddr = addrOverride;
  } else {
    var addr = AppState.addressCache[gstin] || AppState.addressCache[(gstin || '').toUpperCase()];
    rec.releasedAddr = type === 'thirdparty' ? (rec.debtorAddr || '') : ((addr && addr.address) || '');
  }

  var cfg = getSettings();
  if (type === 'bank') {
    buildBankReleaseDocx(rec, cfg).then(function (blob) { downloadBlob(blob, rec.ref.replace(/\//g, '_') + '_Release.docx'); });
    generateBankReleasePDF(rec, cfg);
  } else if (type === 'thirdparty') {
    buildThirdPartyReleaseDocx(rec, cfg).then(function (blob) { downloadBlob(blob, ('TP_Release_' + rec.defaulterGstin).replace(/[\/\\]/g, '_') + '.docx'); });
    generateThirdPartyReleasePDF(rec, cfg);
  } else {
    buildPropertyReleaseDocx(rec, cfg).then(function (blob) { downloadBlob(blob, ('Property_Release_' + rec.gstin).replace(/[\/\\]/g, '_') + '.docx'); });
    generatePropertyReleasePDF(rec, cfg);
  }
}

function relConfirmRelease() {
  if (!_relPending) return;
  var narrative = document.getElementById('rel-narrative').value.trim();
  if (!narrative) { showToast('⚠️ Enter the case details for the release order'); return; }

  var reason = document.getElementById('rel-reason').value;
  var releaseDate = document.getElementById('rel-release-date').value || todayISO();
  var petitionDate = document.getElementById('rel-petition-date').value;

  if (_relPending.bulk) {
    var keys = _relPending.keys;
    keys.forEach(function (key) {
      var parts = key.split('|');
      relReleaseOne(parts[0], parts[1], reason, releaseDate, petitionDate, narrative);
    });
    _relSelectedKeys.clear();
    showToast('✅ ' + keys.length + ' attachments released — generating release orders...');
  } else {
    var addr = document.getElementById('rel-addr').value.trim();
    relReleaseOne(_relPending.type, _relPending.id, reason, releaseDate, petitionDate, narrative, addr);
    showToast('✅ Attachment released — generating release order...');
  }
  persist();

  relCloseModal();
  renderReleaseSummaryCards();
  renderReleasableList();
  renderReleasedList();
  renderBankAtts();
  renderThirdPartyList();
  renderPropertyList();
  updateSidebar();
  _relPending = null;
}

function renderReleasedList() {
  var wrap = document.getElementById('br-released-list');
  if (!wrap) return;
  var items = [];
  AppState.bankAtts.filter(function (b) { return b.released; }).forEach(function (b) { items.push({ type: 'bank', rec: b, gstin: b.gstin, legalName: b.legalName, label: 'Bank: ' + (b.bankName || '—') }); });
  AppState.thirdPartyNotices.filter(function (t) { return t.released; }).forEach(function (t) { items.push({ type: 'thirdparty', rec: t, gstin: t.defaulterGstin, legalName: t.legalName, label: 'Third Party: ' + (t.debtorLegal || '—') }); });
  AppState.propertyAttachments.filter(function (p) { return p.released; }).forEach(function (p) { items.push({ type: 'property', rec: p, gstin: p.gstin, legalName: p.legalName, label: 'Property: ' + (p.propertyDescription || '—') }); });
  items.sort(function (a, b) { return new Date(b.rec.releasedDate || 0) - new Date(a.rec.releasedDate || 0); });

  if (!items.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-sub">No attachments released yet.</div></div>';
    return;
  }
  wrap.innerHTML = items.map(function (it) {
    var b = it.rec;
    return '<div class="ba-card released">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">'
      + '<div>' + REL_TYPE_BADGE[it.type] + ' <span style="font-weight:700;font-size:13px;">' + xe(taxpayerDisplayName(it.gstin, it.legalName)) + '</span><div class="gstin-cell">' + xe(it.gstin) + '</div></div>'
      + '<span class="pill pill-gray">Released ' + fmtDate(b.releasedDate) + '</span>'
      + '</div>'
      + '<div class="info-grid" style="margin-top:10px;">'
      + '<div class="info-item"><div class="info-label">Details</div><div class="info-val" style="font-size:12px;">' + xe(it.label) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Reason</div><div class="info-val" style="font-size:12px;">' + xe(b.releasedReason || '—') + '</div></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + it.type + '\',\'' + b.id + '\',\'docx\')"><i class="fa-solid fa-file-word"></i> Release Order (Word)</button>'
      + '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + it.type + '\',\'' + b.id + '\',\'pdf\')"><i class="fa-solid fa-file-pdf"></i> PDF</button>'
      + '</div></div>';
  }).join('');
}

function brDownloadRelease(type, id, fmt) {
  var rec = relTypeList(type).find(function (x) { return x.id === id; });
  if (!rec) return;
  var cfg = getSettings();
  if (type === 'bank') {
    if (fmt === 'pdf') generateBankReleasePDF(rec, cfg);
    else buildBankReleaseDocx(rec, cfg).then(function (blob) { downloadBlob(blob, rec.ref.replace(/\//g, '_') + '_Release.docx'); });
  } else if (type === 'thirdparty') {
    if (fmt === 'pdf') generateThirdPartyReleasePDF(rec, cfg);
    else buildThirdPartyReleaseDocx(rec, cfg).then(function (blob) { downloadBlob(blob, ('TP_Release_' + rec.defaulterGstin).replace(/[\/\\]/g, '_') + '.docx'); });
  } else {
    if (fmt === 'pdf') generatePropertyReleasePDF(rec, cfg);
    else buildPropertyReleaseDocx(rec, cfg).then(function (blob) { downloadBlob(blob, ('Property_Release_' + rec.gstin).replace(/[\/\\]/g, '_') + '.docx'); });
  }
}

/* Jump straight from a card's "Release" button (Bank/Third-Party/Property
   list) into the Release Attachment tab, with that attachment pre-selected. */
function relGoToRelease(type, id) {
  nav('bulknotice');
  var tabEl = document.querySelector('#page-bulknotice .tab[data-tab="bankrelease"]');
  bulkTab('bankrelease', tabEl);
  relSelectItem(type, id);
}
