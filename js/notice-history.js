/* ===== Notice History page ===== */

var _histGSTINFilter = '';

function goToNoticeHistory(gstin) {
  _histGSTINFilter = gstin || '';
  nav('history');
}

function histFilterChanged() {
  _histGSTINFilter = (document.getElementById('hist-filter-gstin').value || '').trim().toUpperCase();
  renderNoticeHistoryPage();
}

function renderNoticeHistoryPage() {
  var gstinInput = document.getElementById('hist-filter-gstin');
  if (gstinInput && _histGSTINFilter) gstinInput.value = _histGSTINFilter;

  var typeFilter = (document.getElementById('hist-filter-type') || {}).value || '';
  var wrap = document.getElementById('notice-history-table-wrap');
  if (!wrap) return;

  var list = AppState.notices.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  if (_histGSTINFilter) list = list.filter(function (n) { return n.gstin.toUpperCase().includes(_histGSTINFilter) || (n.legalName || '').toUpperCase().includes(_histGSTINFilter); });
  if (typeFilter) list = list.filter(function (n) { return n.noticeKind === typeFilter; });

  if (!list.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-envelope-open-text" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Notices Found</div><div class="empty-sub">Notices you issue from the Generate Arrear Notice page will appear here</div></div>';
    return;
  }

  var rows = list.map(function (n) {
    return '<tr>'
      + '<td class="demand-id">' + xe(n.num) + '</td>'
      + '<td>' + fmtDate(n.date) + '</td>'
      + '<td>' + xe(n.legalName) + '</td>'
      + '<td class="gstin-cell">' + xe(n.gstin) + '</td>'
      + '<td>' + (n.noticeKind === 'urgent' ? '<span class="pill pill-red">Urgent</span>' : '<span class="pill pill-orange">Intimation</span>') + '</td>'
      + '<td style="text-align:center;">' + (n.cases || []).length + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(n.pendAmt) + '</div></td>'
      + '<td><div style="display:flex;gap:4px;">'
      + '<button class="btn btn-outline btn-xs" onclick="histRedownload(\'' + n.id + '\',\'word\')"><i class="fa-solid fa-file-word"></i></button>'
      + '<button class="btn btn-outline btn-xs" onclick="histRedownload(\'' + n.id + '\',\'pdf\')"><i class="fa-solid fa-file-pdf"></i></button>'
      + '<button class="btn btn-outline btn-xs" onclick="goToRecoveryProfile(\'' + n.gstin + '\')"><i class="fa-solid fa-user-shield"></i></button>'
      + '</div></td></tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Notice #</th><th>Date</th><th>Taxpayer</th><th>GSTIN</th><th>Type</th><th>Demands</th><th>Amount</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function histRedownload(noticeId, format) {
  var n = AppState.notices.find(function (x) { return x.id === noticeId; });
  if (!n) return;
  var cfg = getSettings();
  if (format === 'word') {
    buildNoticeDocx(n, cfg).then(function (blob) { downloadBlob(blob, n.num.replace(/\//g, '_') + '.docx'); });
  } else {
    generateNoticePDF(n, cfg);
  }
}

function goToRecoveryProfile(gstin) {
  nav('taxpayers');
  document.getElementById('trp-gstin-input').value = gstin;
  loadRecoveryProfile();
}
