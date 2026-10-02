/* ===== Notice History page — Notice / Bank / Release / Others sub-tabs.
   The latter three used to be inline "ACTIVE ATTACHMENTS"/"RELEASED
   ATTACHMENTS"/etc. lists at the bottom of their own Generate Arrear
   Notice sub-tabs; moved here so every past document lives in one place,
   separate from the forms that create new ones. Those forms (bank
   attachment creation, release, third-party, property) still live on
   Generate Arrear Notice — only the "here's what's already been issued"
   list views moved. */

var _histGSTINFilter = '';

function goToNoticeHistory(gstin) {
  _histGSTINFilter = gstin || '';
  nav('history');
  var tabEl = document.querySelector('#page-history .tab[data-tab="notices"]');
  histTab('notices', tabEl);
}

/* tab: 'notices' | 'bankatt' | 'bankrelease' | 'others'. */
function histTab(tab, el) {
  document.querySelectorAll('#page-history .tab').forEach(function (t) { t.classList.remove('active'); });
  document.querySelectorAll('#page-history .hist-tab-panel').forEach(function (p) { p.style.display = 'none'; });
  if (el) el.classList.add('active');
  var panel = document.getElementById('hist-tab-' + tab);
  if (panel) panel.style.display = 'block';
  if (tab === 'notices') renderNoticeHistoryPage();
  else if (tab === 'bankatt') renderBankAtts();
  else if (tab === 'bankrelease') renderReleasedList();
  else if (tab === 'others') { renderThirdPartyList(); renderPropertyList(); }
}

/* Re-renders whichever sub-tab is currently active — called on every
   nav('history') entry, so switching away and back (without going through
   goToNoticeHistory()) preserves the officer's last-picked sub-tab,
   consistent with how Generate Arrear Notice's own sub-tabs behave. */
function histRenderActiveTab() {
  var activeTab = document.querySelector('#page-history .tab.active');
  var tab = activeTab ? activeTab.getAttribute('data-tab') : 'notices';
  histTab(tab, activeTab);
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
      + '<td>' + xe(taxpayerDisplayName(n.gstin, n.legalName)) + '</td>'
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
