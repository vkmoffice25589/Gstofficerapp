/* ===== Live Dashboard — every number computed from AppState, nothing hard-coded ===== */

var _dashboardFY = 'all';
var _dashChart = null;

function dashboardFilteredCases() {
  var valid = AppState.cases.filter(isValidCase);
  if (_dashboardFY === 'all') return valid;
  return valid.filter(function (c) { return c.fy === _dashboardFY; });
}

function dashboardFYOptions() {
  var valid = AppState.cases.filter(isValidCase);
  var fys = Array.from(new Set(valid.map(function (c) { return c.fy; }).filter(Boolean))).sort().reverse();
  return fys;
}

function refreshDashboard() { renderDashboard(); showToast('🔄 Dashboard refreshed'); }

function setDashboardFY(v) { _dashboardFY = v; renderDashboard(); }

function renderDashboard() {
  var root = document.getElementById('page-dashboard');
  if (!root) return;
  var settings = getSettings();

  document.getElementById('dash-office-name').textContent = settings.circle;
  document.getElementById('dash-office-division').textContent = settings.division;

  var fySel = document.getElementById('dash-fy-select');
  var fys = dashboardFYOptions();
  var prevVal = fySel.value || _dashboardFY;
  fySel.innerHTML = '<option value="all">All Financial Years</option>' + fys.map(function (fy) { return '<option value="' + xe(fy) + '">' + xe(fy) + '</option>'; }).join('');
  fySel.value = fys.includes(prevVal) || prevVal === 'all' ? prevVal : 'all';
  _dashboardFY = fySel.value;

  var validAll = AppState.cases.filter(isValidCase);
  var body = document.getElementById('dash-body');

  if (!validAll.length) {
    body.innerHTML =
      '<div class="dash-welcome"><div class="dash-welcome-icon"><i class="fa-solid fa-landmark"></i></div>'
      + '<div class="dash-welcome-title">Welcome to GST Recovery Management System</div>'
      + '<div class="dash-welcome-sub">No DCR data has been imported yet.</div>'
      + '<div class="dash-welcome-actions">'
      + '<button class="btn btn-red" onclick="nav(\'bulknotice\')"><i class="fa-solid fa-folder-open"></i> Import DCR</button>'
      + '<button class="btn btn-outline" onclick="nav(\'bulknotice\')"><i class="fa-solid fa-address-book"></i> Upload Taxpayer Register</button>'
      + '</div></div>';
    return;
  }

  var cases = dashboardFilteredCases();
  var groups = computeGstinGroups(cases);

  renderDashKPIs(cases, groups);
  body.innerHTML = dashBodyShell();
  renderDashChart(groups);
  renderDashActionRequired(cases, groups);
  renderDashTopTaxpayers(groups);
  renderDashActivity();
  renderDashDCRStatus(validAll);
}

