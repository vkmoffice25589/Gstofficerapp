/* ===== Arrear Action Register — auto-populated case-history rollup =====
   NOT a second place to log notices/bank attachments/third-party notices/
   property actions, and NOT a second taxpayer database. The case list is
   auto-derived from the taxpayers already in the DCR (the same data the
   Generate Arrear Notice module reads via computeGstinGroups) plus any
   GSTIN with a footprint in the Notice/Bank/Third-Party/Property/Recovery
   modules. There is no "Add Case" step.

   For Notice/Bank/Third-Party/Property, each list cell shows the latest
   record pulled LIVE from that module. Two small buttons per cell:
     + = record something missing (a real-world action taken outside this
         app, e.g. a notice served on paper) — writes a manual metadata
         entry here ONLY. It never generates a real notice/attachment.
     📋 = view the complete history for that action type (module + manual).
   Recovery / Follow-up / Remarks remain the only fully-manual concepts,
   since nothing else in the app owns them. */

var AR_STAGE_LABELS = { notice: 'Notice Issued', bank: 'Bank Attachment', thirdparty: 'Third Party Notice', property: 'Property Action', followup: 'Follow-up' };
var AR_TIMELINE_ICONS = { notice: 'fa-envelope-open-text', bank: 'fa-building-columns', thirdparty: 'fa-user-group', property: 'fa-house-lock', recovery: 'fa-hand-holding-dollar', followup: 'fa-bell', remark: 'fa-note-sticky' };

/* Manual-entry configs. notice/bank/thirdparty/property here are ONLY for
   recording a real-world action the source module doesn't know about —
   they are merged into that module's own records for display, never used
   to generate a real notice/attachment. */
var AR_ACTION_TYPES = {
  notice: { label: 'Notice', statuses: ['Issued', 'Served', 'Acknowledged', 'Returned', 'No Response'], refLabel: 'Notice No. / Reference', fields: ['date', 'status', 'amount', 'reference', 'remarks'] },
  bank: { label: 'Bank Attachment', statuses: ['Attached', 'Partially Released', 'Released', 'No Funds Available', 'Dormant Account'], refLabel: 'Bank & Account No.', fields: ['date', 'status', 'amount', 'reference', 'remarks'] },
  thirdparty: { label: 'Third Party', statuses: ['Notice Issued', 'Acknowledged', 'Amount Received', 'No Response', 'Closed'], refLabel: 'Third Party Name', fields: ['date', 'status', 'amount', 'reference', 'remarks'] },
  property: { label: 'Property Action', statuses: ['Identified', 'Attached', 'Auction Initiated', 'Released', 'Sold'], refLabel: 'Property Description', fields: ['date', 'status', 'amount', 'reference', 'remarks'] },
  followup: { label: 'Follow-up', statuses: ['Pending', 'Contacted', 'Reminder Sent', 'Escalated', 'Resolved'], fields: ['date', 'status', 'remarks', 'nextActionDate', 'nextActionNote'] },
  remark: { label: 'Remark', statuses: [], fields: ['date', 'remarks'] }
};

var _arCurrentGstin = null;
var _arActiveDrawerTab = 'history';
var _arQuickAddType = null;
var _arEditingActionId = null;
var _arTimelineFilterType = null;
var _arPage = 1;
var _arPageSize = 10;

/* ---------- Data helpers — indexed by GSTIN once per render, O(1) per row ----------
   arSummary() runs once per taxpayer, and a DCR can hold thousands of them.
   Filtering the full notices/bankAtts/etc. arrays (or recomputing
   computeGstinGroups) inside a per-row function turns one render into an
   O(n²) scan — that's what was freezing the browser. Instead, build a
   {GSTIN: [...]} index of every source array ONCE per render pass, and have
   every per-row lookup below just read from it. */

var _arIdx = null;

function arInvalidateIndexes() { _arIdx = null; }

function arIndexBy(list, keyFn) {
  var idx = {};
  list.forEach(function (item) {
    var k = keyFn(item);
    if (!k) return;
    k = String(k).trim().toUpperCase();
    if (!idx[k]) idx[k] = [];
    idx[k].push(item);
  });
  return idx;
}

function arEnsureIndexes() {
  if (_arIdx) return;
  var groups = (typeof computeGstinGroups === 'function') ? computeGstinGroups(AppState.cases) : [];
  var groupByGstin = {};
  groups.forEach(function (g) { if (g.gstin) groupByGstin[String(g.gstin).trim().toUpperCase()] = g; });

  _arIdx = {
    groupsList: groups,
    groupByGstin: groupByGstin,
    noticesByGstin: arIndexBy(AppState.notices, function (n) { return n.gstin; }),
    bankByGstin: arIndexBy(AppState.bankAtts, function (b) { return b.gstin; }),
    tpByGstin: arIndexBy(AppState.thirdPartyNotices, function (t) { return t.defaulterGstin; }),
    propByGstin: arIndexBy(AppState.propertyAttachments, function (p) { return p.gstin; }),
    reconByGstin: arIndexBy(AppState.reconciliationLog, function (r) { return r.gstin; }),
    payByGstin: arIndexBy(AppState.paymentRecords, function (p) { return p.gstin; }),
    actionsByGstin: arIndexBy(AppState.arrearActions, function (a) { return a.gstin; })
  };
}

/* computeGstinGroups() is the exact same function Reports/Dashboard/Bulk
   Notice use, so this must never drift out of sync with what they show. */
function arGroups() { arEnsureIndexes(); return _arIdx.groupsList; }

function arGetGroup(gstin) {
  arEnsureIndexes();
  return _arIdx.groupByGstin[String(gstin || '').trim().toUpperCase()] || null;
}

/* The register's case universe = exactly the DCR's arrear taxpayers (the
   same set Bulk Notice/Reports show) — nothing more, nothing less. A GSTIN
   with a Notice/Bank/Third-Party/Property record but no current DCR demand
   (e.g. the demand was later reconciled away) will not appear here, same
   as it wouldn't in Bulk Notice. */
function arRosterGstins() {
  return arGroups().map(function (g) { return String(g.gstin || '').trim().toUpperCase(); }).filter(Boolean);
}

