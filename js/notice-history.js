/* ===== Notice History — one unified, read-only ledger of every document
   ever issued (Notice, Bank Attachment, Third-Party Notice, Property
   Attachment), newest first, filterable by GSTIN/taxpayer, document type,
   status and date range. Previously this page was 4 separate tabs
   (Notice/Bank/Release/Others); consolidated into a single table per
   explicit request — "don't want different tabs, instead one lump list".
   Purely a viewer: re-download any document from here, but releasing an
   attachment still only happens on Generate Arrear Notice's own Release
   Attachment tab (relSelectItem/relConfirmRelease in bank-attachment.js) —
   this page never duplicates that action. */

var _histFilters = { search: '', type: '', status: '', from: '', to: '' };
var _histPageSize = 10;
var _histCurrentPage = 1;

var HIST_TYPE_BADGE = {
  notice: '<span class="pill pill-green"><i class="fa-solid fa-envelope-open-text"></i> Notice</span>',
  bank: '<span class="pill pill-blue"><i class="fa-solid fa-building-columns"></i> Bank</span>',
  bankrelease: '<span class="pill pill-blue"><i class="fa-solid fa-unlock"></i> Bank Release</span>',
  thirdparty: '<span class="pill pill-purple"><i class="fa-solid fa-user-group"></i> Third-Party</span>',
  thirdpartyrelease: '<span class="pill pill-purple"><i class="fa-solid fa-unlock"></i> Third-Party Release</span>',
  property: '<span class="pill pill-gold"><i class="fa-solid fa-house"></i> Property</span>',
  propertyrelease: '<span class="pill pill-gold"><i class="fa-solid fa-unlock"></i> Property Release</span>'
};
var HIST_STATUS_BADGE = {
  issued: '<span class="pill pill-blue">Issued</span>',
  active: '<span class="pill pill-red">Active</span>',
  released: '<span class="pill pill-gray">Released</span>'
};

/* Jump here from a taxpayer-details card's "Notice History" link
   (wizard-copy.js/bank-attachment.js/third-party-notice.js) pre-filtered
   to that GSTIN. */
function goToNoticeHistory(gstin) {
  nav('history');
  _histFilters.search = (gstin || '').trim().toUpperCase();
  _histCurrentPage = 1;
  histRenderActiveTab();
}

/* Entry point from PAGE_RENDERERS.history (nav.js) — syncs the filter
   inputs to current state (so navigating away and back preserves what
   was typed) and renders. */
function histRenderActiveTab() {
  var g = document.getElementById('hist-gstin-filter'); if (g) g.value = _histFilters.search;
  var t = document.getElementById('hist-type-filter'); if (t) t.value = _histFilters.type;
  var s = document.getElementById('hist-status-filter'); if (s) s.value = _histFilters.status;
  var fd = document.getElementById('hist-from-date'); if (fd) fd.value = _histFilters.from;
  var td = document.getElementById('hist-to-date'); if (td) td.value = _histFilters.to;
  renderHistoryTable();
}

function histSearchChanged() {
  _histFilters.search = (document.getElementById('hist-gstin-filter').value || '').trim().toUpperCase();
  _histCurrentPage = 1;
  renderHistoryTable();
}

function histApplyFilters() {
  _histFilters.search = (document.getElementById('hist-gstin-filter').value || '').trim().toUpperCase();
  _histFilters.type = document.getElementById('hist-type-filter').value;
  _histFilters.status = document.getElementById('hist-status-filter').value;
  _histFilters.from = document.getElementById('hist-from-date').value;
  _histFilters.to = document.getElementById('hist-to-date').value;
  _histCurrentPage = 1;
  renderHistoryTable();
}

