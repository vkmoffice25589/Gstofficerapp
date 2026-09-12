/* ===== Single canonical navigation dispatcher ===== */

var PAGE_RENDERERS = {
  dashboard: function () { renderDashboard(); },
  cases: function () { renderReports(); },
  dataupload: function () { renderWizardStepper(); },
  bulknotice: function () { renderBulkNoticePage(); updateBulkAllCount(); renderBankAtts(); renderThirdPartyList(); renderPropertyList(); },
  taxpayers: function () { /* profile loads on search */ },
  arrearactions: function () { renderArrearActionList(); },
  history: function () { renderNoticeHistoryPage(); },
  downloads: function () { renderDownloadsPage(); },
  settings: function () { initSettingsPage(); }
};

function nav(page) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.sb-item').forEach(function (i) { i.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + page);
  if (!pageEl) { console.warn('nav(): unknown page "' + page + '"'); return; }
  pageEl.classList.add('active');
  document.querySelectorAll('.sb-item[data-page="' + page + '"]').forEach(function (i) { i.classList.add('active'); });
  if (PAGE_RENDERERS[page]) PAGE_RENDERERS[page]();
  updateSidebar();
}

function updateSidebar() {
  var sbCases = document.getElementById('sb-cases');
  if (sbCases) sbCases.textContent = AppState.cases.filter(isValidCase).length;
  updateSidebarOfficeCard(getSettings());
  updateHeaderNotifBadge();
}

/* Header bell badge: count of urgent (>=90 day), notice-eligible demands — a
   real, already-computed figure (same rule the Dashboard's "Urgent Notices
   Due" tile uses), not a placeholder number. */
function updateHeaderNotifBadge() {
  var badge = document.getElementById('hdr-notif-badge');
  if (!badge) return;
  var urgentGstins = new Set(
    AppState.cases.filter(isValidCase).filter(isNoticeEligible)
      .filter(function (c) { return isNoticeTypeMatch(c, 'urgent'); })
      .map(function (c) { return c.gstin; })
  );
  var count = urgentGstins.size;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}