function dashBodyShell() {
  return ''
    + '<div class="dash-grid">'
    + '  <div class="dash-card"><div class="dash-card-head"><div class="dash-card-title"><i class="fa-solid fa-chart-pie"></i>Recovery Status</div></div>'
    + '    <div class="dash-card-body"><div class="chart-wrap"><canvas id="dash-recovery-chart"></canvas></div><div id="dash-chart-legend" class="chart-legend"></div></div></div>'
    + '  <div class="dash-card"><div class="dash-card-head"><div class="dash-card-title"><i class="fa-solid fa-triangle-exclamation"></i>Action Required</div></div>'
    + '    <div class="dash-card-body"><div id="dash-action-list" class="action-list"></div></div></div>'
    + '</div>'
    + '<div class="dash-grid2">'
    + '  <div class="dash-card"><div class="dash-card-head"><div class="dash-card-title"><i class="fa-solid fa-ranking-star"></i>Top Taxpayers by Outstanding Arrear</div></div>'
    + '    <div class="dash-card-body" style="padding:0;"><div id="dash-top-taxpayers"></div></div></div>'
    + '  <div class="dash-card"><div class="dash-card-head"><div class="dash-card-title"><i class="fa-solid fa-clock-rotate-left"></i>Recent Recovery Activity</div></div>'
    + '    <div class="dash-card-body"><div id="dash-activity" class="activity-list"></div></div></div>'
    + '</div>'
    + '<div class="dash-grid3">'
    + '  <div class="dash-card"><div class="dash-card-head"><div class="dash-card-title"><i class="fa-solid fa-database"></i>DCR Data Status</div></div>'
    + '    <div class="dash-card-body"><div id="dash-dcr-status" class="dcr-status-grid"></div></div></div>'
    + '  <div class="dash-card"><div class="dash-card-head"><div class="dash-card-title"><i class="fa-solid fa-bolt"></i>Quick Actions</div></div>'
    + '    <div class="dash-card-body"><div class="quick-actions-grid">'
    + '      <div class="qa-btn" onclick="nav(\'bulknotice\')"><i class="fa-solid fa-folder-open"></i><span>Import DCR</span></div>'
    + '      <div class="qa-btn" onclick="nav(\'bulknotice\')"><i class="fa-solid fa-address-book"></i><span>Taxpayer Register</span></div>'
    + '      <div class="qa-btn" onclick="openNoticeModal()"><i class="fa-solid fa-envelope-open-text"></i><span>Issue Notice</span></div>'
    + '      <div class="qa-btn" onclick="nav(\'bulknotice\');bulkTab(\'all\', document.querySelector(\'#page-bulknotice .tab[data-tab=all]\'))"><i class="fa-solid fa-layer-group"></i><span>Bulk Notice</span></div>'
    + '      <div class="qa-btn" onclick="nav(\'cases\')"><i class="fa-solid fa-chart-bar"></i><span>Reports</span></div>'
    + '      <div class="qa-btn" onclick="nav(\'bulknotice\');bulkTab(\'bankatt\', document.querySelector(\'#page-bulknotice .tab[data-tab=bankatt]\'))"><i class="fa-solid fa-building-columns"></i><span>Bank Attachment</span></div>'
    + '    </div></div></div>'
    + '</div>';
}

