/* ===== Generate Arrear Notice — shared upload-status/page-level glue for
   #page-bulknotice, plus a handful of stateless helpers shared by the
   Issue Notice tab. The actual search/filter/demand-table/notice-generation
   logic for Issue Notice now lives entirely in js/wizard-copy.js — it was
   originally built as an independent "Issue Notice (Copy)" tab to
   remodify safely, then promoted to be the one and only Issue Notice tab
   once it proved out (see index.html; the original wiz- prefixed
   implementation this file used to contain has been removed). ===== */

function renderWizardStepper() {
  var hasDCR = AppState.cases.length > 0;
  var hasReg = hasRegisterData();
  var bothReady = hasDCR && hasReg;

  if (typeof renderDCRSection === 'function') renderDCRSection();
  if (typeof renderTpRegSection === 'function') renderTpRegSection();

  var genBtn = document.getElementById('wiz2-generate-notice-btn');
  if (genBtn) genBtn.disabled = !bothReady;

  var banner = document.getElementById('wiz-ready-banner');
  if (banner) banner.style.display = bothReady ? 'flex' : 'none';

  if (bothReady && !_wizBothUploadedNotified) {
    _wizBothUploadedNotified = true;
    showToast('✅ Both files uploaded successfully. Ready to issue notice.');
  } else if (!bothReady) {
    _wizBothUploadedNotified = false;
  }
}

/* Still used as a quick-link target from the "Upload Taxpayer Register"
   shortcut button on the Issue Notice tab (see index.html). */
function wizChevronGoToTaxpayerRegister() {
  var section = document.getElementById('wizard-tpreg-section');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* DCR/Taxpayer Register upload now lives on its own page (#page-dataupload).
   Once both are ready, "proceed" means leaving that page and landing on
   Generate Arrear Notice, which will render the tabs section itself. */
function wizProceedToNoticeGeneration() {
  if (!AppState.cases.length || !hasRegisterData()) return;
  nav('bulknotice');
}

/* Generate Arrear Notice's own page renderer — shows the enforcement tabs
   if DCR + Taxpayer Register are both ready, otherwise shows an inline
   empty-state (in case the popup gets dismissed) plus a popup prompting the
   officer to go upload them, so it's never a silent dead end. */
function renderBulkNoticePage() {
  var hasDCR = AppState.cases.length > 0;
  var hasReg = hasRegisterData();
  var bothReady = hasDCR && hasReg;

  var tabsSection = document.getElementById('bulknotice-tabs-section');
  var notReady = document.getElementById('bulknotice-not-ready');
  if (tabsSection) tabsSection.style.display = bothReady ? 'block' : 'none';
  if (notReady) notReady.style.display = bothReady ? 'none' : 'block';

  if (!bothReady) {
    var msg = document.getElementById('bulknotice-not-ready-msg');
    if (msg) {
      msg.textContent = (!hasDCR && !hasReg) ? 'Upload both DCR and the Taxpayer Register to start generating notices and taking recovery action.'
        : !hasDCR ? 'Upload the DCR — the Taxpayer Register is already in.'
        : 'Upload the Taxpayer Register — the DCR is already in.';
    }
    openDataUploadPrompt(hasDCR, hasReg);
  }
}

function openDataUploadPrompt(hasDCR, hasReg) {
  var status = document.getElementById('dataupload-prompt-status');
  if (status) {
    status.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' + (hasDCR ? '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--ink3);"></i>') + ' DCR</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">' + (hasReg ? '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--ink3);"></i>') + ' Taxpayer Register</div>';
  }
  var overlay = document.getElementById('dataupload-prompt-overlay');
  if (overlay) overlay.classList.add('show');
}
function closeDataUploadPrompt() {
  var overlay = document.getElementById('dataupload-prompt-overlay');
  if (overlay) overlay.classList.remove('show');
}

/* Tracks whether the "both files uploaded" popup has already fired for the
   current pair of uploads, so it shows once per DCR+Register combination
   rather than on every stepper re-render. */
var _wizBothUploadedNotified = false;

function tdb(label, val) { return '<div class="tdb-item"><div class="tdb-label">' + label + '</div><div class="tdb-val">' + val + '</div></div>'; }

