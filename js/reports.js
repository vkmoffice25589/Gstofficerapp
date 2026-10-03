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
  var dwSection = document.getElementById('rpt-dw-section');
  if (!wrap) return;

  if (_reportTab === 'demandwise') {
    wrap.style.display = 'none';
    if (info) info.style.display = 'none';
    if (dwSection) dwSection.style.display = 'block';
    renderDemandWiseReport();
    return;
  }
  wrap.style.display = '';
  if (dwSection) dwSection.style.display = 'none';

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

/* ===== Collectible Demands — one row per Demand ID (not grouped by
   taxpayer). "Collectible" here hard-excludes Section 62 and every
   EXCLUDED_STATUSES entry (higher forum / closed / refund — this already
   covers "First Appeal Application Admitted" and "...Submitted"), since
   the report's whole purpose is to show only what's actually collectable
   — unlike Issue Notice/Bank Attachment, there's no tick-to-override here.
   No search/filter bar — per explicit request, the report shows nothing
   until "Generate" is clicked, then shows every collectible demand (no
   narrowing), with sorting via clickable column headers and an optional
   taxpayer grouping as the only controls. ===== */
var _rptDwSort = { col: 'total', dir: 'desc' };
var _rptDwPageSize = 25;
var _rptDwCurrentPage = 1;
var _rptDwGroupBy = 'none'; // 'none' | 'taxpayer'
var _rptDwGenerated = false;

function rptDwGroupByChanged() {
  _rptDwGroupBy = document.getElementById('rpt-dw-groupby').value;
  _rptDwCurrentPage = 1;
  if (_rptDwGenerated) renderDemandWiseReport();
}

function rptDwBaseCases() {
  return AppState.cases.filter(isValidCase).filter(function (c) {
    if ((Number(c.pend_total) || 0) <= 0) return false;
    if (isStatusExcluded(c)) return false;
    if (isSection62(c)) return false;
    return true;
  });
}

/* Also doubles as "Refresh" — re-reads AppState.cases fresh every time,
   so clicking it again after importing a new DCR picks up the latest
   data without leaving the page. */
function rptDwGenerate() {
  _rptDwGenerated = true;
  document.getElementById('rpt-dw-subtotal-bar').style.display = 'flex';
  document.getElementById('rpt-dw-wrap').style.display = 'block';
  document.getElementById('rpt-dw-export-wrap').style.display = '';
  renderDemandWiseReport();
}

function rptDwSortCases(cases) {
  var col = _rptDwSort.col, dir = _rptDwSort.dir, mul = dir === 'asc' ? 1 : -1;
  return cases.slice().sort(function (a, b) {
    if (col === 'demandId') return mul * String(a.demandId || '').localeCompare(String(b.demandId || ''));
    if (col === 'orderDate') return mul * ((parseDcrDate(a.dcr_date || a.demandDate) || 0) - (parseDcrDate(b.dcr_date || b.demandDate) || 0));
    if (col === 'days') return mul * ((getDemandAgeDays(a) || 0) - (getDemandAgeDays(b) || 0));
    var field = col === 'total' ? 'pend_total' : 'pend_' + col;
    return mul * ((Number(a[field]) || 0) - (Number(b[field]) || 0));
  });
}

function rptDwSortBy(col) {
  if (_rptDwSort.col === col) _rptDwSort.dir = _rptDwSort.dir === 'asc' ? 'desc' : 'asc';
  else { _rptDwSort.col = col; _rptDwSort.dir = 'desc'; }
  _rptDwCurrentPage = 1;
  renderDemandWiseReport();
}

function rptDwSortArrow(col) {
  if (_rptDwSort.col !== col) return '';
  return _rptDwSort.dir === 'asc' ? ' <i class="fa-solid fa-sort-up"></i>' : ' <i class="fa-solid fa-sort-down"></i>';
}

function rptDwSubtotal(cases) {
  return cases.reduce(function (s, c) {
    s.igst += Number(c.pend_igst) || 0; s.cgst += Number(c.pend_cgst) || 0; s.sgst += Number(c.pend_sgst) || 0;
    s.cess += Number(c.pend_cess) || 0; s.total += Number(c.pend_total) || 0;
    return s;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 });
}