function arGetTraderName(gstin) {
  var gu = String(gstin || '').trim().toUpperCase();
  var addr = AppState.addressCache[gstin] || AppState.addressCache[gu];
  if (addr && (addr.tradeName || addr.legalName)) return addr.tradeName || addr.legalName;
  var g = arGetGroup(gstin);
  if (g && g.legalName) return g.legalName;
  return '';
}

/* ---------- Live event pull — module records merged with manual "missing info" entries ---------- */

function arNoticeEvents(gstin) {
  arEnsureIndexes();
  var gu = String(gstin || '').trim().toUpperCase();
  var fromModule = (_arIdx.noticesByGstin[gu] || [])
    .map(function (n) { return { id: n.id, date: n.date || n.createdAt, amount: n.pendAmt, reference: n.num, status: n.noticeKind === 'urgent' ? 'Urgent' : 'Intimation', source: 'module' }; });
  var manual = arActionsFor(gu).filter(function (a) { return a.type === 'notice'; })
    .map(function (a) { return { id: a.id, date: a.date, amount: a.amount, reference: a.reference, status: a.status, remarks: a.remarks, source: 'manual' }; });
  return fromModule.concat(manual).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
}
function arBankEvents(gstin) {
  arEnsureIndexes();
  var gu = String(gstin || '').trim().toUpperCase();
  var fromModule = (_arIdx.bankByGstin[gu] || [])
    .map(function (b) { return { id: b.id, date: b.date || b.createdAt, amount: b.totalAmt, reference: b.bankName + (b.accno ? ' • A/c ' + b.accno : ''), status: b.released ? 'Released' : 'Active', source: 'module' }; });
  var manual = arActionsFor(gu).filter(function (a) { return a.type === 'bank'; })
    .map(function (a) { return { id: a.id, date: a.date, amount: a.amount, reference: a.reference, status: a.status, remarks: a.remarks, source: 'manual' }; });
  return fromModule.concat(manual).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
}
function arThirdPartyEvents(gstin) {
  arEnsureIndexes();
  var gu = String(gstin || '').trim().toUpperCase();
  var fromModule = (_arIdx.tpByGstin[gu] || [])
    .map(function (t) { return { id: t.id, date: t.date || t.createdAt, amount: t.totalAmt, reference: t.debtorTrade || t.debtorLegal, status: 'Issued', source: 'module' }; });
  var manual = arActionsFor(gu).filter(function (a) { return a.type === 'thirdparty'; })
    .map(function (a) { return { id: a.id, date: a.date, amount: a.amount, reference: a.reference, status: a.status, remarks: a.remarks, source: 'manual' }; });
  return fromModule.concat(manual).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
}
function arPropertyEvents(gstin) {
  arEnsureIndexes();
  var gu = String(gstin || '').trim().toUpperCase();
  var fromModule = (_arIdx.propByGstin[gu] || [])
    .map(function (p) { return { id: p.id, date: p.date || p.createdAt, amount: p.propertyValue || p.totalAmt, reference: p.propertyDescription, status: 'Recorded', source: 'module' }; });
  var manual = arActionsFor(gu).filter(function (a) { return a.type === 'property'; })
    .map(function (a) { return { id: a.id, date: a.date, amount: a.amount, reference: a.reference, status: a.status, remarks: a.remarks, source: 'manual' }; });
  return fromModule.concat(manual).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
}
/* Recovery = auto-detected DCR reconciliation (collection/partial) + manual payment records —
   the exact same formula dashboard.js and recovery-profile.js already use. */
function arRecoveryEvents(gstin) {
  arEnsureIndexes();
  var gu = String(gstin || '').trim().toUpperCase();
  var auto = (_arIdx.reconByGstin[gu] || []).filter(function (r) { return r.type === 'collection' || r.type === 'partial'; })
    .map(function (r) { return { id: r.id, date: r.date || r.createdAt, amount: r.amount, reference: r.remarks || 'Auto-detected from DCR reconciliation', status: r.type === 'collection' ? 'Full Payment' : 'Partial Payment', source: 'auto' }; });
  var manual = (_arIdx.payByGstin[gu] || [])
    .map(function (p) { return { id: p.id, date: p.date || p.createdAt, amount: p.amount, reference: p.remarks || p.mode || 'Manually recorded', status: 'Recorded', source: 'manual' }; });
  return auto.concat(manual).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
}
function arActionsFor(gstin) {
  arEnsureIndexes();
  var gu = String(gstin || '').trim().toUpperCase();
  return (_arIdx.actionsByGstin[gu] || [])
    .slice()
    .sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''); });
}

function arStatusBadge(s) {
  if (s.arrear > 0 && s.balance <= 0) return { label: 'Fully Recovered', cls: 'green' };
  if (s.recovered > 0) return { label: 'Partly Recovered', cls: 'gold' };
  var stageMap = {
    notice: { label: 'Notice Issued', cls: 'red' }, bank: { label: 'Bank Action', cls: 'gold' },
    thirdparty: { label: 'Third Party', cls: 'purple' }, property: { label: 'Property Action', cls: 'blue' },
    followup: { label: 'Follow-up', cls: 'teal' }
  };
  if (s.lastAction && stageMap[s.lastAction.type]) return stageMap[s.lastAction.type];
  return { label: 'Pending', cls: 'gray' };
}