function renderDashKPIs(cases, groups) {
  var grid = document.getElementById('dash-kpi-grid');
  var totalOutstanding = groups.reduce(function (s, g) { return s + g.total; }, 0);
  var recoverableGroups = groups.filter(function (g) { return g.eligibleCases.length > 0; });
  var recoverableAmt = recoverableGroups.reduce(function (s, g) { return s + eligibleTotal(g); }, 0);

  var noticesInScope = _dashboardFY === 'all' ? AppState.notices : AppState.notices.filter(function (n) { return (n.cases || []).some(function (c) { return c.fy === _dashboardFY; }); });
  var now = new Date();
  var thisMonth = noticesInScope.filter(function (n) {
    var d = new Date(n.createdAt || n.date);
    return !isNaN(d) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  var banksInScope = _dashboardFY === 'all' ? AppState.bankAtts : AppState.bankAtts.filter(function (b) { return (b.cases || []).some(function (c) { return c.fy === _dashboardFY; }); });
  var activeBanks = banksInScope.filter(function (b) { return !b.released; });
  var attachedAmt = activeBanks.reduce(function (s, b) { return s + (Number(b.totalAmt) || 0); }, 0);

  var recoveredFromRecon = AppState.reconciliationLog.filter(function (r) { return r.type === 'collection' || r.type === 'partial'; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
  var recoveredFromPayments = AppState.paymentRecords.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
  var recoveredTotal = recoveredFromRecon + recoveredFromPayments;

  grid.innerHTML =
    kpiCard('blue', 'fa-users', 'TOTAL TAXPAYERS', groups.length.toLocaleString('en-IN'), 'Taxpayers with valid DCR records', "nav('cases')")
    + kpiCard('red', 'fa-triangle-exclamation', 'TOTAL OUTSTANDING', fmt(totalOutstanding), 'Across ' + groups.length + ' taxpayers', "nav('cases')")
    + kpiCard('orange', 'fa-bolt', 'RECOVERABLE ARREAR', fmt(recoverableAmt), recoverableGroups.length + ' recoverable taxpayers', "nav('cases'); document.querySelector('#page-cases .tab[data-tab=collectible]').click();")
    + kpiCard('purple', 'fa-envelope-open-text', 'NOTICES ISSUED', noticesInScope.length.toLocaleString('en-IN'), thisMonth + ' this month', "nav('bulknotice')")
    + kpiCard('gold', 'fa-building-columns', 'BANK ATTACHMENTS', activeBanks.length.toLocaleString('en-IN'), fmt(attachedAmt) + ' attached', "nav('bulknotice'); bulkTab('bankatt', document.querySelector('#page-bulknotice .tab[data-tab=bankatt]'))")
    + kpiCard('green', 'fa-hand-holding-dollar', 'RECOVERY / COLLECTION', fmt(recoveredTotal), (recoveredFromRecon > 0 || recoveredFromPayments > 0) ? 'Recorded collections (demand ≠ recovered)' : (noticesInScope.length + ' notices · ' + activeBanks.length + ' bank · ' + AppState.thirdPartyNotices.length + ' third-party · ' + AppState.propertyAttachments.length + ' property actions'), "nav('taxpayers')");
}

function kpiCard(color, icon, label, value, sub, onclick) {
  return '<div class="kpi-card ' + color + '" onclick="' + onclick + '">'
    + '<div class="kpi-icon"><i class="fa-solid ' + icon + '"></i></div>'
    + '<div class="kpi-label">' + label + '</div>'
    + '<div class="kpi-value ' + color + '">' + value + '</div>'
    + '<div class="kpi-sub">' + xe(sub) + '</div>'
    + '</div>';
}

function renderDashChart(groups) {
  var recoverable = groups.filter(function (g) { return g.eligibleCases.length > 0; }).length;
  var noticeEligible = groups.filter(function (g) { return g.cases.some(isNoticeEligible); }).length;
  var noticeIssued = groups.filter(function (g) { return AppState.notices.some(function (n) { return n.gstin === g.gstin; }); }).length;
  var bankAttached = groups.filter(function (g) { return AppState.bankAtts.some(function (b) { return b.gstin === g.gstin && !b.released; }); }).length;
  var nonCollectible = groups.filter(function (g) { return classifyCollectibility(g) === 'noncollectible'; }).length;

  var data = [
    { label: 'Recoverable', value: recoverable, color: getComputedStyle(document.documentElement).getPropertyValue('--chart-recoverable').trim() },
    { label: 'Notice Eligible', value: noticeEligible, color: getComputedStyle(document.documentElement).getPropertyValue('--chart-eligible').trim() },
    { label: 'Notice Issued', value: noticeIssued, color: getComputedStyle(document.documentElement).getPropertyValue('--chart-issued').trim() },
    { label: 'Bank Attached', value: bankAttached, color: getComputedStyle(document.documentElement).getPropertyValue('--chart-attached').trim() },
    { label: 'Non-Collectible', value: nonCollectible, color: getComputedStyle(document.documentElement).getPropertyValue('--chart-noncollectible').trim() }
  ];

  var legend = document.getElementById('dash-chart-legend');
  legend.innerHTML = data.map(function (d) {
    return '<div class="chart-legend-item"><span class="chart-legend-dot" style="background:' + d.color + ';"></span>' + d.label + '<span class="chart-legend-count">' + d.value + '</span></div>';
  }).join('');

  var canvas = document.getElementById('dash-recovery-chart');
  if (!canvas || typeof Chart === 'undefined') {
    if (canvas) canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'empty-sub', textContent: 'Chart library unavailable — see legend for counts.' }));
    return;
  }
  if (_dashChart) _dashChart.destroy();
  _dashChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: data.map(function (d) { return d.label; }), datasets: [{ data: data.map(function (d) { return d.value; }), backgroundColor: data.map(function (d) { return d.color; }), borderRadius: 4, maxBarThickness: 26 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x + ' taxpayers'; } } } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,0.06)' } }, y: { grid: { display: false } } }
    }
  });
}