function rptDwTh(label, col) { return '<th style="cursor:pointer;white-space:nowrap;" onclick="rptDwSortBy(\'' + col + '\')">' + label + rptDwSortArrow(col) + '</th>'; }
function rptDwTheadRow() {
  return '<tr><th>#</th>' + rptDwTh('Demand ID', 'demandId') + rptDwTh('Order Date', 'orderDate')
    + '<th>GSTIN</th><th>Trade Name</th><th>Tax Period</th><th>Section</th>' + rptDwTh('Days', 'days') + '<th>Reg Status</th>'
    + rptDwTh('IGST (₹)', 'igst') + rptDwTh('CGST (₹)', 'cgst') + rptDwTh('SGST (₹)', 'sgst') + rptDwTh('CESS (₹)', 'cess') + rptDwTh('Pending (₹)', 'total') + '</tr>';
}
function rptDwCaseRow(c, idx) {
  var age = getDemandAgeDays(c);
  var collectibleReg = isCollectible(c.gstin);
  var regPill = collectibleReg === null || collectibleReg === undefined ? '<span class="pill pill-gray">Unknown</span>'
    : collectibleReg ? '<span class="pill pill-green">Active</span>' : '<span class="pill pill-red">Cancelled</span>';
  return '<tr>'
    + '<td>' + idx + '</td>'
    + '<td class="demand-id">' + xe(c.demandId) + '</td>'
    + '<td>' + fmtDate(c.dcr_date || c.demandDate) + '</td>'
    + '<td class="gstin-cell">' + xe(c.gstin) + '</td>'
    + '<td>' + xe(taxpayerDisplayName(c.gstin, c.legalName)) + '</td>'
    + '<td>' + xe(c.taxPeriod) + '</td>'
    + '<td style="text-align:center;">' + xe(c.section) + '</td>'
    + '<td style="text-align:center;">' + dayBadge(age) + '</td>'
    + '<td>' + regPill + '</td>'
    + '<td style="text-align:right;">' + fmt0(c.pend_igst) + '</td>'
    + '<td style="text-align:right;">' + fmt0(c.pend_cgst) + '</td>'
    + '<td style="text-align:right;">' + fmt0(c.pend_sgst) + '</td>'
    + '<td style="text-align:right;">' + fmt0(c.pend_cess) + '</td>'
    + '<td><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td>'
    + '</tr>';
}

/* Excel-style "Data > Subtotal": one row per demand, grouped by taxpayer,
   a subtotal row after each taxpayer's demands, and a grand total at the
   end. Shown in full (no pagination) since splitting a taxpayer's group
   across pages would defeat the point. Groups are ordered by their own
   subtotal, highest first — same "top arrear" spirit as the default sort. */
function rptDwRenderGrouped(filtered) {
  var byGstin = {};
  filtered.forEach(function (c) {
    if (!byGstin[c.gstin]) byGstin[c.gstin] = [];
    byGstin[c.gstin].push(c);
  });
  var groups = Object.keys(byGstin).map(function (gstin) {
    var cases = rptDwSortCases(byGstin[gstin]);
    return { gstin: gstin, legalName: cases[0].legalName, cases: cases, sub: rptDwSubtotal(cases) };
  }).sort(function (a, b) { return b.sub.total - a.sub.total; });

  var grand = { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 };
  var body = groups.map(function (g) {
    grand.igst += g.sub.igst; grand.cgst += g.sub.cgst; grand.sgst += g.sub.sgst; grand.cess += g.sub.cess; grand.total += g.sub.total;
    var rows = g.cases.map(function (c, i) { return rptDwCaseRow(c, i + 1); }).join('');
    var subtotalRow = '<tr class="rpt-dw-subtotal-row">'
      + '<td colspan="4"></td>'
      + '<td colspan="5">Subtotal — ' + xe(taxpayerDisplayName(g.gstin, g.legalName)) + ' (' + g.cases.length + ' demand' + (g.cases.length === 1 ? '' : 's') + ')</td>'
      + '<td style="text-align:right;">' + fmt0(g.sub.igst) + '</td>'
      + '<td style="text-align:right;">' + fmt0(g.sub.cgst) + '</td>'
      + '<td style="text-align:right;">' + fmt0(g.sub.sgst) + '</td>'
      + '<td style="text-align:right;">' + fmt0(g.sub.cess) + '</td>'
      + '<td>' + fmt(g.sub.total) + '</td>'
      + '</tr>';
    return rows + subtotalRow;
  }).join('');

  var grandRow = '<tr class="rpt-dw-grandtotal-row">'
    + '<td colspan="9">GRAND TOTAL — ' + filtered.length + ' demands, ' + groups.length + ' taxpayer' + (groups.length === 1 ? '' : 's') + '</td>'
    + '<td style="text-align:right;">' + fmt0(grand.igst) + '</td>'
    + '<td style="text-align:right;">' + fmt0(grand.cgst) + '</td>'
    + '<td style="text-align:right;">' + fmt0(grand.sgst) + '</td>'
    + '<td style="text-align:right;">' + fmt0(grand.cess) + '</td>'
    + '<td>' + fmt(grand.total) + '</td>'
    + '</tr>';

  return '<div class="table-scroll"><table><thead>' + rptDwTheadRow() + '</thead><tbody>' + body + grandRow + '</tbody></table></div>';
}