function arSummary(gstin) {
  var gu = String(gstin || '').trim().toUpperCase();
  var g = arGetGroup(gu);
  var arrear = g ? g.total : 0;

  var noticeEv = arNoticeEvents(gu), bankEv = arBankEvents(gu), tpEv = arThirdPartyEvents(gu), propEv = arPropertyEvents(gu), recEv = arRecoveryEvents(gu);
  var followupEv = arActionsFor(gu).filter(function (a) { return a.type === 'followup'; });
  var remarkCount = arActionsFor(gu).filter(function (a) { return a.type === 'remark'; }).length;

  var recovered = recEv.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
  var balance = arrear - recovered;

  var pool = []
    .concat(noticeEv.map(function (e) { return { type: 'notice', date: e.date }; }))
    .concat(bankEv.map(function (e) { return { type: 'bank', date: e.date }; }))
    .concat(tpEv.map(function (e) { return { type: 'thirdparty', date: e.date }; }))
    .concat(propEv.map(function (e) { return { type: 'property', date: e.date }; }))
    .concat(followupEv.map(function (a) { return { type: 'followup', date: a.date }; }));
  pool.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  var lastAction = pool.length ? pool[0] : null;

  var latestFollowup = followupEv.length ? followupEv.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })[0] : null;
  var nextAction = (latestFollowup && latestFollowup.nextActionDate) ? { date: latestFollowup.nextActionDate, note: latestFollowup.nextActionNote || '' } : null;
  var overdue = !!(nextAction && nextAction.date < todayISO());

  var reg = AppState.arrearRegister.find(function (r) { return String(r.gstin || '').trim().toUpperCase() === gu; });
  var closed = !!(reg && reg.closed);
  var status = arStatusBadge({ arrear: arrear, recovered: recovered, balance: balance, lastAction: lastAction });

  return {
    gstin: gu, traderName: arGetTraderName(gu), arrear: arrear, recovered: recovered, balance: balance,
    lastAction: lastAction, nextAction: nextAction, overdue: overdue, status: status, closed: closed,
    noticeEv: noticeEv, bankEv: bankEv, tpEv: tpEv, propEv: propEv,
    counts: { notice: noticeEv.length, bank: bankEv.length, thirdparty: tpEv.length, property: propEv.length, recovery: recEv.length, followup: followupEv.length, remark: remarkCount }
  };
}

function arStatusPillClass(status) {
  status = (status || '').toLowerCase();
  if (!status) return 'gray';
  if (/received|resolved|sold|released|full payment|closed|acknowledged/.test(status)) return 'green';
  if (/no response|no funds|written-off|escalated|returned/.test(status)) return 'red';
  if (/pending|identified|issued|attached|partial/.test(status)) return 'gold';
  return 'gray';
}
/* Per-type colouring that matches each source module's own convention. */
function arEventStatusCls(type, status) {
  if (type === 'notice') return status === 'Urgent' ? 'red' : 'orange';
  if (type === 'bank') return status === 'Released' ? 'green' : 'blue';
  if (type === 'thirdparty') return 'purple';
  if (type === 'property') return 'blue';
  return arStatusPillClass(status);
}

/* ---------- KPI strip ---------- */

function arComputeKPIs(summaries) {
  return {
    totalCases: summaries.length,
    noticeCount: summaries.reduce(function (s, x) { return s + x.counts.notice; }, 0),
    bankCount: summaries.reduce(function (s, x) { return s + x.counts.bank; }, 0),
    tpCount: summaries.reduce(function (s, x) { return s + x.counts.thirdparty; }, 0),
    propCount: summaries.reduce(function (s, x) { return s + x.counts.property; }, 0),
    recoveryCount: summaries.reduce(function (s, x) { return s + x.counts.recovery; }, 0),
    totalRecovered: summaries.reduce(function (s, x) { return s + x.recovered; }, 0),
    balanceArrear: summaries.reduce(function (s, x) { return s + Math.max(x.balance, 0); }, 0)
  };
}

function renderArKPIs(summaries) {
  var wrap = document.getElementById('ar-kpi-grid');
  if (!wrap) return;
  var k = arComputeKPIs(summaries);
  var tiles = [
    { icon: 'fa-folder', label: 'Total Cases', val: k.totalCases, cls: 'blue' },
    { icon: 'fa-triangle-exclamation', label: 'Notice Issued', val: k.noticeCount, cls: 'red' },
    { icon: 'fa-building-columns', label: 'Bank Attachment', val: k.bankCount, cls: 'gold' },
    { icon: 'fa-user-group', label: 'Third Party', val: k.tpCount, cls: 'purple' },
    { icon: 'fa-house-lock', label: 'Property Action', val: k.propCount, cls: 'blue' },
    { icon: 'fa-indian-rupee-sign', label: 'Total Recovered', val: fmt(k.totalRecovered), cls: 'green' },
    { icon: 'fa-scale-balanced', label: 'Balance Arrear', val: fmt(k.balanceArrear), cls: 'amber', hero: true }
  ];
  wrap.innerHTML = tiles.map(function (t) {
    return '<div class="ar-kpi-tile' + (t.hero ? ' ar-kpi-hero' : '') + '">'
      + '<div class="ar-kpi-icon kpi-' + t.cls + '"><i class="fa-solid ' + t.icon + '"></i></div>'
      + '<div><div class="ar-kpi-val">' + t.val + '</div><div class="ar-kpi-label">' + xe(t.label) + '</div></div>'
      + '</div>';
  }).join('');
}

/* ---------- Case list (filters, pagination) ---------- */

function arApplyFilters() { _arPage = 1; renderArrearActionList(); }

function arResetFilters() {
  var f = document.getElementById('ar-filter'); if (f) f.value = '';
  var sf = document.getElementById('ar-status-filter'); if (sf) sf.value = '';
  var af = document.getElementById('ar-action-filter'); if (af) af.value = '';
  var fd = document.getElementById('ar-from-date'); if (fd) fd.value = '';
  var td = document.getElementById('ar-to-date'); if (td) td.value = '';
  _arPage = 1;
  renderArrearActionList();
}