function renderDashActionRequired(cases, groups) {
  var el = document.getElementById('dash-action-list');
  var urgentGstins = new Set(cases.filter(isNoticeEligible).filter(function (c) { return isNoticeTypeMatch(c, 'urgent'); }).map(function (c) { return c.gstin; }));
  var intimGstins = new Set(cases.filter(isNoticeEligible).filter(function (c) { return isNoticeTypeMatch(c, 'intimation'); }).map(function (c) { return c.gstin; }));

  var bankEligibleGstins = new Set(cases.filter(isNoticeEligible).filter(function (c) { var age = getDemandAgeDays(c); return age === null || age >= 90; }).map(function (c) { return c.gstin; }));
  var alreadyAttached = new Set(AppState.bankAtts.filter(function (b) { return !b.released; }).map(function (b) { return b.gstin; }));
  var bankCandidates = Array.from(bankEligibleGstins).filter(function (g) { return !alreadyAttached.has(g); }).length;

  var withoutRegister = groups.filter(function (g) { return !AppState.addressCache[g.gstin]; }).length;

  var reviewGstins = new Set();
  cases.forEach(function (c) {
    if ((c.recoveryStatus || '').includes('Recoverable') && getExclusionReason(c)) reviewGstins.add(c.gstin);
  });

  var items = [
    { color: 'red', icon: 'fa-bolt', label: 'Urgent Notices Due', hint: '≥ 90 days, notice-eligible', count: urgentGstins.size, onclick: "nav('bulknotice');bulkTab('all', document.querySelector('#page-bulknotice .tab[data-tab=all]'))" },
    { color: 'orange', icon: 'fa-envelope', label: 'Intimation Notices Available', hint: '< 90 days, notice-eligible', count: intimGstins.size, onclick: "nav('bulknotice');bulkTab('notice', document.querySelector('#page-bulknotice .tab[data-tab=notice]'))" },
    { color: 'gold', icon: 'fa-building-columns', label: 'Bank Attachment Candidates', hint: '≥ 90 days, not yet attached', count: bankCandidates, onclick: "nav('bulknotice'); bulkTab('bankatt', document.querySelector('#page-bulknotice .tab[data-tab=bankatt]'))" },
    { color: 'purple', icon: 'fa-address-book', label: 'Taxpayers Without Register Details', hint: 'not found in Taxpayer Register', count: withoutRegister, onclick: "nav('bulknotice')" },
    { color: 'blue', icon: 'fa-magnifying-glass', label: 'Cases Requiring Review', hint: 'recoverable but parked at higher forum', count: reviewGstins.size, onclick: "nav('cases')" }
  ];

  el.innerHTML = items.map(function (it) {
    return '<div class="action-item" onclick="' + it.onclick + '">'
      + '<div class="action-dot ' + it.color + '"><i class="fa-solid ' + it.icon + '"></i></div>'
      + '<div><div class="action-label">' + it.label + '</div><div class="action-hint">' + it.hint + '</div></div>'
      + '<div class="action-count">' + it.count + '</div><div class="action-arrow"><i class="fa-solid fa-chevron-right"></i></div>'
      + '</div>';
  }).join('');
}

