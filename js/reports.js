/* ===== Reports page — Top Arrear / Collectible / Non-Collectible ===== */

var _reportTab = 'top100';

function reportTab(tab, el) {
  _reportTab = tab;
  document.querySelectorAll('#page-cases .tab').forEach(function (t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderReports();
}

function renderReports() {
  var wrap = document.getElementById('report-table-wrap');
  var info = document.getElementById('report-tab-info');
  if (!wrap) return;

  var valid = AppState.cases.filter(isValidCase);
  if (!valid.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-chart-bar" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Data</div><div class="empty-sub">Import DCR files first</div></div>';
    if (info) info.style.display = 'none';
    return;
  }

  var all = computeGstinGroups().sort(function (a, b) { return b.total - a.total; });
  var hasReg = hasRegisterData();
  if (info) info.style.display = (_reportTab !== 'top100' && !hasReg) ? 'block' : 'none';

  var list;
  if (_reportTab === 'top100') {
    list = all.slice(0, 100);
  } else if (_reportTab === 'collectible') {
    list = all.filter(function (r) {
      var hasElig = r.eligibleCases.length > 0;
      var activeReg = !hasReg || isCollectible(r.gstin) === true;
      return hasElig && activeReg;
    }).sort(function (a, b) { return eligibleTotal(b) - eligibleTotal(a); }).slice(0, 100);
  } else {
    list = all.filter(function (r) {
      var noElig = r.eligibleCases.length === 0;
      var cancelledReg = hasReg && isCollectible(r.gstin) === false;
      return noElig || cancelledReg;
    }).slice(0, 100);
  }

  if (!list.length) {
    var msg = _reportTab === 'noncollectible' && !hasReg
      ? 'Load Taxpayer Register to classify non-collectible cases'
      : 'No cases in this category';
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-circle-check" style="font-size:40px;color:var(--green);opacity:0.5;"></i></div><div class="empty-title">' + msg + '</div></div>';
    return;
  }

  var rows = list.map(function (r, i) {
    var reg = AppState.addressCache[r.gstin];
    var regSt = reg && reg.regStatus ? reg.regStatus : '—';
    var pill = regSt === '—' ? '<span class="pill pill-gray">Unknown</span>'
      : (isCollectible(r.gstin) ? '<span class="pill pill-green">Active</span>' : '<span class="pill pill-red">' + xe(regSt) + '</span>');

    var dispAmt = _reportTab === 'collectible' ? eligibleTotal(r) : r.total;

    var excl = '';
    if (_reportTab === 'noncollectible') {
      var reasons = [];
      var nonRecov = r.cases.filter(function (c) { return !(c.recoveryStatus || '').includes('Recoverable'); });
      if (nonRecov.length === r.cases.length) reasons.push('Recovery: ' + (r.cases[0].recoveryStatus || 'Unknown'));
      var appealCase = r.ineligibleCases.find(function (c) { return Number(c.pend_total) > 0 && (c.recoveryStatus || '').includes('Recoverable'); });
      if (appealCase) { var reason = getExclusionReason(appealCase); if (reason) reasons.push('⚖️ ' + reason); }
      if (hasReg && isCollectible(r.gstin) === false) reasons.push('🚫 Reg: ' + regSt);
      if (reasons.length) excl = '<div style="font-size:10px;color:var(--orange);margin-top:2px;">' + xe(reasons.join(' · ')) + '</div>';
    }

    return '<tr>'
      + '<td style="font-family:var(--mono);font-size:12px;color:var(--ink3);">' + (i + 1) + '</td>'
      + '<td><div class="gstin-cell">' + xe(r.gstin) + '</div></td>'
      + '<td><div style="font-weight:600;font-size:12px;">' + xe(taxpayerDisplayName(r.gstin, r.legalName)) + '</div>' + excl + '</td>'
      + '<td style="text-align:center;"><span class="pill pill-blue" style="font-size:10px;">' + r.demands + '</span></td>'
      + '<td><div class="amount-cell pending">' + fmt(dispAmt) + '</div></td>'
      + '<td>' + pill + '</td>'
      + '<td><div style="display:flex;gap:4px;">'
      + '<button class="btn btn-red btn-xs" onclick="openNoticeModal(\'' + r.gstin + '\')"><i class="fa-solid fa-envelope-open-text"></i> Notice</button>'
      + '<button class="btn btn-orange btn-xs" onclick="nav(\'taxpayers\');document.getElementById(\'trp-gstin-input\').value=\'' + r.gstin + '\';loadRecoveryProfile();"><i class="fa-solid fa-user-shield"></i> Profile</button>'
      + '</div></td>'
      + '</tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table>'
    + '<thead><tr><th>#</th><th>GSTIN</th><th>Taxpayer</th><th>Demands</th><th>Total Arrear</th><th>Reg Status</th><th>Actions</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}