function renderArrearActionList() {
  arInvalidateIndexes();
  var allGstins = arRosterGstins();
  var summaries = allGstins.map(arSummary);

  renderArKPIs(summaries);
  arRenderUpcoming(summaries);
  arRenderSummaryChart(summaries);

  var wrap = document.getElementById('ar-table-wrap');
  if (!wrap) return;

  var q = (document.getElementById('ar-filter').value || '').trim().toUpperCase();
  var statusFilter = document.getElementById('ar-status-filter').value;
  var actionFilter = document.getElementById('ar-action-filter').value;
  var fromDate = document.getElementById('ar-from-date').value;
  var toDate = document.getElementById('ar-to-date').value;

  var filtered = summaries.filter(function (s) {
    if (q && s.gstin.indexOf(q) === -1 && (s.traderName || '').toUpperCase().indexOf(q) === -1) return false;
    if (statusFilter === 'fully' && !(s.arrear > 0 && s.balance <= 0)) return false;
    if (statusFilter === 'partly' && !(s.recovered > 0 && s.balance > 0)) return false;
    if (statusFilter === 'pending' && !(s.recovered <= 0 && !(s.arrear > 0 && s.balance <= 0))) return false;
    if (actionFilter === 'none' && s.lastAction) return false;
    if (actionFilter && actionFilter !== 'none' && (!s.lastAction || s.lastAction.type !== actionFilter)) return false;
    if (fromDate && (!s.lastAction || s.lastAction.date < fromDate)) return false;
    if (toDate && (!s.lastAction || s.lastAction.date > toDate)) return false;
    return true;
  });

  filtered.sort(function (a, b) {
    var ao = a.overdue ? 0 : 1, bo = b.overdue ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return b.arrear - a.arrear;
  });

  var countEl = document.getElementById('ar-list-count');
  if (countEl) countEl.textContent = filtered.length;

  var pagerBar = document.getElementById('ar-pagination-bar');

  if (!allGstins.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-folder-tree" style="font-size:36px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Arrear Taxpayers Found</div><div class="empty-sub">Upload a DCR under "Generate Arrear Notice" — every taxpayer with arrear will appear here automatically.</div></div>';
    if (pagerBar) pagerBar.innerHTML = '';
    return;
  }
  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">No matches</div><div class="empty-sub">Try clearing filters.</div></div>';
    if (pagerBar) pagerBar.innerHTML = '';
    return;
  }

  var totalPages = Math.max(1, Math.ceil(filtered.length / _arPageSize));
  if (_arPage > totalPages) _arPage = totalPages;
  var startIdx = (_arPage - 1) * _arPageSize;
  var pageRows = filtered.slice(startIdx, startIdx + _arPageSize);

  var rows = pageRows.map(function (s, i) {
    return '<tr class="ar-case-row" onclick="arOpenDrawer(\'' + s.gstin + '\')">'
      + '<td style="color:var(--ink3);">' + (startIdx + i + 1) + '</td>'
      + '<td><span class="gstin-cell">' + xe(s.gstin) + '</span></td>'
      + '<td>' + xe(s.traderName || '—') + '</td>'
      + '<td><div class="amount-cell">' + fmt(s.arrear) + '</div></td>'
      + '<td>' + arActionStatusBlockHTML(s) + '</td>'
      + '<td><span class="pill pill-' + s.status.cls + '">' + xe(s.status.label) + '</span></td>'
      + '</tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr>'
    + '<th>Sl.No</th><th>GSTIN</th><th>Trader Name</th><th>Total Arrear (₹)</th><th>Action Status</th>'
    + '<th>Status</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  if (pagerBar) {
    pagerBar.innerHTML = '<div class="ar-pagination-note">Showing ' + (startIdx + 1) + ' to ' + Math.min(startIdx + _arPageSize, filtered.length) + ' of ' + filtered.length + ' cases</div>'
      + '<div class="ar-pagination" id="ar-pagination"></div>';
    renderArPagination(totalPages);
  }
}

/* Action Status block: one compact row per stage (Notice/Bank/Third Party/
   Property) instead of four separate table columns — an officer reads a
   single cell top-to-bottom and immediately sees where a case stands,
   with no horizontal scrolling needed. Each row keeps the same + (record
   missing info) / 📋 (view history) buttons the old per-column cells had —
   only the layout changed, not what the buttons do. */
var AR_STATUS_ROWS = [
  { type: 'notice', label: 'Notice' },
  { type: 'bank', label: 'Bank' },
  { type: 'thirdparty', label: 'Third Party' },
  { type: 'property', label: 'Property' }
];

function arActionStatusBlockHTML(s) {
  var eventsByType = { notice: s.noticeEv, bank: s.bankEv, thirdparty: s.tpEv, property: s.propEv };
  var rows = AR_STATUS_ROWS.map(function (row) {
    return arStatusRowHTML(s.gstin, row.type, row.label, eventsByType[row.type]);
  }).join('');
  return '<div class="ar-status-grid">' + rows + '</div>';
}

function arStatusRowHTML(gstin, type, label, events) {
  var has = events && events.length;
  var dotCls = has ? arEventStatusCls(type, events[0].status) : 'none';
  var valueHtml = has
    ? ('<span class="ar-status-value">' + xe(events[0].status) + ' <span class="ar-status-sep">·</span> ' + fmtDateShort(events[0].date) + '</span>')
    : '<span class="ar-status-value ar-status-muted">Not Started</span>';
  return '<div class="ar-status-row">'
    + '<div class="ar-status-info"><span class="ar-status-dot dot-' + dotCls + '"></span><span class="ar-status-label">' + xe(label) + '</span>' + valueHtml + '</div>'
    + '<div class="ar-cell-btns">'
    + '<button type="button" class="ar-mini-btn" title="Record missing info" onclick="event.stopPropagation();arQuickRecord(\'' + gstin + '\',\'' + type + '\')"><i class="fa-solid fa-plus"></i></button>'
    + '<button type="button" class="ar-mini-btn" title="View history" onclick="event.stopPropagation();arQuickHistory(\'' + gstin + '\',\'' + type + '\')"><i class="fa-solid fa-clipboard-list"></i></button>'
    + '</div></div>';
}

function renderArPagination(totalPages) {
  var el = document.getElementById('ar-pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  var buttons = [];
  buttons.push('<button class="ar-page-btn" ' + (_arPage === 1 ? 'disabled' : '') + ' onclick="arGoToPage(' + (_arPage - 1) + ')"><i class="fa-solid fa-chevron-left"></i></button>');

  var pages = [];
  for (var p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - _arPage) <= 1) pages.push(p);
  }
  var lastAdded = 0;
  pages.forEach(function (p) {
    if (lastAdded && p - lastAdded > 1) buttons.push('<span class="ar-page-ellipsis">…</span>');
    buttons.push('<button class="ar-page-btn' + (p === _arPage ? ' active' : '') + '" onclick="arGoToPage(' + p + ')">' + p + '</button>');
    lastAdded = p;
  });

  buttons.push('<button class="ar-page-btn" ' + (_arPage === totalPages ? 'disabled' : '') + ' onclick="arGoToPage(' + (_arPage + 1) + ')"><i class="fa-solid fa-chevron-right"></i></button>');
  el.innerHTML = buttons.join('');
}

