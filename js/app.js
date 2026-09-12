/* ===== App bootstrap ===== */

function wireGlobalSearch() {
  var input = document.getElementById('global-search');
  var results = document.getElementById('global-search-results');
  if (!input || !results) return;

  input.addEventListener('input', function () {
    var q = input.value.trim().toUpperCase();
    if (q.length < 2) { results.classList.remove('show'); return; }
    var seen = {};
    var matches = AppState.cases.filter(isValidCase).filter(function (c) {
      if (seen[c.gstin]) return false;
      var hit = c.gstin.toUpperCase().includes(q) || (c.legalName || '').toUpperCase().includes(q);
      if (hit) seen[c.gstin] = true;
      return hit;
    }).slice(0, 8);

    results.innerHTML = matches.length
      ? matches.map(function (c) { return '<div class="gs-item" onclick="globalSearchGo(\'' + c.gstin + '\')"><strong>' + xe(c.legalName) + '</strong><br><span style="color:var(--ink3);font-family:var(--mono);font-size:10px;">' + c.gstin + '</span></div>'; }).join('')
      : '<div class="gs-item">No matches</div>';
    results.classList.add('show');
  });

  document.addEventListener('click', function (e) {
    if (!results.contains(e.target) && e.target !== input) results.classList.remove('show');
  });
}

function globalSearchGo(gstin) {
  document.getElementById('global-search-results').classList.remove('show');
  document.getElementById('global-search').value = '';
  goToRecoveryProfile(gstin);
}

function showHelpSupport() {
  var s = getSettings();
  document.getElementById('help-modal-body').innerHTML =
    '<div style="font-size:13px;line-height:1.7;color:var(--ink2);">'
    + '<p><strong>Office on record:</strong> ' + xe(s.desig) + ', ' + xe(s.circle) + ' (' + xe(s.division) + '). Update this under <a href="#" onclick="closeHelpSupport();nav(\'settings\');return false;">Settings</a>.</p>'
    + '<p style="margin-top:10px;"><strong>Where is my data stored?</strong> Everything (DCR cases, notices, bank attachments, taxpayer register) is saved locally in this browser only, via <code>localStorage</code> — nothing is sent to any server. Use <strong>Export Backup</strong> regularly and keep the file safe.</p>'
    + '<p style="margin-top:10px;"><strong>Quick reference:</strong></p>'
    + '<ul style="margin:6px 0 0 18px;">'
    + '<li>Upload DCR / Taxpayer Register from the Generate Arrear Notice page</li>'
    + '<li>Issue Notice / Bulk Notice / Paste GSTINs / Bank Attachment / Third-Party Notice / Property Attachment are tabs on that same page</li>'
    + '<li>Reports shows Top Arrear, Collectible and Non-Collectible taxpayers</li>'
    + '<li>Notice History and Downloads let you re-download anything already generated</li>'
    + '</ul>'
    + '<p style="margin-top:10px;">For issues beyond this, contact your system administrator.</p>'
    + '</div>';
  document.getElementById('help-overlay').classList.add('show');
}
function closeHelpSupport() { document.getElementById('help-overlay').classList.remove('show'); }

function wireModalCloseOnBackdrop() {
  document.querySelectorAll('.overlay').forEach(function (ov) {
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('show'); });
  });
}

document.addEventListener('DOMContentLoaded', function () {
  /* Storage.load() is async now (IndexedDB) — everything that assumes
     AppState is already populated (nav('dashboard') first of all) has to
     wait for it, so the whole bootstrap sequence lives inside .then(). */
  Storage.load().then(function () {
    wireImportPage();
    wireGlobalSearch();
    wireModalCloseOnBackdrop();

    var today = todayISO();
    ['ba-date', 'tp-date', 'pa-date'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.value) el.value = today;
    });

    nav('dashboard');

    window.LibsReady.then(function () {
      if (document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
    });

    setInterval(function () { Storage.save(); }, 30000);

    window.addEventListener('beforeunload', function () { Storage.save(); });
  });
});