function renderDashTopTaxpayers(groups) {
  var wrap = document.getElementById('dash-top-taxpayers');
  var top = groups.slice().sort(function (a, b) { return b.total - a.total; }).slice(0, 10);
  if (!top.length) { wrap.innerHTML = '<div class="empty-sub" style="padding:16px;">No taxpayers in scope.</div>'; return; }

  var rows = top.map(function (g, i) {
    var status = g.eligibleCases.length > 0 ? recoveryPill('Recoverable') : recoveryPill(g.cases[0].recoveryStatus);
    return '<tr><td style="font-family:var(--mono);color:var(--ink3);">' + (i + 1) + '</td>'
      + '<td><div class="gstin-cell">' + xe(g.gstin) + '</div></td>'
      + '<td>' + xe(taxpayerDisplayName(g.gstin, g.legalName)) + '</td>'
      + '<td style="text-align:center;">' + g.demands + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(g.total) + '</div></td>'
      + '<td>' + status + '</td>'
      + '<td><button class="btn btn-outline btn-xs" onclick="nav(\'taxpayers\');document.getElementById(\'trp-gstin-input\').value=\'' + g.gstin + '\';loadRecoveryProfile();">View</button></td></tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>#</th><th>GSTIN</th><th>Taxpayer</th><th>Demands</th><th>Arrear</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderDashActivity() {
  var wrap = document.getElementById('dash-activity');
  var events = [];
  AppState.notices.forEach(function (n) { events.push({ date: n.createdAt, icon: 'fa-envelope-open-text', color: 'orange', title: (n.noticeKind === 'urgent' ? 'Urgent notice' : 'Intimation notice') + ' issued', gstin: n.gstin, name: n.legalName, amt: n.pendAmt }); });
  AppState.bankAtts.forEach(function (b) { events.push({ date: b.createdAt, icon: 'fa-building-columns', color: 'gold', title: 'Bank attachment created', gstin: b.gstin, name: b.legalName, amt: b.totalAmt });
    if (b.released) events.push({ date: b.releasedDate, icon: 'fa-unlock', color: 'green', title: 'Bank attachment released', gstin: b.gstin, name: b.legalName, amt: b.totalAmt }); });
  AppState.thirdPartyNotices.forEach(function (t) { events.push({ date: t.createdAt, icon: 'fa-user-group', color: 'purple', title: 'Third-party notice issued', gstin: t.defaulterGstin, name: t.legalName, amt: t.totalAmt }); });
  AppState.propertyAttachments.forEach(function (p) { events.push({ date: p.createdAt, icon: 'fa-house-lock', color: 'red', title: 'Property attached', gstin: p.gstin, name: p.legalName, amt: p.totalAmt }); });
  AppState.reconciliationLog.forEach(function (r) { events.push({ date: r.createdAt, icon: 'fa-rotate', color: 'blue', title: 'Demand status changed — ' + r.type, gstin: r.gstin, name: r.gstin, amt: r.amount }); });

  events.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
  events = events.slice(0, 8);

  if (!events.length) { wrap.innerHTML = '<div class="empty-sub">No recovery activity yet — issue a notice or attach a bank account to see it here.</div>'; return; }

  wrap.innerHTML = events.map(function (e) {
    return '<div class="activity-item"><div class="activity-icon action-dot ' + e.color + '" style="width:26px;height:26px;"><i class="fa-solid ' + e.icon + '" style="font-size:10px;"></i></div>'
      + '<div class="activity-body"><div class="activity-title">' + xe(e.title) + '</div><div class="activity-meta">' + xe(e.name || e.gstin) + ' · ' + fmtDate(e.date) + '</div></div>'
      + '<div class="activity-amt">' + fmt(e.amt) + '</div></div>';
  }).join('');
}

function renderDashDCRStatus(validAll) {
  var wrap = document.getElementById('dash-dcr-status');
  var uniqueGstins = new Set(validAll.map(function (c) { return c.gstin; })).size;
  var fys = Array.from(new Set(validAll.map(function (c) { return c.fy; }).filter(Boolean)));
  var latestDate = validAll.map(function (c) { return c.dcr_date; }).filter(Boolean).sort().slice(-1)[0];
  var regCount = Object.keys(AppState.addressCache).length;

  function item(label, val) { return '<div class="dcr-status-item"><div class="dcr-status-label">' + label + '</div><div class="dcr-status-val">' + val + '</div></div>'; }

  wrap.innerHTML =
    item('Total DCR Cases', AppState.cases.length)
    + item('Valid Cases', validAll.length)
    + item('Unique GSTINs', uniqueGstins)
    + item('Financial Years', fys.join(', ') || '—')
    + item('Latest DCR Date', fmtDate(latestDate))
    + item('Last Import', AppState.lastImportAt ? new Date(AppState.lastImportAt).toLocaleString('en-IN') : '—')
    + item('Taxpayer Register', hasRegisterData() ? '<span class="pill pill-green"><i class="fa-solid fa-check"></i> Loaded (' + regCount + ')</span>' : '<span class="pill pill-orange"><i class="fa-solid fa-triangle-exclamation"></i> Not Loaded</span>')
    + item('Last Register Update', AppState.lastRegisterImportAt ? new Date(AppState.lastRegisterImportAt).toLocaleString('en-IN') : '—');
}