function histResetFilters() {
  _histFilters = { search: '', type: '', status: '', from: '', to: '' };
  ['hist-gstin-filter', 'hist-type-filter', 'hist-status-filter', 'hist-from-date', 'hist-to-date'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  _histCurrentPage = 1;
  renderHistoryTable();
}

/* Every issued document AND every release action, normalized into one
   shape. Notices have no active/released concept (they're just issued,
   permanently), so they always report status 'issued'. For Bank/Third-
   Party/Property, a released record produces TWO entries — the original
   attachment (dated when it was created) and a separate "X Release" entry
   (dated when it was released) — so the ledger shows both actions on
   their own timeline rows instead of one row silently changing status. */
function histAllDocuments() {
  var out = [];
  AppState.notices.forEach(function (n) {
    out.push({ type: 'notice', id: n.id, date: n.date || n.createdAt, gstin: n.gstin, legalName: n.legalName, label: n.num + ' (' + (n.noticeKind === 'urgent' ? 'Urgent' : 'Intimation') + ')', amount: n.pendAmt, status: 'issued' });
  });
  AppState.bankAtts.forEach(function (b) {
    out.push({ type: 'bank', id: b.id, date: b.date, gstin: b.gstin, legalName: b.legalName, label: 'Bank: ' + (b.bankName || '—'), amount: b.totalAmt, status: b.released ? 'released' : 'active' });
    if (b.released) {
      out.push({ type: 'bankrelease', id: b.id, date: b.releasedDate, gstin: b.gstin, legalName: b.legalName, label: 'Released: ' + (b.bankName || '—') + (b.releasedReason ? ' — ' + b.releasedReason : ''), amount: b.totalAmt, status: 'released' });
    }
  });
  AppState.thirdPartyNotices.forEach(function (t) {
    out.push({ type: 'thirdparty', id: t.id, date: t.date, gstin: t.defaulterGstin, legalName: t.legalName, label: 'Third Party: ' + (t.debtorLegal || '—'), amount: t.totalAmt, status: t.released ? 'released' : 'active' });
    if (t.released) {
      out.push({ type: 'thirdpartyrelease', id: t.id, date: t.releasedDate, gstin: t.defaulterGstin, legalName: t.legalName, label: 'Released: ' + (t.debtorLegal || '—') + (t.releasedReason ? ' — ' + t.releasedReason : ''), amount: t.totalAmt, status: 'released' });
    }
  });
  AppState.propertyAttachments.forEach(function (p) {
    out.push({ type: 'property', id: p.id, date: p.date, gstin: p.gstin, legalName: p.legalName, label: 'Property: ' + (p.propertyDescription || '—'), amount: p.totalAmt, status: p.released ? 'released' : 'active' });
    if (p.released) {
      out.push({ type: 'propertyrelease', id: p.id, date: p.releasedDate, gstin: p.gstin, legalName: p.legalName, label: 'Released: ' + (p.propertyDescription || '—') + (p.releasedReason ? ' — ' + p.releasedReason : ''), amount: p.totalAmt, status: 'released' });
    }
  });
  return out;
}

function histFilteredDocuments() {
  var items = histAllDocuments();
  var f = _histFilters;
  if (f.search) items = items.filter(function (it) {
    return (it.gstin || '').toUpperCase().indexOf(f.search) !== -1 || (it.legalName || '').toUpperCase().indexOf(f.search) !== -1;
  });
  if (f.type) items = items.filter(function (it) { return it.type === f.type; });
  if (f.status) items = items.filter(function (it) { return it.status === f.status; });
  if (f.from) items = items.filter(function (it) { return it.date && it.date >= f.from; });
  if (f.to) items = items.filter(function (it) { return it.date && it.date <= f.to; });
  return items.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}

function renderHistoryTable() {
  var wrap = document.getElementById('hist-list-wrap');
  if (!wrap) return;
  var items = histFilteredDocuments();

  if (!items.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-clock-rotate-left" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Documents Found</div><div class="empty-sub">Notices and attachments you issue will appear here</div></div>';
    return;
  }

  var pageSize = _histPageSize === 'all' ? items.length : _histPageSize;
  var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  if (_histCurrentPage > totalPages) _histCurrentPage = totalPages;
  if (_histCurrentPage < 1) _histCurrentPage = 1;
  var startIdx = (_histCurrentPage - 1) * pageSize;
  var pageItems = items.slice(startIdx, startIdx + pageSize);

  var rows = pageItems.map(function (it, i) {
    return '<tr>'
      + '<td>' + (startIdx + i + 1) + '</td>'
      + '<td>' + fmtDate(it.date) + '</td>'
      + '<td>' + HIST_TYPE_BADGE[it.type] + '</td>'
      + '<td>' + xe(taxpayerDisplayName(it.gstin, it.legalName)) + '</td>'
      + '<td class="gstin-cell">' + xe(it.gstin) + '</td>'
      + '<td style="font-size:12px;">' + xe(it.label) + '</td>'
      + '<td><div class="amount-cell pending">' + fmt(it.amount) + '</div></td>'
      + '<td>' + (HIST_STATUS_BADGE[it.status] || '—') + '</td>'
      + '<td style="white-space:nowrap;">' + histActionCell(it) + '</td>'
      + '</tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Taxpayer</th><th>GSTIN</th><th>Details</th><th>Amount (₹)</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + histPaginationHTML(items.length, totalPages);
}

/* Redownload buttons for the original document, plus the release order
   if it's been released — never a Release action itself (see file
   header). Icon-only for single-document types (unambiguous); short text
   + icon for Bank, which has two distinct documents (Letter, DRC-13). */
function histActionCell(it) {
  var btns = '';
  if (it.type === 'notice') {
    btns += '<button class="btn btn-outline btn-xs" onclick="histRedownload(\'' + it.id + '\',\'word\')" title="Notice (Word)"><i class="fa-solid fa-file-word"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="histRedownload(\'' + it.id + '\',\'pdf\')" title="Notice (PDF)"><i class="fa-solid fa-file-pdf"></i></button> ';
  } else if (it.type === 'bank') {
    btns += '<button class="btn btn-outline btn-xs" onclick="baDownloadLetter(\'' + it.id + '\',\'docx\')" title="Letter to Bank (Word)">Ltr <i class="fa-solid fa-file-word"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadLetter(\'' + it.id + '\',\'pdf\')" title="Letter to Bank (PDF)">Ltr <i class="fa-solid fa-file-pdf"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadDrc13(\'' + it.id + '\',\'docx\')" title="DRC-13 (Word)">DRC13 <i class="fa-solid fa-file-word"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="baDownloadDrc13(\'' + it.id + '\',\'pdf\')" title="DRC-13 (PDF)">DRC13 <i class="fa-solid fa-file-pdf"></i></button> ';
  } else if (it.type === 'thirdparty') {
    btns += '<button class="btn btn-outline btn-xs" onclick="tpDownloadSaved(\'' + it.id + '\',\'docx\')" title="DRC-13 (Word)"><i class="fa-solid fa-file-word"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="tpDownloadSaved(\'' + it.id + '\',\'pdf\')" title="DRC-13 (PDF)"><i class="fa-solid fa-file-pdf"></i></button> ';
  } else if (it.type === 'property') {
    btns += '<button class="btn btn-outline btn-xs" onclick="paDownloadSaved(\'' + it.id + '\',\'docx\')" title="Order (Word)"><i class="fa-solid fa-file-word"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="paDownloadSaved(\'' + it.id + '\',\'pdf\')" title="Order (PDF)"><i class="fa-solid fa-file-pdf"></i></button> ';
  } else if (it.type === 'bankrelease' || it.type === 'thirdpartyrelease' || it.type === 'propertyrelease') {
    var baseType = it.type.slice(0, -'release'.length); // 'bankrelease' -> 'bank', etc.
    btns += '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + baseType + '\',\'' + it.id + '\',\'docx\')" title="Release Order (Word)"><i class="fa-solid fa-file-word"></i></button> '
      + '<button class="btn btn-outline btn-xs" onclick="brDownloadRelease(\'' + baseType + '\',\'' + it.id + '\',\'pdf\')" title="Release Order (PDF)"><i class="fa-solid fa-file-pdf"></i></button> ';
  }
  btns += '<button class="btn btn-outline btn-xs" onclick="goToRecoveryProfile(\'' + it.gstin + '\')" title="Recovery Profile"><i class="fa-solid fa-user-shield"></i></button>';
  return btns;
}

/* Zips every release-order document currently matching the filters —
   whatever's in view, even a single row (e.g. several third-party
   releases for one taxpayer, filtered down to just that GSTIN). Reuses
   relTypeList() (bank-attachment.js) to look up each record by id. */
async function histDownloadFilteredReleasesZip(format) {
  var items = histFilteredDocuments().filter(function (it) {
    return it.type === 'bankrelease' || it.type === 'thirdpartyrelease' || it.type === 'propertyrelease';
  });
  if (!items.length) { showToast('⚠️ No release documents match the current filters'); return; }

  showToast('⏳ Zipping ' + items.length + ' release order(s)...');
  var cfg = getSettings();
  await window.LibsReady;
  var zip = new JSZip();
  var ext = format === 'pdf' ? 'pdf' : 'docx';

  var builds = items.map(function (it) {
    var baseType = it.type.slice(0, -'release'.length);
    var rec = relTypeList(baseType).find(function (x) { return x.id === it.id; });
    if (!rec) return Promise.resolve();
    var blobPromise;
    if (baseType === 'bank') {
      blobPromise = format === 'pdf' ? buildBankReleasePdfDoc(rec, cfg).then(function (doc) { return doc.output('blob'); }) : buildBankReleaseDocx(rec, cfg);
    } else if (baseType === 'thirdparty') {
      blobPromise = format === 'pdf' ? buildThirdPartyReleasePdfDoc(rec, cfg).then(function (doc) { return doc.output('blob'); }) : buildThirdPartyReleaseDocx(rec, cfg);
    } else {
      blobPromise = format === 'pdf' ? buildPropertyReleasePdfDoc(rec, cfg).then(function (doc) { return doc.output('blob'); }) : buildPropertyReleaseDocx(rec, cfg);
    }
    return blobPromise.then(function (blob) {
      /* Distinguishing detail per record (not just the taxpayer name) —
         several releases for the same taxpayer (e.g. 3 third-party
         releases) would otherwise collide on an identical filename and
         JSZip would silently keep only the last one. */
      var detail = baseType === 'bank' ? rec.bankName : baseType === 'thirdparty' ? rec.debtorLegal : rec.propertyDescription;
      var safeDetail = (detail || rec.id).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || rec.id;
      var safeTaxpayer = (taxpayerDisplayName(it.gstin, it.legalName) || 'Taxpayer').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Taxpayer';
      var uniqueSuffix = rec.id.slice(-6); // belt-and-braces: guarantees no overwrite even if two debtors share a name
      zip.file(baseType + '_Release_' + safeTaxpayer + '_' + safeDetail + '_' + uniqueSuffix + '.' + ext, blob);
    });
  });

  Promise.all(builds).then(function () {
    return zip.generateAsync({ type: 'blob' });
  }).then(function (zipBlob) {
    downloadBlob(zipBlob, 'Release_Orders_' + todayISO() + '.zip');
    showToast('✅ Downloaded ' + items.length + ' release order(s) as ZIP');
  });
}

function histPaginationHTML(total, totalPages) {
  var pageBtns = wizPageNumberList(_histCurrentPage, totalPages).map(function (p) {
    if (p === '...') return '<span class="tp-ellipsis">…</span>';
    return '<button type="button" class="tp-page' + (p === _histCurrentPage ? ' active' : '') + '" onclick="histGoToPageNum(' + p + ')">' + p + '</button>';
  }).join('');
  var sizes = [10, 25, 50];
  var sizeOptions = sizes.map(function (n) { return '<option value="' + n + '"' + (_histPageSize === n ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('')
    + '<option value="all"' + (_histPageSize === 'all' ? ' selected' : '') + '>All</option>';
  return '<div class="table-pagination">'
    + '<div class="tp-pages">'
    + '<button type="button" class="tp-btn" onclick="histGoToPage(-1)"' + (_histCurrentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>'
    + pageBtns
    + '<button type="button" class="tp-btn" onclick="histGoToPage(1)"' + (_histCurrentPage >= totalPages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>'
    + '</div>'
    + '<select class="tp-size-select" onchange="histSetPageSize(this.value)">' + sizeOptions + '</select>'
    + '</div>';
}
function histSetPageSize(val) { _histPageSize = val === 'all' ? 'all' : parseInt(val, 10); _histCurrentPage = 1; renderHistoryTable(); }
function histGoToPage(delta) { _histCurrentPage += delta; renderHistoryTable(); }
function histGoToPageNum(n) { _histCurrentPage = n; renderHistoryTable(); }

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
