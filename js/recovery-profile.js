/* ===== Recovery Profile — full history for one GSTIN ===== */

var _trpCurrentGSTIN = null;

function loadRecoveryProfile() {
  var gstin = (document.getElementById('trp-gstin-input').value || '').trim().toUpperCase();
  document.getElementById('trp-gstin-input').value = gstin;
  var hint = document.getElementById('trp-search-hint');
  var prof = document.getElementById('trp-profile');
  var empty = document.getElementById('trp-empty');

  if (!gstin) { hint.textContent = '⚠️ Please enter a GSTIN'; hint.style.color = 'var(--orange)'; return; }
  if (gstin.length !== 15) { hint.textContent = '⚠️ GSTIN must be 15 characters (got ' + gstin.length + ')'; hint.style.color = 'var(--orange)'; return; }

  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  if (!cases.length) {
    prof.style.display = 'none'; empty.style.display = 'block';
    document.getElementById('trp-empty-msg').textContent = gstin + ' not found in imported DCR data';
    hint.textContent = ''; return;
  }

  _trpCurrentGSTIN = gstin;
  hint.style.color = ''; hint.textContent = '';
  prof.style.display = 'block'; empty.style.display = 'none';
  renderRecoveryProfile(gstin, cases);
}

function renderRecoveryProfile(gstin, cases) {
  var t = cases[0];
  var legalName = t.legalName || gstin;
  var displayName = taxpayerDisplayName(gstin, legalName);
  var tpNotices = AppState.notices.filter(function (n) { return n.gstin === gstin; });
  var tpBanks = AppState.bankAtts.filter(function (b) { return b.gstin === gstin; });
  var tpThirdParty = AppState.thirdPartyNotices.filter(function (n) { return n.defaulterGstin === gstin; });
  var tpProperty = AppState.propertyAttachments.filter(function (p) { return p.gstin === gstin; });
  var tpRecon = AppState.reconciliationLog.filter(function (r) { return r.gstin === gstin; });
  var tpPay = AppState.paymentRecords.filter(function (p) { return p.gstin === gstin; });
  var regInfo = AppState.addressCache[gstin] || {};

  var origTotal = cases.reduce(function (s, c) { return s + (Number(c.orig_total) || 0); }, 0);
  var pendTotal = cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var manualPay = tpPay.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
  var reconCol = tpRecon.filter(function (r) { return r.type === 'collection' || r.type === 'partial'; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
  var recoveredTotal = manualPay + reconCol;

  var regBadge = !regInfo.regStatus ? '<span class="pill pill-gray">Register: Unknown</span>'
    : (isCollectible(gstin) ? '<span class="pill pill-green">' + xe(regInfo.regStatus) + '</span>' : '<span class="pill pill-red">' + xe(regInfo.regStatus) + '</span>');

  document.getElementById('trp-header').innerHTML =
    '<div class="tp-header"><div class="tp-avatar">' + xe((displayName || '?').charAt(0).toUpperCase()) + '</div>'
    + '<div><div class="tp-name">' + xe(displayName) + '</div><div class="tp-gstin">' + xe(gstin) + '</div>'
    + '<div style="margin-top:6px;">' + regBadge + ' ' + recoveryPill(t.recoveryStatus) + '</div></div>'
    + '<div class="tp-stats" style="display:flex;gap:6px;"><button class="btn btn-blue btn-sm" onclick="exportRecoveryProfileWord()"><i class="fa-solid fa-file-word"></i> Export Dossier</button>'
    + '<button class="btn btn-outline btn-sm" onclick="exportRecoveryProfilePDF()"><i class="fa-solid fa-file-pdf"></i> PDF</button></div>'
    + '</div>';

  document.getElementById('trp-stats').innerHTML =
    '<div class="info-grid">'
    + '<div class="info-item"><div class="info-label">Original Demand</div><div class="info-val">' + fmt(origTotal) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Pending Arrear</div><div class="info-val" style="color:var(--red);">' + fmt(pendTotal) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Recorded Collections</div><div class="info-val" style="color:var(--green);">' + fmt(recoveredTotal) + '</div></div>'
    + '<div class="info-item"><div class="info-label">Demands</div><div class="info-val">' + cases.length + '</div></div>'
    + '<div class="info-item"><div class="info-label">Notices Issued</div><div class="info-val">' + tpNotices.length + '</div></div>'
    + '<div class="info-item"><div class="info-label">Bank Attachments</div><div class="info-val">' + tpBanks.length + '</div></div>'
    + '</div>';

  var caseRows = cases.map(function (c) {
    var status = (c.demandStatus || '').toLowerCase().includes('revision demand created') ? '<span class="pill pill-gold">ELIMINATED</span>'
      : (Number(c.pend_total) === 0 ? '<span class="pill pill-green">CLOSED</span>' : '<span class="pill pill-red">OPEN</span>');
    return '<tr><td class="demand-id">' + xe(c.demandId) + '</td><td>' + xe(c.taxPeriod) + '</td><td style="text-align:center;">' + xe(c.section) + '</td>'
      + '<td><div class="amount-cell">' + fmt(c.orig_total) + '</div></td><td><div class="amount-cell pending">' + fmt(c.pend_total) + '</div></td>'
      + '<td>' + status + '</td></tr>';
  }).join('');
  document.getElementById('trp-cases').innerHTML = '<div class="table-scroll"><table><thead><tr><th>Demand ID</th><th>Tax Period</th><th>Section</th><th>Original</th><th>Pending</th><th>Status</th></tr></thead><tbody>' + caseRows + '</tbody></table></div>';

  var events = [];
  cases.forEach(function (c) { events.push({ date: c.importedAt || c.dcr_date, title: 'Demand imported — ' + c.demandId, note: c.taxPeriod }); });
  tpNotices.forEach(function (n) { events.push({ date: n.createdAt, title: (n.noticeKind === 'urgent' ? 'Urgent notice' : 'Intimation notice') + ' issued — ' + n.num, note: fmt(n.pendAmt) }); });
  tpBanks.forEach(function (b) {
    events.push({ date: b.createdAt, title: 'Bank attached — ' + b.bankName, note: fmt(b.totalAmt) });
    if (b.released) events.push({ date: b.releasedDate, title: 'Bank attachment released', note: b.releasedReason });
  });
  tpThirdParty.forEach(function (t2) { events.push({ date: t2.createdAt, title: 'Third-party notice — ' + t2.debtorLegal, note: fmt(t2.totalAmt) }); });
  tpProperty.forEach(function (p) { events.push({ date: p.createdAt, title: 'Property attached — ' + p.propertyDescription, note: fmt(p.totalAmt) }); });
  tpRecon.forEach(function (r) { events.push({ date: r.createdAt, title: 'Reconciliation: ' + r.type + ' — ' + r.demandId, note: fmt(r.amount) + ' — ' + r.remarks }); });
  tpPay.forEach(function (p) { events.push({ date: p.createdAt, title: 'Payment recorded', note: fmt(p.amount) + (p.remarks ? ' — ' + p.remarks : '') }); });

  events.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
  document.getElementById('trp-timeline').innerHTML = events.length
    ? '<div class="timeline">' + events.map(function (e) {
        return '<div class="tl-item"><div class="tl-dot"></div><div class="tl-body"><div class="tl-title">' + xe(e.title) + '</div><div class="tl-date">' + fmtDate(e.date) + '</div>' + (e.note ? '<div class="tl-note">' + xe(e.note) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>'
    : '<div class="empty-sub">No recovery activity recorded yet.</div>';
}

function recoveryProfileSummary(gstin) {
  var cases = AppState.cases.filter(function (c) { return c.gstin === gstin; });
  var tpNotices = AppState.notices.filter(function (n) { return n.gstin === gstin; });
  var tpBanks = AppState.bankAtts.filter(function (b) { return b.gstin === gstin; });
  var tpRecon = AppState.reconciliationLog.filter(function (r) { return r.gstin === gstin; });
  var tpPay = AppState.paymentRecords.filter(function (p) { return p.gstin === gstin; });

  return {
    legalName: cases[0] ? cases[0].legalName : gstin,
    origTotal: cases.reduce(function (s, c) { return s + (Number(c.orig_total) || 0); }, 0),
    pendTotal: cases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0),
    demandCount: cases.length,
    noticeCount: tpNotices.length,
    bankCount: tpBanks.length,
    recoveredTotal: tpPay.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0)
      + tpRecon.filter(function (r) { return r.type === 'collection' || r.type === 'partial'; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0)
  };
}

function exportRecoveryProfileWord() {
  if (!_trpCurrentGSTIN) return;
  var gstin = _trpCurrentGSTIN;
  buildRecoveryProfileDocx(gstin, recoveryProfileSummary(gstin), getSettings()).then(function (blob) {
    downloadBlob(blob, 'RecoveryProfile_' + gstin + '.docx');
  });
}

function exportRecoveryProfilePDF() {
  if (!_trpCurrentGSTIN) return;
  var gstin = _trpCurrentGSTIN;
  generateRecoveryProfilePDF(gstin, recoveryProfileSummary(gstin), getSettings());
}
