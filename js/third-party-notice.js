/* ===== Third-Party Debtor Notice (Form GST DRC-13, Section 79(1)(c)) ===== */

var _tpDefaulterGSTIN = null;

function tpSearchDefaulter(query) {
  var resultsEl = document.getElementById('tp-defaulter-results');
  query = (query || '').trim().toUpperCase();
  if (query.length < 2) { resultsEl.style.display = 'none'; return; }
  var seen = {};
  var matches = AppState.cases.filter(isValidCase).filter(isNoticeEligible).filter(function (c) {
    if (seen[c.gstin]) return false;
    var hit = c.gstin.toUpperCase().includes(query) || (c.legalName || '').toUpperCase().includes(query);
    if (hit) seen[c.gstin] = true;
    return hit;
  }).slice(0, 12);
  resultsEl.innerHTML = matches.length
    ? matches.map(function (c) { return '<div class="gs-item" onclick="tpSelectDefaulter(\'' + c.gstin + '\')"><strong>' + xe(taxpayerDisplayName(c.gstin, c.legalName)) + '</strong><br><span style="color:var(--ink3);font-family:var(--mono);font-size:10px;">' + c.gstin + '</span></div>'; }).join('')
    : '<div class="gs-item">No matches</div>';
  resultsEl.style.display = 'block';
}

function tpSelectDefaulter(gstin) {
  _tpDefaulterGSTIN = gstin;
  var c0 = AppState.cases.find(function (c) { return c.gstin === gstin; });
  document.getElementById('tp-defaulter-search').value = c0 ? c0.legalName : gstin;
  document.getElementById('tp-defaulter-results').style.display = 'none';
  document.getElementById('tp-defaulter-gstin').value = gstin;

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; }).filter(isNoticeEligible);
  var wrap = document.getElementById('tp-defaulter-demands');
  if (!cases.length) { wrap.innerHTML = '<div class="empty-sub">No eligible demands for this defaulter.</div>'; return; }
  var rows = cases.map(function (c) {
    return '<tr><td><input type="checkbox" class="tp-case-chk" data-demand="' + xe(c.demandId) + '" checked></td>'
      + '<td class="demand-id">' + xe(c.demandId) + '</td><td>' + xe(c.taxPeriod) + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td></tr>';
  }).join('');
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th></th><th>Demand ID</th><th>Tax Period</th><th>Pending</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function tpSelectedCases() {
  var checked = Array.from(document.querySelectorAll('.tp-case-chk:checked')).map(function (el) { return el.getAttribute('data-demand'); });
  return AppState.cases.filter(function (c) { return c.gstin === _tpDefaulterGSTIN && checked.includes(c.demandId); });
}

function tpBuildNotice() {
  if (!_tpDefaulterGSTIN) { showToast('⚠️ Select a defaulter taxpayer first'); return null; }
  var cases = tpSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand'); return null; }
  var debtorLegal = document.getElementById('tp-debtor-legal').value.trim();
  if (!debtorLegal) { showToast('⚠️ Enter the third party (debtor) name'); return null; }
  var c0 = cases[0];
  var totalAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  return {
    id: uid('tp'), defaulterGstin: _tpDefaulterGSTIN, legalName: c0.legalName,
    debtorGstin: document.getElementById('tp-debtor-gstin').value.trim(),
    debtorLegal: debtorLegal, debtorTrade: document.getElementById('tp-debtor-trade').value.trim(),
    debtorMobile: document.getElementById('tp-debtor-mobile').value.trim(),
    debtorEmail: document.getElementById('tp-debtor-email').value.trim(),
    debtorAddr: document.getElementById('tp-debtor-addr').value.trim(),
    cases: caseSnapshots(cases), totalAmt: totalAmt, date: document.getElementById('tp-date').value || todayISO(),
    createdAt: new Date().toISOString()
  };
}

/* PDF copy of the current form — does not re-save the record (that already
   happens on "Save & Download DRC-13"), so clicking both never duplicates
   the saved notice. */
function tpDownloadPDF() {
  var tp = tpBuildNotice();
  if (!tp) return;
  generateThirdPartyPDF(tp, getSettings());
}

function tpSaveAndDownload() {
  var tp = tpBuildNotice();
  if (!tp) return;
  AppState.thirdPartyNotices.push(tp);
  persist();
  renderThirdPartyList();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  buildThirdPartyDocx(tp, getSettings()).then(function (blob) { downloadBlob(blob, 'DRC13_' + tp.defaulterGstin + '_' + todayISO() + '.docx'); });
  showToast('✅ Third-party notice saved');
}

function renderThirdPartyList() {
  var wrap = document.getElementById('third-party-list');
  if (!wrap) return;
  if (!AppState.thirdPartyNotices.length) { wrap.innerHTML = '<div class="empty-sub">No third-party notices issued yet.</div>'; return; }
  var list = AppState.thirdPartyNotices.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Defaulter</th><th>Third Party</th><th>Amount</th></tr></thead><tbody>'
    + list.map(function (t) {
      return '<tr><td>' + fmtDate(t.date) + '</td><td>' + xe(taxpayerDisplayName(t.defaulterGstin, t.legalName)) + '<br><span class="gstin-cell">' + xe(t.defaulterGstin) + '</span></td>'
        + '<td>' + xe(t.debtorLegal) + '</td><td><div class="amount-cell pending">' + fmt(t.totalAmt) + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
}