function renderDemandWiseReport() {
  if (!_rptDwGenerated) return; // nothing shows until "Generate" is clicked
  var gb = document.getElementById('rpt-dw-groupby'); if (gb) gb.value = _rptDwGroupBy;

  var wrap = document.getElementById('rpt-dw-wrap');
  var subtotalBar = document.getElementById('rpt-dw-subtotal-bar');
  if (!wrap) return;

  var filtered = rptDwBaseCases();
  var sub = rptDwSubtotal(filtered);
  if (subtotalBar) {
    subtotalBar.innerHTML = '<div><div class="wchr-label">Demands</div><div class="wchr-val" style="color:var(--navy-text);">' + filtered.length + '</div></div>'
      + '<div><div class="wchr-label">IGST</div><div class="wchr-val" style="color:var(--navy-text);">' + fmt(sub.igst) + '</div></div>'
      + '<div><div class="wchr-label">CGST</div><div class="wchr-val" style="color:var(--navy-text);">' + fmt(sub.cgst) + '</div></div>'
      + '<div><div class="wchr-label">SGST</div><div class="wchr-val" style="color:var(--navy-text);">' + fmt(sub.sgst) + '</div></div>'
      + '<div><div class="wchr-label">CESS</div><div class="wchr-val" style="color:var(--navy-text);">' + fmt(sub.cess) + '</div></div>'
      + '<div><div class="wchr-label">Subtotal (Pending)</div><div class="wchr-val">' + fmt(sub.total) + '</div></div>';
  }

  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-chart-bar" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Demands Found</div><div class="empty-sub">No collectible demands in the imported DCR data</div></div>';
    return;
  }

  if (_rptDwGroupBy === 'taxpayer') {
    wrap.innerHTML = rptDwRenderGrouped(filtered);
    return;
  }

  var sorted = rptDwSortCases(filtered);
  var pageSize = _rptDwPageSize === 'all' ? sorted.length : _rptDwPageSize;
  var totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  if (_rptDwCurrentPage > totalPages) _rptDwCurrentPage = totalPages;
  if (_rptDwCurrentPage < 1) _rptDwCurrentPage = 1;
  var startIdx = (_rptDwCurrentPage - 1) * pageSize;
  var pageCases = sorted.slice(startIdx, startIdx + pageSize);
  var rows = pageCases.map(function (c, i) { return rptDwCaseRow(c, startIdx + i + 1); }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead>' + rptDwTheadRow() + '</thead><tbody>' + rows + '</tbody></table></div>'
    + rptDwPaginationHTML(sorted.length, totalPages);
}

/* ===== Export to Excel — two sheets built from every collectible demand
   (same data the on-screen table/subtotal reflect): "Taxpayer Abstract"
   (one row per taxpayer, e.g. "Sree Satya Traders, 8 demands, ₹X") and
   "Demand Detail" (the full demand-wise breakup with the same per-
   taxpayer subtotal rows + grand total as the grouped on-screen view).
   Reuses the XLSX json_to_sheet/book_new pattern already used for DCR
   exports (import-dcr.js). ===== */
function rptDwGroupedByTaxpayer(filtered) {
  var byGstin = {};
  filtered.forEach(function (c) { (byGstin[c.gstin] = byGstin[c.gstin] || []).push(c); });
  return Object.keys(byGstin).map(function (gstin) {
    var cases = rptDwSortCases(byGstin[gstin]);
    return { gstin: gstin, legalName: cases[0].legalName, cases: cases, sub: rptDwSubtotal(cases) };
  }).sort(function (a, b) { return b.sub.total - a.sub.total; });
}

function rptDwRegLabel(gstin) {
  var col = isCollectible(gstin);
  return col === null || col === undefined ? 'Unknown' : col ? 'Active' : 'Cancelled';
}

