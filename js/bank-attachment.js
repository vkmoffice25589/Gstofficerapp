/* ===== Bank Attachments — ≥90-day hard filter, IFSC autofill, release flow ===== */

var _baSelectedGSTIN = null;
var _baSelectedCases = [];
var _ifscCache = {};

function baSearchTaxpayer(query) {
  var resultsEl = document.getElementById('ba-tp-results');
  query = (query || '').trim().toUpperCase();
  if (query.length < 2) { resultsEl.style.display = 'none'; return; }
  var seen = {};
  var matches = AppState.cases.filter(isValidCase).filter(function (c) {
    if (seen[c.gstin]) return false;
    var eligible = isNoticeEligible(c) && (function () { var age = getDemandAgeDays(c); return age === null || age >= 90; })();
    if (!eligible) return false;
    var hit = c.gstin.toUpperCase().includes(query) || (c.legalName || '').toUpperCase().includes(query);
    if (hit) seen[c.gstin] = true;
    return hit;
  }).slice(0, 12);

  resultsEl.innerHTML = matches.length
    ? matches.map(function (c) { return '<div class="gs-item" onclick="fillBankTaxpayer(\'' + c.gstin + '\')"><strong>' + xe(taxpayerDisplayName(c.gstin, c.legalName)) + '</strong><br><span style="color:var(--ink3);font-family:var(--mono);font-size:10px;">' + c.gstin + '</span></div>'; }).join('')
    : '<div class="gs-item">No taxpayers with demands ≥ 90 days found</div>';
  resultsEl.style.display = 'block';
}

function fillBankTaxpayer(gstin) {
  _baSelectedGSTIN = gstin;
  var c0 = AppState.cases.find(function (c) { return c.gstin === gstin; });
  document.getElementById('ba-tp-search').value = c0 ? c0.legalName : gstin;
  document.getElementById('ba-tp-results').style.display = 'none';
  document.getElementById('ba-gstin').value = gstin;

  var allCases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  _baSelectedCases = allCases.filter(isNoticeEligible).filter(function (c) {
    var age = getDemandAgeDays(c);
    return age === null || age >= 90;
  });

  var wrap = document.getElementById('ba-demands-preview');
  if (!_baSelectedCases.length) {
    wrap.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--orange);background:var(--orange-dim);border:1px solid var(--orange-border);border-radius:6px;">⚠️ No demands ≥ 90 days found for this taxpayer. Bank attachment requires demands older than 90 days.</div>';
    setBankAmount('₹0');
    return;
  }

  var totalPend = _baSelectedCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  setBankAmount(fmt(totalPend));

  var rows = _baSelectedCases.map(function (c) {
    return '<tr><td class="demand-id">' + xe(c.demandId) + '</td><td>' + xe(c.taxPeriod) + '</td><td style="text-align:center;">' + (getDemandAgeDays(c) || '—') + '</td><td><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td></tr>';
  }).join('');
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Demand ID</th><th>Tax Period</th><th>Age (days)</th><th>Pending</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
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

function generateBankAttachment() {
  if (!_baSelectedGSTIN || !_baSelectedCases.length) { showToast('⚠️ Select a taxpayer with demands ≥ 90 days first'); return; }
  var bankName = document.getElementById('ba-bank-name').value.trim();
  var ifsc = document.getElementById('ba-ifsc').value.trim();
  if (!bankName || !ifsc) { showToast('⚠️ Bank name and IFSC are required'); return; }
  var draftFields = { accno: document.getElementById('ba-accno').value.trim(), pan: document.getElementById('ba-pan').value.trim() };
  if (!confirmMissingFields(draftFields, BANK_ATT_REQUIRED_FIELDS, 'This bank attachment (Form DRC-13)')) return;

  var c0 = _baSelectedCases[0];
  var totalAmt = _baSelectedCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  var b = {
    id: uid('bank'), gstin: _baSelectedGSTIN, legalName: c0.legalName, cases: caseSnapshots(_baSelectedCases), totalAmt: totalAmt,
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
  showToast('✅ Bank attachment ' + b.ref + ' saved — generating documents...');
  resetBankForm();
  renderBankAtts();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  downloadBankAttDocs(b);
}

/* Generates and downloads both documents (Letter to Bank + Form DRC-13),
   each as Word and PDF — four files — from the saved record's data, the
   same "regenerate fresh from saved fields, never persist the file itself"
   pattern every other document type in this app already follows. */
function downloadBankAttDocs(b) {
  var cfg = getSettings();
  buildBankLetterDocx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Letter.docx'); });
  generateBankLetterPDF(b, cfg);
  buildBankDrc13Docx(b, cfg).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_DRC13.docx'); });
  generateBankDrc13PDF(b, cfg);
}

function resetBankForm() {
  _baSelectedGSTIN = null; _baSelectedCases = [];
  ['ba-tp-search', 'ba-gstin', 'ba-ifsc', 'ba-bank-name', 'ba-branch', 'ba-branch-addr', 'ba-accno', 'ba-pan', 'ba-officer'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('ba-demands-preview').innerHTML = '';
  setBankAmount('₹0');
  document.getElementById('ba-bank-status').textContent = '';
  document.getElementById('ba-date').value = todayISO();
}

function setBankAmount(text) {
  var input = document.getElementById('ba-amount');
  var display = document.getElementById('ba-amount-display');
  if (input) input.value = text;
  if (display) display.textContent = text;
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