function arGoToPage(p) { _arPage = p; renderArrearActionList(); }

/* ---------- Upcoming Actions panel ---------- */

function arRenderUpcoming(summaries) {
  var wrap = document.getElementById('ar-upcoming-wrap');
  var countEl = document.getElementById('ar-upcoming-count');
  if (!wrap) return;

  var due = summaries.filter(function (s) { return s.nextAction; }).sort(function (a, b) { return a.nextAction.date.localeCompare(b.nextAction.date); });
  if (countEl) countEl.textContent = due.length;

  if (!due.length) {
    wrap.innerHTML = '<div class="empty" style="padding:26px;"><div class="empty-sub">No upcoming follow-ups scheduled.</div></div>';
    return;
  }
  var today = todayISO();
  var rows = due.slice(0, 25).map(function (s) {
    var overdue = s.nextAction.date < today;
    return '<tr class="ar-case-row" onclick="arOpenDrawer(\'' + s.gstin + '\')">'
      + '<td style="' + (overdue ? 'color:var(--red);font-weight:700;' : '') + '">' + fmtDateShort(s.nextAction.date) + '</td>'
      + '<td class="gstin-cell">' + xe(s.gstin) + '</td>'
      + '<td>' + xe(s.traderName || '—') + '</td>'
      + '<td>Follow-up</td>'
      + '<td>' + xe(s.nextAction.note || '—') + '</td>'
      + '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th><th>GSTIN</th><th>Trader Name</th><th>Action</th><th>Remarks</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/* ---------- Action Summary chart (dependency-free CSS bars) ---------- */

function arRenderSummaryChart(summaries) {
  var wrap = document.getElementById('ar-summary-chart');
  if (!wrap) return;
  var k = arComputeKPIs(summaries);
  var bars = [
    { label: 'Notice', val: k.noticeCount, color: 'var(--danger)' },
    { label: 'Bank', val: k.bankCount, color: 'var(--gold)' },
    { label: 'Third Party', val: k.tpCount, color: 'var(--purple)' },
    { label: 'Property', val: k.propCount, color: 'var(--primary-blue)' },
    { label: 'Recovery', val: k.recoveryCount, color: 'var(--success)' }
  ];
  var max = Math.max.apply(null, bars.map(function (b) { return b.val; }).concat([1]));
  wrap.innerHTML = bars.map(function (b) {
    var pct = Math.round((b.val / max) * 100);
    return '<div class="ar-summary-bar-wrap"><div class="ar-summary-bar-val">' + b.val + '</div><div class="ar-summary-bar" style="height:' + Math.max(pct, 4) + '%;background:' + b.color + ';"></div><div class="ar-summary-bar-label">' + b.label + '</div></div>';
  }).join('');
}

/* ---------- Export ---------- */

function arExportCSV() {
  var summaries = arRosterGstins().map(arSummary);
  var rows = [['Sl.No', 'GSTIN', 'Trader Name', 'Total Arrear', 'Total Recovered', 'Balance', 'Last Action', 'Last Action Date', 'Next Action Date', 'Status']];
  summaries.forEach(function (s, i) {
    rows.push([i + 1, s.gstin, s.traderName, s.arrear, s.recovered, s.balance, s.lastAction ? (AR_STAGE_LABELS[s.lastAction.type] || s.lastAction.type) : '', s.lastAction ? s.lastAction.date : '', s.nextAction ? s.nextAction.date : '', s.status.label]);
  });
  var csv = rows.map(function (r) {
    return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Arrear_Action_Register_' + todayISO() + '.csv';
  a.click();
  showToast('⬇️ Exported ' + summaries.length + ' case(s)');
}

/* ---------- Case-level "closed" flag (informational only — never gates listing) ---------- */

function arToggleCaseStatus(gstin) {
  var gu = String(gstin || '').trim().toUpperCase();
  var reg = AppState.arrearRegister.find(function (r) { return String(r.gstin || '').trim().toUpperCase() === gu; });
  if (!reg) {
    reg = { id: uid('arreg'), gstin: gu, closed: false, addedAt: new Date().toISOString() };
    AppState.arrearRegister.push(reg);
  }
  reg.closed = !reg.closed;
  persist();
  arRenderDrawer();
  showToast(reg.closed ? '📁 Case marked closed' : '📂 Case reopened');
}

/* ---------- Cross-links into the real modules (View DCR only — Notice/Bank/etc. are never auto-generated from here) ---------- */

function arViewDCR(gstin) {
  nav('taxpayers');
  var input = document.getElementById('trp-gstin-input');
  if (input) input.value = gstin;
  if (typeof loadRecoveryProfile === 'function') loadRecoveryProfile();
}

/* ---------- Quick actions from the list cells ---------- */

function arQuickRecord(gstin, type) {
  arOpenDrawer(gstin);
  _arTimelineFilterType = null;
  arOpenQuickAdd(type);
}
function arQuickHistory(gstin, type) {
  arOpenDrawer(gstin);
  _arTimelineFilterType = type;
  arRenderActionHistoryTab(document.getElementById('ar-drawer-tab-panel'));
}

/* ---------- Case detail drawer ---------- */

function arOpenDrawer(gstin) {
  _arCurrentGstin = String(gstin || '').trim().toUpperCase();
  _arActiveDrawerTab = 'history';
  _arQuickAddType = null;
  _arEditingActionId = null;
  _arTimelineFilterType = null;
  document.getElementById('ar-drawer-backdrop').classList.add('show');
  document.getElementById('ar-drawer').classList.add('show');
  arRenderDrawer();
}

function arCloseDrawer() {
  document.getElementById('ar-drawer-backdrop').classList.remove('show');
  document.getElementById('ar-drawer').classList.remove('show');
  _arCurrentGstin = null;
}

function arRenderDrawer() {
  if (!_arCurrentGstin) return;
  arInvalidateIndexes();
  var summary = arSummary(_arCurrentGstin);

  var html = '<button type="button" class="ar-drawer-close" onclick="arCloseDrawer()"><i class="fa-solid fa-xmark"></i></button>'
    + '<div class="ar-detail-name">' + xe(summary.traderName || '—') + '</div>'
    + '<div class="gstin-cell" style="margin:4px 0 10px;">' + xe(summary.gstin) + '</div>'
    + '<button class="btn btn-outline btn-sm" onclick="arViewDCR(\'' + summary.gstin + '\')"><i class="fa-solid fa-eye"></i> View in DCR</button>'
    + '<div class="ar-detail-stats" style="grid-template-columns:repeat(3,1fr);">'
    + '<div class="info-item"><div class="info-label">Total Arrear</div><div class="info-val">' + fmt(summary.arrear) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Total Recovered</div><div class="info-val" style="color:var(--green);">' + fmt(summary.recovered) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Balance</div><div class="info-val" style="color:' + (summary.balance > 0 ? 'var(--red)' : 'var(--green)') + ';">' + fmt(summary.balance) + '</div></div>'
    + '</div>'
    + (summary.arrear === 0 ? '<div style="font-size:11px;color:var(--ink3);margin-bottom:10px;"><i class="fa-solid fa-circle-info"></i> No arrear found in uploaded DCR for this GSTIN</div>' : '')
    + '<div style="margin:6px 0 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    + '<span class="pill pill-' + summary.status.cls + '">' + xe(summary.status.label) + '</span>'
    + '<span class="ar-case-badge ' + (summary.closed ? 'closed' : 'open') + '" onclick="arToggleCaseStatus(\'' + summary.gstin + '\')" title="Click to toggle open/closed">' + (summary.closed ? 'Closed Case' : 'Open Case') + '</span>'
    + '</div>'
    + '<div class="ar-tabs">'
    + '<button type="button" class="ar-tab-btn' + (_arActiveDrawerTab === 'history' ? ' active' : '') + '" onclick="arSetDrawerTab(\'history\')"><i class="fa-solid fa-clock-rotate-left"></i> Action History</button>'
    + '<button type="button" class="ar-tab-btn' + (_arActiveDrawerTab === 'details' ? ' active' : '') + '" onclick="arSetDrawerTab(\'details\')"><i class="fa-solid fa-id-card"></i> Case Details</button>'
    + '</div>'
    + '<div id="ar-drawer-tab-panel"></div>';

  document.getElementById('ar-drawer-content').innerHTML = html;
  arRenderDrawerTabPanel();
}

function arSetDrawerTab(t) { _arActiveDrawerTab = t; _arQuickAddType = null; _arEditingActionId = null; _arTimelineFilterType = null; arRenderDrawer(); }

function arRenderDrawerTabPanel() {
  var wrap = document.getElementById('ar-drawer-tab-panel');
  if (!wrap) return;
  if (_arActiveDrawerTab === 'details') { arRenderCaseDetailsTab(wrap); return; }
  arRenderActionHistoryTab(wrap);
}

function arRenderCaseDetailsTab(wrap) {
  var gstin = _arCurrentGstin;
  var addr = AppState.addressCache[gstin] || {};
  var g = arGetGroup(gstin);
  var legalName = (g && g.legalName) || addr.legalName || '—';
  wrap.innerHTML = '<div class="info-grid">'
    + '<div class="info-item"><div class="info-label">Trade Name</div><div class="info-val">' + xe(taxpayerDisplayName(gstin, legalName)) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Legal Name</div><div class="info-val">' + xe(taxpayerLegalNameCell(gstin, legalName)) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Registration Status</div><div class="info-val">' + xe(addr.regStatus || 'Not available') + '</div></div>'
    + '<div class="info-item"><div class="info-label">DCR Demand Cases</div><div class="info-val">' + (g ? g.demands : 0) + '</div></div>'
    + '</div>';
}

/* ---------- Action History tab: unified timeline (optionally filtered by type) + quick-add ---------- */

function arUnifiedEvents(gstin) {
  var events = [];
  arNoticeEvents(gstin).forEach(function (e) { events.push({ type: 'notice', date: e.date, title: 'Notice Issued', badge: e.status, amount: e.amount, ref: e.reference, id: e.id, source: e.source, module: e.source === 'module' ? 'Generated from Notice module' : 'Manually recorded' }); });
  arBankEvents(gstin).forEach(function (e) { events.push({ type: 'bank', date: e.date, title: 'Bank Attachment', badge: e.status, amount: e.amount, ref: e.reference, id: e.id, source: e.source, module: e.source === 'module' ? 'Generated from Bank Attachment module' : 'Manually recorded' }); });
  arThirdPartyEvents(gstin).forEach(function (e) { events.push({ type: 'thirdparty', date: e.date, title: 'Third Party Notice', badge: e.status, amount: e.amount, ref: e.reference, id: e.id, source: e.source, module: e.source === 'module' ? 'Generated from Third-Party module' : 'Manually recorded' }); });
  arPropertyEvents(gstin).forEach(function (e) { events.push({ type: 'property', date: e.date, title: 'Property Action', badge: e.status, amount: e.amount, ref: e.reference, id: e.id, source: e.source, module: e.source === 'module' ? 'Generated from Property module' : 'Manually recorded' }); });
  arRecoveryEvents(gstin).forEach(function (e) { events.push({ type: 'recovery', date: e.date, title: e.source === 'auto' ? 'Recovery Detected' : 'Payment Recorded', badge: e.status, amount: e.amount, ref: e.reference, id: e.id, source: e.source, module: e.source === 'auto' ? 'Auto-detected from DCR reconciliation' : 'Manually recorded' }); });
  arActionsFor(gstin).filter(function (a) { return a.type === 'followup'; }).forEach(function (a) { events.push({ type: 'followup', date: a.date, title: 'Follow-up', badge: a.status, remarks: a.remarks, next: a.nextActionDate ? { date: a.nextActionDate, note: a.nextActionNote } : null, id: a.id, source: 'manual', module: 'Manually logged' }); });
  arActionsFor(gstin).filter(function (a) { return a.type === 'remark'; }).forEach(function (a) { events.push({ type: 'remark', date: a.date, title: 'Remark', remarks: a.remarks, id: a.id, source: 'manual', module: 'Manually logged' }); });
  events.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  return events;
}

function arClearTimelineFilter() { _arTimelineFilterType = null; arRenderActionHistoryTab(document.getElementById('ar-drawer-tab-panel')); }

function arRenderActionHistoryTab(wrap) {
  if (!wrap) return;
  var events = arUnifiedEvents(_arCurrentGstin);
  if (_arTimelineFilterType) events = events.filter(function (e) { return e.type === _arTimelineFilterType; });

  var html = '';
  if (_arTimelineFilterType) {
    html += '<div class="ar-due-chip" onclick="arClearTimelineFilter()" style="margin-bottom:12px;">Showing ' + xe(AR_ACTION_TYPES[_arTimelineFilterType].label) + ' only <i class="fa-solid fa-xmark"></i></div>';
  }
  html += '<div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:12px;flex-wrap:wrap;">'
    + '<button class="btn btn-outline btn-sm" onclick="arOpenQuickAdd(\'followup\')"><i class="fa-solid fa-bell"></i> Log Follow-up</button>'
    + '<button class="btn btn-outline btn-sm" onclick="arOpenQuickAdd(\'remark\')"><i class="fa-solid fa-note-sticky"></i> Add Remark</button>'
    + '<button class="btn btn-red btn-sm" onclick="arOpenQuickAdd(\'payment\')"><i class="fa-solid fa-hand-holding-dollar"></i> Record Payment</button>'
    + '</div>'
    + '<div id="ar-quickadd-area"></div>';

  if (!events.length) {
    html += '<div class="empty" style="padding:30px 10px;"><div class="empty-sub">No actions recorded yet' + (_arTimelineFilterType ? ' for this type' : '') + '.</div></div>';
  } else {
    html += '<div class="ar-timeline">' + events.map(arTimelineCardHTML).join('') + '</div>';
  }
  wrap.innerHTML = html;
  arRenderQuickAddForm();
}

function arTimelineCardHTML(e) {
  var editable = e.source === 'manual' && (e.type === 'followup' || e.type === 'remark' || e.type === 'notice' || e.type === 'bank' || e.type === 'thirdparty' || e.type === 'property');
  var deletableOnly = e.source === 'manual' && e.type === 'recovery';
  var badgeCls = e.badge ? arEventStatusCls(e.type, e.badge) : 'gray';
  return '<div class="ar-tl-item ar-tl-' + e.type + '">'
    + '<div class="ar-tl-dot"><i class="fa-solid ' + (AR_TIMELINE_ICONS[e.type] || 'fa-circle') + '"></i></div>'
    + '<div class="ar-tl-body">'
    + '<div class="ar-tl-top"><div class="ar-tl-title">' + xe(e.title) + (e.badge ? ' <span class="pill pill-' + badgeCls + '">' + xe(e.badge) + '</span>' : '') + '</div><div class="ar-tl-date">' + fmtDateShort(e.date) + '</div></div>'
    + (e.amount ? '<div class="ar-tl-amount">' + fmt(e.amount) + '</div>' : '')
    + (e.ref ? '<div class="ar-tl-ref">' + xe(e.ref) + '</div>' : '')
    + (e.remarks ? '<div class="ar-tl-remarks">' + xe(e.remarks) + '</div>' : '')
    + (e.next ? '<div class="ar-tl-next"><i class="fa-solid fa-bell"></i> Next: ' + fmtDateShort(e.next.date) + (e.next.note ? ' — ' + xe(e.next.note) : '') + '</div>' : '')
    + '<div class="ar-tl-module">' + xe(e.module || '') + '</div>'
    + (editable ? ('<div class="ar-tl-actions"><button type="button" onclick="arEditManualEntry(\'' + e.id + '\')" title="Edit"><i class="fa-solid fa-pen"></i></button><button type="button" onclick="arDeleteManualEntry(\'' + e.id + '\')" title="Delete"><i class="fa-solid fa-trash"></i></button></div>') : '')
    + (deletableOnly ? ('<div class="ar-tl-actions"><button type="button" onclick="arDeletePayment(\'' + e.id + '\')" title="Delete"><i class="fa-solid fa-trash"></i></button></div>') : '')
    + '</div></div>';
}

/* ---------- Quick-add: Notice / Bank / Third Party / Property / Follow-up / Remark / Payment ---------- */

function arOpenQuickAdd(type) { _arQuickAddType = type; _arEditingActionId = null; arRenderQuickAddForm(); }
function arCloseQuickAdd() { _arQuickAddType = null; _arEditingActionId = null; arRenderQuickAddForm(); }

function arRenderQuickAddForm() {
  var area = document.getElementById('ar-quickadd-area');
  if (!area) return;
  if (!_arQuickAddType) { area.innerHTML = ''; return; }
  if (_arQuickAddType === 'payment') { area.innerHTML = arPaymentFormHTML(); return; }
  area.innerHTML = arManualFormHTML(_arQuickAddType);
}

function arManualFormHTML(type) {
  var meta = AR_ACTION_TYPES[type];
  var p = {};
  if (_arEditingActionId) {
    var existing = AppState.arrearActions.find(function (a) { return a.id === _arEditingActionId; });
    if (existing) p = existing;
  }
  var fieldHtml = meta.fields.map(function (f) {
    switch (f) {
      case 'date': return '<div class="fg"><label>Date *</label><input type="date" id="ar-f-date" value="' + xe(p.date || todayISO()) + '"/></div>';
      case 'status': return meta.statuses.length ? '<div class="fg"><label>Status *</label><select class="fsel" id="ar-f-status">' + meta.statuses.map(function (s) { return '<option value="' + xe(s) + '"' + (p.status === s ? ' selected' : '') + '>' + xe(s) + '</option>'; }).join('') + '</select></div>' : '';
      case 'amount': return '<div class="fg"><label>Amount (₹)</label><input type="number" id="ar-f-amount" value="' + (p.amount || '') + '"/></div>';
      case 'reference': return '<div class="fg"><label>' + xe(meta.refLabel || 'Reference') + '</label><input type="text" id="ar-f-reference" value="' + xe(p.reference || '') + '"/></div>';
      case 'remarks': return '<div class="fg full"><label>Remarks</label><textarea id="ar-f-remarks" rows="2" placeholder="Any issues, observations...">' + xe(p.remarks || '') + '</textarea></div>';
      case 'nextActionDate': return '<div class="fg"><label>Next Action Date</label><input type="date" id="ar-f-next-date" value="' + xe(p.nextActionDate || '') + '"/></div>';
      case 'nextActionNote': return '<div class="fg"><label>Next Action Note</label><input type="text" id="ar-f-next-note" placeholder="e.g. Follow up for balance" value="' + xe(p.nextActionNote || '') + '"/></div>';
      default: return '';
    }
  }).join('');

  return '<div class="ar-inline-form">'
    + '<div class="ar-inline-form-title">' + (_arEditingActionId ? 'Edit ' : 'Record Missing ') + xe(meta.label) + ' Info</div>'
    + (!_arEditingActionId && (type === 'notice' || type === 'bank' || type === 'thirdparty' || type === 'property') ? '<div style="font-size:11px;color:var(--ink3);margin-bottom:10px;"><i class="fa-solid fa-circle-info"></i> Use this only if the action was taken outside this system and isn\'t already listed above. It will not generate a real ' + xe(meta.label.toLowerCase()) + '.</div>' : '')
    + '<div class="form-grid">' + fieldHtml + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:10px;">'
    + '<button class="btn btn-red btn-sm" onclick="arSaveAction(\'' + type + '\')"><i class="fa-solid fa-floppy-disk"></i> ' + (_arEditingActionId ? 'Update' : 'Save') + '</button>'
    + '<button class="btn btn-outline btn-sm" onclick="arCloseQuickAdd()">Cancel</button>'
    + '</div></div>';
}

function arSaveAction(type) {
  if (!_arCurrentGstin) return;
  var meta = AR_ACTION_TYPES[type];
  var fields = meta.fields;
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  var obj = {
    type: type, gstin: _arCurrentGstin,
    date: fields.indexOf('date') !== -1 ? (val('ar-f-date') || todayISO()) : todayISO(),
    status: fields.indexOf('status') !== -1 ? val('ar-f-status') : '',
    amount: fields.indexOf('amount') !== -1 ? (Number(val('ar-f-amount')) || 0) : 0,
    reference: fields.indexOf('reference') !== -1 ? val('ar-f-reference').trim() : '',
    remarks: fields.indexOf('remarks') !== -1 ? val('ar-f-remarks').trim() : '',
    nextActionDate: fields.indexOf('nextActionDate') !== -1 ? val('ar-f-next-date') : '',
    nextActionNote: fields.indexOf('nextActionNote') !== -1 ? val('ar-f-next-note').trim() : ''
  };

  if (_arEditingActionId) {
    var existing = AppState.arrearActions.find(function (a) { return a.id === _arEditingActionId; });
    if (existing) Object.assign(existing, obj);
  } else {
    obj.id = uid('act');
    obj.createdAt = new Date().toISOString();
    AppState.arrearActions.push(obj);
  }
  persist();
  _arQuickAddType = null;
  _arEditingActionId = null;
  showToast('✅ Saved');
  arRenderDrawer();
  renderArrearActionList();
}

function arEditManualEntry(id) {
  var a = AppState.arrearActions.find(function (x) { return x.id === id; });
  if (!a) return;
  _arQuickAddType = a.type;
  _arEditingActionId = id;
  arRenderQuickAddForm();
  var area = document.getElementById('ar-quickadd-area');
  if (area) area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function arDeleteManualEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  AppState.arrearActions = AppState.arrearActions.filter(function (a) { return a.id !== id; });
  persist();
  arRenderDrawer();
  renderArrearActionList();
  showToast('🗑 Entry deleted');
}

function arPaymentFormHTML() {
  return '<div class="ar-inline-form">'
    + '<div class="ar-inline-form-title">Record a Payment</div>'
    + '<div class="form-grid">'
    + '<div class="fg"><label>Date *</label><input type="date" id="ar-pay-date" value="' + todayISO() + '"/></div>'
    + '<div class="fg"><label>Amount (₹) *</label><input type="number" id="ar-pay-amount"/></div>'
    + '<div class="fg full"><label>Mode / Remarks</label><input type="text" id="ar-pay-remarks" placeholder="e.g. Challan No. / DD No., or how you learned of this payment"/></div>'
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:10px;">'
    + '<button class="btn btn-red btn-sm" onclick="arSavePayment()"><i class="fa-solid fa-floppy-disk"></i> Save</button>'
    + '<button class="btn btn-outline btn-sm" onclick="arCloseQuickAdd()">Cancel</button>'
    + '</div></div>';
}

function arSavePayment() {
  var date = document.getElementById('ar-pay-date').value || todayISO();
  var amount = Number(document.getElementById('ar-pay-amount').value) || 0;
  var remarks = document.getElementById('ar-pay-remarks').value.trim();
  if (!amount) { showToast('⚠️ Enter an amount'); return; }
  AppState.paymentRecords.push({ id: uid('pay'), gstin: _arCurrentGstin, date: date, amount: amount, mode: remarks, remarks: remarks, createdAt: new Date().toISOString() });
  persist();
  _arQuickAddType = null;
  showToast('✅ Payment recorded');
  arRenderDrawer();
  renderArrearActionList();
}

function arDeletePayment(id) {
  if (!confirm('Delete this payment record? This cannot be undone.')) return;
  AppState.paymentRecords = AppState.paymentRecords.filter(function (p) { return p.id !== id; });
  persist();
  arRenderDrawer();
  renderArrearActionList();
  showToast('🗑 Payment record deleted');
}