function rptDwBuildAbstractRows(groups, filtered) {
  var rows = groups.map(function (g, i) {
    return {
      '#': i + 1, GSTIN: g.gstin, 'Trade Name': taxpayerDisplayName(g.gstin, g.legalName), 'Reg Status': rptDwRegLabel(g.gstin),
      Demands: g.cases.length, 'IGST (₹)': g.sub.igst, 'CGST (₹)': g.sub.cgst, 'SGST (₹)': g.sub.sgst, 'CESS (₹)': g.sub.cess, 'Pending (₹)': g.sub.total
    };
  });
  var grand = rptDwSubtotal(filtered);
  rows.push({ '#': '', GSTIN: '', 'Trade Name': 'GRAND TOTAL', 'Reg Status': '', Demands: filtered.length, 'IGST (₹)': grand.igst, 'CGST (₹)': grand.cgst, 'SGST (₹)': grand.sgst, 'CESS (₹)': grand.cess, 'Pending (₹)': grand.total });
  return rows;
}

function rptDwBuildDetailRows(groups, filtered) {
  var rows = [];
  groups.forEach(function (g) {
    g.cases.forEach(function (c, i) {
      rows.push({
        '#': i + 1, 'Demand ID': c.demandId, 'Order Date': fmtDate(c.dcr_date || c.demandDate), GSTIN: c.gstin,
        'Trade Name': taxpayerDisplayName(c.gstin, c.legalName), 'Tax Period': c.taxPeriod, Section: c.section,
        Days: getDemandAgeDays(c), 'Reg Status': rptDwRegLabel(c.gstin),
        'IGST (₹)': Number(c.pend_igst) || 0, 'CGST (₹)': Number(c.pend_cgst) || 0, 'SGST (₹)': Number(c.pend_sgst) || 0,
        'CESS (₹)': Number(c.pend_cess) || 0, 'Pending (₹)': Number(c.pend_total) || 0
      });
    });
    rows.push({
      '#': '', 'Demand ID': '', 'Order Date': '', GSTIN: '', 'Trade Name': 'Subtotal — ' + taxpayerDisplayName(g.gstin, g.legalName),
      'Tax Period': '', Section: '', Days: '', 'Reg Status': g.cases.length + ' demands',
      'IGST (₹)': g.sub.igst, 'CGST (₹)': g.sub.cgst, 'SGST (₹)': g.sub.sgst, 'CESS (₹)': g.sub.cess, 'Pending (₹)': g.sub.total
    });
  });
  var grand = rptDwSubtotal(filtered);
  rows.push({
    '#': '', 'Demand ID': '', 'Order Date': '', GSTIN: '', 'Trade Name': 'GRAND TOTAL', 'Tax Period': '', Section: '', Days: '',
    'Reg Status': filtered.length + ' demands, ' + groups.length + ' taxpayers',
    'IGST (₹)': grand.igst, 'CGST (₹)': grand.cgst, 'SGST (₹)': grand.sgst, 'CESS (₹)': grand.cess, 'Pending (₹)': grand.total
  });
  return rows;
}

async function rptDwExportExcel() {
  var filtered = rptDwBaseCases();
  if (!filtered.length) { showToast('⚠️ No collectible demands to export'); return; }
  await window.LibsReady;
  var groups = rptDwGroupedByTaxpayer(filtered);

  var abstractSheet = XLSX.utils.json_to_sheet(rptDwBuildAbstractRows(groups, filtered));
  var detailSheet = XLSX.utils.json_to_sheet(rptDwBuildDetailRows(groups, filtered));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, abstractSheet, 'Taxpayer Abstract');
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Demand Detail');
  var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/octet-stream' }), 'Collectible_Demands_' + todayISO() + '.xlsx');
  showToast('✅ Exported ' + filtered.length + ' demands across ' + groups.length + ' taxpayers');
}

function rptDwPaginationHTML(total, totalPages) {
  var pageBtns = wizPageNumberList(_rptDwCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _rptDwCurrentPage ? ' active' : '') + '" onclick="rptDwGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');
  var sizes = [25, 50, 100];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_rptDwPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_rptDwPageSize === 'all' ? ' selected' : '') + '>All</option>';
  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="rptDwGoToPage(-1)"' + (_rptDwCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="rptDwGoToPage(1)"' + (_rptDwCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="rptDwSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}
function rptDwSetPageSize(val) { _rptDwPageSize = val === 'all' ? 'all' : parseInt(val, 10); _rptDwCurrentPage = 1; renderDemandWiseReport(); }
function rptDwGoToPage(delta) { _rptDwCurrentPage += delta; renderDemandWiseReport(); }
function rptDwGoToPageNum(n) { _rptDwCurrentPage = n; renderDemandWiseReport(); }
