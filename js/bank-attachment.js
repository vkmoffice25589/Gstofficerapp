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
    ? matches.map(function (c) { return '<div class="gs-item" onclick="fillBankTaxpayer(\'' + c.gstin + '\')"><strong>' + xe(c.legalName) + '</strong><br><span style="color:var(--ink3);font-family:var(--mono);font-size:10px;">' + c.gstin + '</span></div>'; }).join('')
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

function saveBankAtt() {
  if (!_baSelectedGSTIN || !_baSelectedCases.length) { showToast('⚠️ Select a taxpayer with demands ≥ 90 days first'); return; }
  var bankName = document.getElementById('ba-bank-name').value.trim();
  var ifsc = document.getElementById('ba-ifsc').value.trim();
  if (!bankName || !ifsc) { showToast('⚠️ Bank name and IFSC are required'); return; }

  var c0 = _baSelectedCases[0];
  var totalAmt = _baSelectedCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  var b = {
    id: uid('bank'), gstin: _baSelectedGSTIN, legalName: c0.legalName, cases: _baSelectedCases, totalAmt: totalAmt,
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
  showToast('✅ Bank attachment ' + b.ref + ' saved');
  resetBankForm();
  renderBankAtts();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
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
  if (!AppState.bankAtts.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-building-columns" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Bank Attachments</div><div class="empty-sub">Attachments you create will appear here</div></div>';
    return;
  }
  var list = AppState.bankAtts.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  wrap.innerHTML = list.map(function (b) {
    return '<div class="ba-card' + (b.released ? ' released' : '') + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">'
      + '<div><div style="font-weight:700;font-size:13px;">' + xe(b.legalName) + '</div><div class="gstin-cell">' + xe(b.gstin) + '</div></div>'
      + (b.released ? '<span class="pill pill-gray">Released ' + fmtDate(b.releasedDate) + '</span>' : '<span class="pill pill-red">Active</span>')
      + '</div>'
      + '<div class="info-grid" style="margin-top:10px;">'
      + '<div class="info-item"><div class="info-label">Bank</div><div class="info-val" style="font-size:12px;">' + xe(b.bankName) + '</div></div>'
      + '<div class="info-item"><div class="info-label">IFSC</div><div class="info-val" style="font-size:12px;">' + xe(b.ifsc) + '</div></div>'
      + '<div class="info-item"><div class="info-label">Account No.</div><div class="info-val" style="font-size:12px;">' + xe(b.accno || '—') + '</div></div>'
      + '<div class="info-item"><div class="info-label">Attached Amount</div><div class="info-val" style="color:var(--red);">' + fmt(b.totalAmt) + '</div></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;margin-top:12px;">'
      + (!b.released ? '<button class="btn btn-orange btn-xs" onclick="openReleaseModal(\'' + b.id + '\')"><i class="fa-solid fa-unlock"></i> Release</button>' : '')
      + '</div></div>';
  }).join('');
}

var RELEASE_REASONS = ['Demand Paid', 'First Appeal Filed', 'WP Filed & Stay Obtained', 'Revision - Demand Nullified'];
var _releaseTargetId = null;

function openReleaseModal(id) {
  _releaseTargetId = id;
  var opts = RELEASE_REASONS.map(function (r, i) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:12px;"><input type="radio" name="release-reason" value="' + xe(r) + '" ' + (i === 0 ? 'checked' : '') + '> ' + xe(r) + '</label>';
  }).join('');
  document.getElementById('release-modal-body').innerHTML = opts;
  document.getElementById('release-overlay').classList.add('show');
}
function closeReleaseModal() { document.getElementById('release-overlay').classList.remove('show'); _releaseTargetId = null; }

function confirmRelease() {
  var b = AppState.bankAtts.find(function (x) { return x.id === _releaseTargetId; });
  if (!b) return;
  var reasonEl = document.querySelector('input[name="release-reason"]:checked');
  var reason = reasonEl ? reasonEl.value : RELEASE_REASONS[0];
  b.released = true; b.releasedDate = todayISO(); b.releasedReason = reason;
  persist();
  closeReleaseModal();
  renderBankAtts();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  buildBankReleaseDocx(b, reason, getSettings()).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Release.docx'); });
  showToast('✅ Attachment released');
}
