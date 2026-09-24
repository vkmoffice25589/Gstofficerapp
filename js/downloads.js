/* ===== Downloads — every generated document, re-downloadable on demand ===== */

function renderDownloadsPage() {
  var wrap = document.getElementById('downloads-table-wrap');
  if (!wrap) return;

  var rows = [];
  AppState.notices.forEach(function (n) {
    rows.push({ date: n.createdAt, type: n.noticeKind === 'urgent' ? 'Urgent Notice' : 'Intimation Notice', icon: 'fa-envelope-open-text', color: 'orange', gstin: n.gstin, name: taxpayerDisplayName(n.gstin, n.legalName), amt: n.pendAmt, action: function () { return buildNoticeDocx(n, getSettings()).then(function (b) { downloadBlob(b, n.num.replace(/\//g, '_') + '.docx'); }); }, actionPdf: function () { generateNoticePDF(n, getSettings()); } });
  });
  AppState.bankAtts.forEach(function (b) {
    rows.push({ date: b.createdAt, type: 'Bank Attachment — Letter to Bank', icon: 'fa-building-columns', color: 'gold', gstin: b.gstin, name: taxpayerDisplayName(b.gstin, b.legalName), amt: b.totalAmt, action: function () { return buildBankLetterDocx(b, getSettings()).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Letter.docx'); }); }, actionPdf: function () { generateBankLetterPDF(b, getSettings()); } });
    rows.push({ date: b.createdAt, type: 'Bank Attachment — Form DRC-13', icon: 'fa-building-columns', color: 'gold', gstin: b.gstin, name: taxpayerDisplayName(b.gstin, b.legalName), amt: b.totalAmt, action: function () { return buildBankDrc13Docx(b, getSettings()).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_DRC13.docx'); }); }, actionPdf: function () { generateBankDrc13PDF(b, getSettings()); } });
    if (!b.released) return;
    rows.push({ date: b.releasedDate || b.createdAt, type: 'Bank Release Order', icon: 'fa-unlock', color: 'green', gstin: b.gstin, name: taxpayerDisplayName(b.gstin, b.legalName), amt: b.totalAmt, action: function () { return buildBankReleaseDocx(b, getSettings()).then(function (blob) { downloadBlob(blob, b.ref.replace(/\//g, '_') + '_Release.docx'); }); }, actionPdf: function () { generateBankReleasePDF(b, getSettings()); } });
  });
  AppState.thirdPartyNotices.forEach(function (t) {
    rows.push({ date: t.createdAt, type: 'Third-Party Notice (DRC-13)', icon: 'fa-user-group', color: 'purple', gstin: t.defaulterGstin, name: taxpayerDisplayName(t.defaulterGstin, t.legalName), amt: t.totalAmt, action: function () { return buildThirdPartyDocx(t, getSettings()).then(function (blob) { downloadBlob(blob, 'DRC13_' + t.defaulterGstin + '.docx'); }); }, actionPdf: function () { generateThirdPartyPDF(t, getSettings()); } });
  });
  AppState.propertyAttachments.forEach(function (p) {
    rows.push({ date: p.createdAt, type: 'Property Attachment Order', icon: 'fa-house-lock', color: 'red', gstin: p.gstin, name: taxpayerDisplayName(p.gstin, p.legalName), amt: p.totalAmt, action: function () { return buildPropertyAttachmentDocx(p, getSettings()).then(function (blob) { downloadBlob(blob, 'PropertyAttachment_' + p.gstin + '.docx'); }); }, actionPdf: function () { generatePropertyAttachmentPDF(p, getSettings()); } });
  });

  rows.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });

  if (!rows.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-download" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Documents Generated Yet</div><div class="empty-sub">Notices, bank release orders, third-party notices and property attachment orders will appear here for re-download</div></div>';
    return;
  }

  window._downloadsRows = rows;
  var trs = rows.map(function (r, i) {
    return '<tr><td>' + fmtDate(r.date) + '</td>'
      + '<td><span class="pill pill-' + r.color + '"><i class="fa-solid ' + r.icon + '"></i> ' + xe(r.type) + '</span></td>'
      + '<td>' + xe(r.name) + '<br><span class="gstin-cell">' + xe(r.gstin) + '</span></td>'
      + '<td><div class="amount-cell pending">' + fmt(r.amt) + '</div></td>'
      + '<td><div style="display:flex;gap:4px;">'
      + '<button class="btn btn-outline btn-xs" onclick="_downloadsRows[' + i + '].action()"><i class="fa-solid fa-file-word"></i> Word</button>'
      + (r.actionPdf ? '<button class="btn btn-outline btn-xs" onclick="_downloadsRows[' + i + '].actionPdf()"><i class="fa-solid fa-file-pdf"></i> PDF</button>' : '')
      + '</div></td></tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Document Type</th><th>Taxpayer</th><th>Amount</th><th>Download</th></tr></thead><tbody>' + trs + '</tbody></table></div>';
}
