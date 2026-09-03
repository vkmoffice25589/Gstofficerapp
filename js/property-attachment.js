/* ===== Property Attachment — Section 79(1)(d) (new feature, no legacy logic to preserve) ===== */

var _paDefaulterGSTIN = null;

function paSearchDefaulter(query) {
  var resultsEl = document.getElementById('pa-defaulter-results');
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
    ? matches.map(function (c) { return '<div class="gs-item" onclick="paSelectDefaulter(\'' + c.gstin + '\')"><strong>' + xe(c.legalName) + '</strong><br><span style="color:var(--ink3);font-family:var(--mono);font-size:10px;">' + c.gstin + '</span></div>'; }).join('')
    : '<div class="gs-item">No matches</div>';
  resultsEl.style.display = 'block';
}

function paSelectDefaulter(gstin) {
  _paDefaulterGSTIN = gstin;
  var c0 = AppState.cases.find(function (c) { return c.gstin === gstin; });
  document.getElementById('pa-defaulter-search').value = c0 ? c0.legalName : gstin;
  document.getElementById('pa-defaulter-results').style.display = 'none';
  document.getElementById('pa-defaulter-gstin').value = gstin;

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; }).filter(isNoticeEligible);
  var wrap = document.getElementById('pa-defaulter-demands');
  if (!cases.length) { wrap.innerHTML = '<div class="empty-sub">No eligible demands for this defaulter.</div>'; return; }
  var rows = cases.map(function (c) {
    return '<tr><td><input type="checkbox" class="pa-case-chk" data-demand="' + xe(c.demandId) + '" checked></td>'
      + '<td class="demand-id">' + xe(c.demandId) + '</td><td>' + xe(c.taxPeriod) + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td></tr>';
  }).join('');
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th></th><th>Demand ID</th><th>Tax Period</th><th>Pending</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function paSelectedCases() {
  var checked = Array.from(document.querySelectorAll('.pa-case-chk:checked')).map(function (el) { return el.getAttribute('data-demand'); });
  return AppState.cases.filter(function (c) { return c.gstin === _paDefaulterGSTIN && checked.includes(c.demandId); });
}

function paBuildRecord() {
  if (!_paDefaulterGSTIN) { showToast('⚠️ Select a defaulter taxpayer first'); return null; }
  var cases = paSelectedCases();
  if (!cases.length) { showToast('⚠️ Select at least one demand'); return null; }
  var desc = document.getElementById('pa-property-description').value.trim();
  if (!desc) { showToast('⚠️ Enter a property description'); return null; }
  var c0 = cases[0];
  var totalAmt = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);

  return {
    id: uid('prop'), gstin: _paDefaulterGSTIN, legalName: c0.legalName, cases: cases, totalAmt: totalAmt,
    propertyDescription: desc,
    propertyLocation: document.getElementById('pa-property-location').value.trim(),
    propertyValue: parseFloat(document.getElementById('pa-property-value').value) || 0,
    officer: document.getElementById('pa-officer').value.trim(),
    date: document.getElementById('pa-date').value || todayISO(),
    createdAt: new Date().toISOString()
  };
}

function paSaveAndDownload() {
  var pa = paBuildRecord();
  if (!pa) return;
  AppState.propertyAttachments.push(pa);
  persist();
  renderPropertyList();
  updateSidebar();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  buildPropertyAttachmentDocx(pa, getSettings()).then(function (blob) { downloadBlob(blob, 'PropertyAttachment_' + pa.gstin + '_' + todayISO() + '.docx'); });
  showToast('✅ Property attachment recorded');
}

function renderPropertyList() {
  var wrap = document.getElementById('property-list');
  if (!wrap) return;
  if (!AppState.propertyAttachments.length) { wrap.innerHTML = '<div class="empty-sub">No property attachments recorded yet.</div>'; return; }
  var list = AppState.propertyAttachments.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Taxpayer</th><th>Property</th><th>Value</th><th>Demand Amount</th></tr></thead><tbody>'
    + list.map(function (p) {
      return '<tr><td>' + fmtDate(p.date) + '</td><td>' + xe(p.legalName) + '<br><span class="gstin-cell">' + xe(p.gstin) + '</span></td>'
        + '<td>' + xe(p.propertyDescription) + '</td><td>' + fmt(p.propertyValue) + '</td><td><div class="amount-cell pending">' + fmt(p.totalAmt) + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
}