/* Reference popup for the demand table's flag rules — built from the live
   EXCLUDED_STATUSES list (business-rules.js) so it can never drift out of
   sync with what the table actually flags. */
function openWizExclusionGuide() {
  document.getElementById('wiz-exclusion-guide-body').innerHTML =
    '<h3>1. Not shown in the table at all</h3>'
    + '<ul><li>Zero or negative pending amount — nothing left to recover on that demand.</li></ul>'
    + '<h3>2. Shown in the table, but highlighted and left unticked</h3>'
    + '<p class="wiz-guide-sub">These rows are still listed — just flagged and unchecked until you tick them yourself.</p>'
    + '<h4>Higher forum / closed / refund status <span class="pill pill-orange wiz-excluded-badge">Excluded</span></h4>'
    + '<ul>' + EXCLUDED_STATUSES.map(function (s) { return '<li>' + xe(s) + '</li>'; }).join('') + '</ul>'
    + '<h4>Section 62 best-judgment assessment <span class="pill pill-gold wiz-excluded-badge">Section 62</span></h4>'
    + '<ul><li>Not a confirmed arrear until the return is filed or the officer opts in — use the "Include Section 62" chip or Advanced Filters to include it.</li></ul>';
  document.getElementById('wiz-exclusion-guide-overlay').classList.add('show');
}
function closeWizExclusionGuide() {
  document.getElementById('wiz-exclusion-guide-overlay').classList.remove('show');
}

function dayBadge(age) {
  if (age === null) return '<span class="day-badge d-orange">—</span>';
  var cls = age < 60 ? 'd-green' : age < 90 ? 'd-orange' : 'd-red';
  return '<span class="day-badge ' + cls + '">' + age + '</span>';
}

/* Tax-head breakdown popup for a single demand's Pending Arrear amount —
   opened from the Issue Notice demand table. */
function showDemandBreakdown(demandId) {
  var c = AppState.cases.find(function (x) { return x.demandId === demandId; });
  if (!c) return;
  document.getElementById('dbk-sub').textContent = 'Demand ID: ' + c.demandId + (c.taxPeriod ? '  ·  Tax Period: ' + c.taxPeriod : '');
  var heads = [['IGST', c.pend_igst], ['CGST', c.pend_cgst], ['SGST', c.pend_sgst], ['CESS', c.pend_cess]];
  document.getElementById('dbk-body').innerHTML =
    '<table style="width:100%;border-collapse:collapse;">' + heads.map(function (h) {
      return '<tr><td style="padding:8px 0;color:var(--muted-text);">' + h[0] + '</td>'
        + '<td style="padding:8px 0;text-align:right;"><div class="amount-cell">' + fmt(h[1]) + '</div></td></tr>';
    }).join('')
    + '<tr><td style="padding:12px 0 0;font-weight:700;border-top:1px solid var(--border);color:var(--navy-text);">Total Pending</td>'
    + '<td style="padding:12px 0 0;text-align:right;border-top:1px solid var(--border);"><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td></tr>'
    + '</table>';
  document.getElementById('demand-breakdown-overlay').classList.add('show');
}

function closeDemandBreakdown() {
  document.getElementById('demand-breakdown-overlay').classList.remove('show');
}

/* Classic "1 2 3 ... 8 9 10" windowed page list with ellipses for the gaps. */
function wizPageNumberList(current, total) {
  if (total <= 1) return [1];
  var delta = 1;
  var range = [];
  for (var i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) range.push(i);
  }
  var withDots = [];
  var last = null;
  range.forEach(function (i) {
    if (last !== null) {
      if (i - last === 2) withDots.push(last + 1);
      else if (i - last > 1) withDots.push('...');
    }
    withDots.push(i);
    last = i;
  });
  return withDots;
}

var NOTICE_REQUIRED_FIELDS = [['legalName', 'Legal Name'], ['address', 'Taxpayer Address']];

/* Entry point from other pages (Reports "Notice" action, Dashboard quick action). */
function openNoticeModal(gstin) {
  nav('bulknotice');
  var tabEl = document.querySelector('#page-bulknotice .tab[data-tab="notice2"]');
  bulkTab('notice2', tabEl);
  if (gstin) {
    document.getElementById('wiz2-gstin-input').value = gstin;
    wiz2SearchGSTIN();
  }
}
