/* ===== Shared Word (.docx) export engine — one OOXML builder, reused by every export ===== */

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* OOXML's w:jc uses "both" for full justification, not the CSS/HTML term "justify" —
   an invalid enum value here is a hard schema violation that made Word refuse to open
   the file ("found a problem with its contents"), unlike the python-docx/lxml checks
   used during development which don't validate enum values at all. */
function normJc(align) { return align === 'justify' ? 'both' : align; }

function wPara(text, opts) {
  opts = opts || {};
  var align = normJc(opts.align || 'left');
  var bold = opts.bold ? '<w:b/>' : '';
  var size = opts.size ? '<w:sz w:val="' + (opts.size * 2) + '"/>' : '<w:sz w:val="20"/>';
  var spacing = '<w:spacing w:after="' + (opts.spacingAfter != null ? opts.spacingAfter : 160) + '"/>';
  var runs = (opts.runs || [{ text: text, bold: opts.bold }]).map(function (run) {
    var rb = run.bold ? '<w:b/>' : '';
    return '<w:r><w:rPr>' + rb + size + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(run.text) + '</w:t></w:r>';
  }).join('');
  return '<w:p><w:pPr>' + spacing + '<w:jc w:val="' + align + '"/></w:pPr>' + runs + '</w:p>';
}

function wTable(rows, colWidths, opts) {
  opts = opts || {};
  var totalWidth = colWidths.reduce(function (s, w) { return s + w; }, 0);
  var grid = colWidths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('');
  var trs = rows.map(function (row, ri) {
    var tcs = row.map(function (cell, ci) {
      cell = typeof cell === 'object' ? cell : { text: cell };
      var isHeaderRow = ri === 0 && !opts.noHeaderShade;
      var bold = isHeaderRow || cell.bold ? '<w:b/>' : '';
      var align = normJc(cell.align || (opts.noHeaderShade ? 'left' : (ci === 0 ? 'left' : 'center')));
      var shade = isHeaderRow ? '<w:shd w:val="clear" w:fill="EDF1F7"/>' : '';
      return '<w:tc><w:tcPr><w:tcW w:w="' + colWidths[ci] + '" w:type="dxa"/>' + shade + '<w:vAlign w:val="center"/></w:tcPr>'
        + '<w:p><w:pPr><w:spacing w:after="40"/><w:jc w:val="' + align + '"/></w:pPr><w:r><w:rPr>' + bold + '<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">' + xmlEsc(cell.text) + '</w:t></w:r></w:p></w:tc>';
    }).join('');
    return '<w:tr>' + tcs + '</w:tr>';
  }).join('');
  var borders = opts.noBorder
    ? '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="C8D3E0"/><w:left w:val="single" w:sz="4" w:color="C8D3E0"/>'
      + '<w:bottom w:val="single" w:sz="4" w:color="C8D3E0"/><w:right w:val="single" w:sz="4" w:color="C8D3E0"/>'
      + '<w:insideH w:val="single" w:sz="4" w:color="C8D3E0"/><w:insideV w:val="single" w:sz="4" w:color="C8D3E0"/></w:tblBorders>';
  return '<w:tbl><w:tblPr><w:tblW w:w="' + totalWidth + '" w:type="dxa"/>' + borders
    + '</w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + trs + '</w:tbl><w:p/>';
}

async function buildDocxBlob(bodyXml) {
  await window.LibsReady;
  var zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.folder('word').file('document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + bodyXml +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1100" w:right="1100" w:bottom="1100" w:left="1100"/></w:sectPr>' +
    '</w:body></w:document>');
  return zip.generateAsync({ type: 'blob' });
}

function downloadBlob(blob, filename) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
}

function officeHeaderBlock(cfg) {
  return wPara('OFFICE OF THE ' + (cfg.desig || '').toUpperCase(), { align: 'center', bold: true, size: 12 })
    + wPara(cfg.circle || '', { align: 'center', bold: true, size: 12 })
    + wPara((cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), { align: 'center', size: 10 })
    + wPara('', { spacingAfter: 60 });
}

function demandRowsForDocx(cases) {
  var rows = [['Tax Period', 'Demand ID', 'Section', 'Order Date', 'Pending (₹)']];
  var total = 0;
  cases.forEach(function (c) {
    total += Number(c.pend_total) || 0;
    rows.push([
      c.taxPeriod || '—', c.demandId || '—', c.section || '—', fmtDate(c.dcr_date || c.demandDate),
      { text: fmt0(c.pend_total), align: 'right' }
    ]);
  });
  rows.push([{ text: 'Total', bold: true }, '', '', '', { text: fmt0(total), bold: true, align: 'right' }]);
  return { rows: rows, total: total };
}

/* 8-column tax-head breakdown table, matching the office's DCR-style demand
   table (Assessment Year / Demand ID / Date / IGST / CGST / SGST / CESS / Total). */
function demandRowsForNoticeDocx(cases) {
  var rows = [['ASSESSMENT YEAR', 'DEMAND ID', 'DATE OF DEMAND ORDER', 'IGST', 'CGST', 'SGST', 'CESS', 'TOTAL']];
  var sums = { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 };
  cases.forEach(function (c) {
    var igst = Number(c.pend_igst) || 0, cgst = Number(c.pend_cgst) || 0, sgst = Number(c.pend_sgst) || 0,
      cess = Number(c.pend_cess) || 0, total = Number(c.pend_total) || 0;
    sums.igst += igst; sums.cgst += cgst; sums.sgst += sgst; sums.cess += cess; sums.total += total;
    rows.push([
      c.taxPeriod || '—', c.demandId || '—', fmtDate(c.dcr_date || c.demandDate),
      { text: fmt0(igst), align: 'right' }, { text: fmt0(cgst), align: 'right' },
      { text: fmt0(sgst), align: 'right' }, { text: fmt0(cess), align: 'right' },
      { text: fmt0(total), align: 'right' }
    ]);
  });
  rows.push([
    { text: 'TOTAL', bold: true }, '', '',
    { text: fmt0(sums.igst), bold: true, align: 'right' }, { text: fmt0(sums.cgst), bold: true, align: 'right' },
    { text: fmt0(sums.sgst), bold: true, align: 'right' }, { text: fmt0(sums.cess), bold: true, align: 'right' },
    { text: fmt0(sums.total), bold: true, align: 'right' }
  ]);
  return { rows: rows, total: sums.total };
}

/* Notice "Dated" line uses zero-padded dot separators (DD.MM.YYYY) per the
   office format, not the slash-separated fmtDate() used elsewhere in the app. */
function fmtDateDot(d) {
  if (!d) return '—';
  var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '.' + m[2] + '.' + m[1];
  var dt = new Date(d);
  if (isNaN(dt)) return fmtDate(d).replace(/\//g, '.');
  return String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear();
}

/* Borderless 2-column header row — GSTIN (Urgent notice only) on the left,
   the office block right-aligned on the right, matching the letterhead layout. */
function noticeHeaderTable(cfg, leftText) {
  var rightParas = wPara('Office of the ' + (cfg.desig || ''), { align: 'right', bold: true, size: 11, spacingAfter: 20 })
    + wPara((cfg.circle || ''), { align: 'right', bold: true, size: 11, spacingAfter: 20 })
    + wPara(cfg.addr1 || '', { align: 'right', size: 10, spacingAfter: 20 })
    + wPara(cfg.addr2 || '', { align: 'right', size: 10, spacingAfter: 20 });
  var leftPara = wPara(leftText || '', { align: 'left', size: 10, spacingAfter: 20 });
  return '<w:tbl><w:tblPr><w:tblW w:w="9706" w:type="dxa"/>'
    + '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
    + '</w:tblPr><w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="6506"/></w:tblGrid>'
    + '<w:tr>'
    + '<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + leftPara + '</w:tc>'
    + '<w:tc><w:tcPr><w:tcW w:w="6506" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + rightParas + '</w:tc>'
    + '</w:tr></w:tbl><w:p/>';
}

var noticeActionList = [
  'Attaching properties under section 79(d) of the GST act 2017.',
  'Detaining Properties under section 79(d) of the GST act 2017.',
  'Action will be taken under section 79(e) of the GST act 2017 & CRR Act 1890.',
  'Filing an application before the Court Of Magistrate under section 79(f) of the GST act 2017.'
];

/* ===== 1. Arrear Notice (Intimation / Urgent) — matches the office's official
   "Urgent Notice Final Format" / "Intimation Notice Format" letterheads. ===== */
function buildNoticeDocx(notice, cfg) {
  var isUrgent = notice.noticeKind === 'urgent';
  var d = demandRowsForNoticeDocx(notice.cases || []);
  var legalName = notice.legalName || '—';
  var gstin = notice.gstin || '—';

  var subText = 'TNGST Act 2017 – ' + (cfg.circle || '') + ' – Tvl.' + legalName + ', GSTIN : ' + gstin
    + ' - Arrears of Tax outstanding – ' + (isUrgent ? 'Urgent' : 'Intimation') + ' Notice issued – Regarding.';
  var refText = isUrgent ? 'This Office DRC-07 issued' : 'Statutory Orders issued in form DRC 07';
  var actionList = noticeActionList.map(function (t) { return wPara('✓  ' + t, { spacingAfter: 40 }); }).join('');

  var body = noticeHeaderTable(cfg, '')
    + wPara('Notice No: ' + (notice.num || '—') + '          Dated : ' + fmtDateDot(notice.date), { spacingAfter: 160 })
    + wPara(isUrgent ? 'URGENT NOTICE' : 'INTIMATION NOTICE', { align: 'center', bold: true, size: 13, spacingAfter: 20 })
    + wPara('NON-PAYMENT OF GST ARREARS', { align: 'center', bold: true, size: 12, spacingAfter: 200 })
    + wPara('To') + wTable([
      ['GSTIN', ': ' + gstin],
      ['Legal Name of the Business', ': ' + legalName]
    ], [3600, 6106], { noBorder: true, noHeaderShade: true })
    + wTable([[{ text: 'Sub', bold: true }, subText], [{ text: 'Ref', bold: true }, refText]], [900, 8806], { noBorder: true, noHeaderShade: true })
    + wPara('*******', { align: 'center', spacingAfter: 120 })
    + wPara('Tvl.' + legalName + ', registered with the office of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '')
      + ' is hereby informed they are in arrears of Goods and Services Tax as detailed below:', { align: 'justify', spacingAfter: 120 })
    + wTable(d.rows, [1500, 1600, 1300, 1000, 1000, 1000, 900, 1300])
    + wPara('(AMOUNT IN RS)', { align: 'right', size: 9, spacingAfter: 160 })
    + wPara('Total Amount Payable: ' + fmt(d.total) + ' (Rupees ' + numToWords(d.total) + ' Only)', { bold: true, spacingAfter: 160 })
    + (notice.details ? wPara('Remarks: ' + notice.details, { spacingAfter: 160 }) : '')
    + wPara((isUrgent
      ? 'The Taxpayer is informed that the arrears have not been paid even after the expiry of 90 days from the date of the order. If the above amount is not paid immediately on receipt of this notice, recovery action will be initiated to realise the arrears in accordance with the provisions of the GST Act, 2017 by:'
      : 'The taxpayer is hereby informed that arrears are pending. If the arrears remain unpaid after the expiry of 90 days from the date of the order and no appeal has been filed, recovery action will be initiated to realise the dues in accordance with the provisions of the GST Act, 2017, by:'), { align: 'justify', spacingAfter: 100 })
    + actionList
    + wPara('Payment Gateway:', { bold: true, spacingAfter: 40 })
    + wPara('The Taxpayer is advised to pay the above said arrears through GSTIN Portal by selecting the option "Payment towards demand".', { align: 'justify', spacingAfter: 160 })
    + wPara('Note:', { bold: true, spacingAfter: 40 })
    + wPara('➤  If the tax has already been paid, you are requested to submit the payment details to this office immediately, otherwise it will be presumed that the balance still exists.', { spacingAfter: 40 })
    + wPara('➤  If the case is pending before any appellate forum, you are requested to submit the details to this office immediately.', { spacingAfter: 40 })
    + wPara('➤  Other than above no representation, in person or through postal.', { spacingAfter: 300 })
    + wPara((cfg.desig || ''), { align: 'right' })
    + wPara((cfg.circle || ''), { align: 'right' })
    + wPara(cfg.city || '', { align: 'right', spacingAfter: 300 })
    + wPara('To,')
    + wPara(legalName, { bold: true })
    + (notice.address ? wPara(notice.address) : '');
  return buildDocxBlob(body);
}

/* ===== 2. Bank Attachment Release Notice ===== */
var releaseReasonTexts = {
  'Demand Paid': 'the outstanding demand against the above GSTIN has been fully paid',
  'First Appeal Filed': 'a First Appeal has been filed against the demand along with the requisite pre-deposit',
  'WP Filed & Stay Obtained': 'a stay has been obtained from the Hon\'ble High Court against recovery',
  'Revision - Demand Nullified': 'the demand has been nullified pursuant to a revision order'
};
function buildBankReleaseDocx(bankAtt, reason, cfg) {
  var text = releaseReasonTexts[reason] || reason;
  var body = officeHeaderBlock(cfg)
    + wPara('BANK ATTACHMENT — RELEASE ORDER', { align: 'center', bold: true, size: 13 })
    + wPara('', { spacingAfter: 100 })
    + wPara('To,')
    + wPara(bankAtt.bankName || '—', { bold: true })
    + wPara(bankAtt.branch || '')
    + wPara(bankAtt.branchAddr || '')
    + wPara('', { spacingAfter: 100 })
    + wPara('Sub: Release of attachment on account No. ' + (bankAtt.accno || '—') + ' held by ' + (bankAtt.legalName || '—') + ' (GSTIN: ' + (bankAtt.gstin || '—') + ') — reg.', { bold: true })
    + wPara('', { spacingAfter: 100 })
    + wPara('With reference to the provisional attachment ordered vide reference ' + (bankAtt.ref || '—') + ' dated ' + fmtDate(bankAtt.date) + ', since ' + text + ', the attachment on the above account is hereby released with immediate effect.', { align: 'justify' })
    + wPara('', { spacingAfter: 300 })
    + wPara((cfg.desig || ''), { align: 'right' })
    + wPara((cfg.circle || ''), { align: 'right' });
  return buildDocxBlob(body);
}

/* ===== 3. Third-Party (Debtor) Notice — DRC-13 style ===== */
function buildThirdPartyDocx(tp, cfg) {
  var d = demandRowsForDocx(tp.cases || []);
  var body = officeHeaderBlock(cfg)
    + wPara('FORM GST DRC-13', { align: 'center', bold: true, size: 13 })
    + wPara('Notice to a Third Person under Section 79(1)(c)', { align: 'center', size: 11 })
    + wPara('', { spacingAfter: 100 })
    + wPara('To,')
    + wPara(tp.debtorLegal || '—', { bold: true })
    + (tp.debtorTrade ? wPara(tp.debtorTrade) : '')
    + (tp.debtorGstin ? wPara('GSTIN: ' + tp.debtorGstin) : '')
    + (tp.debtorAddr ? wPara(tp.debtorAddr) : '')
    + wPara('', { spacingAfter: 100 })
    + wPara('Whereas ' + (tp.legalName || tp.defaulterGstin) + ' (GSTIN: ' + (tp.defaulterGstin || '—') + ') has failed to pay the tax dues detailed below, and whereas it appears that you owe / hold money for or on account of the said defaulter, you are hereby required, under Section 79(1)(c) of the GST Act, to pay to the Government the amount due to the defaulter, or up to the amount specified below, whichever is less.', { align: 'justify' })
    + wPara('', { spacingAfter: 100 })
    + wTable(d.rows, [2200, 2200, 1600, 1800, 2200])
    + wPara('Amount to be paid: ' + fmt(d.total), { bold: true })
    + wPara('', { spacingAfter: 300 })
    + wPara((cfg.desig || ''), { align: 'right' })
    + wPara((cfg.circle || ''), { align: 'right' });
  return buildDocxBlob(body);
}

/* ===== 4. Property Attachment Order — Section 79(d) ===== */
function buildPropertyAttachmentDocx(pa, cfg) {
  var d = demandRowsForDocx(pa.cases || []);
  var body = officeHeaderBlock(cfg)
    + wPara('ORDER OF ATTACHMENT OF PROPERTY', { align: 'center', bold: true, size: 13 })
    + wPara('under Section 79(1)(d) of the GST Act', { align: 'center', size: 11 })
    + wPara('', { spacingAfter: 100 })
    + wPara('Defaulter: ' + (pa.legalName || '—') + '   GSTIN: ' + (pa.gstin || '—'), { bold: true })
    + wPara('', { spacingAfter: 100 })
    + wPara('Whereas the amounts detailed below remain outstanding and unpaid, and recovery by other modes has not been effective, the movable/immovable property described below, belonging to the above defaulter, is hereby attached in exercise of powers under Section 79(1)(d) of the GST Act, until the outstanding dues are discharged in full.', { align: 'justify' })
    + wPara('', { spacingAfter: 100 })
    + wTable(d.rows, [2200, 2200, 1600, 1800, 2200])
    + wPara('Property Description: ' + (pa.propertyDescription || '—'))
    + wPara('Location / Survey No.: ' + (pa.propertyLocation || '—'))
    + wPara('Estimated Value: ' + fmt(pa.propertyValue))
    + wPara('', { spacingAfter: 300 })
    + wPara((cfg.desig || ''), { align: 'right' })
    + wPara((cfg.circle || ''), { align: 'right' });
  return buildDocxBlob(body);
}

/* ===== 5. Recovery Profile dossier ===== */
function buildRecoveryProfileDocx(gstin, summary, cfg) {
  var body = officeHeaderBlock(cfg)
    + wPara('RECOVERY PROFILE', { align: 'center', bold: true, size: 13 })
    + wPara('', { spacingAfter: 100 })
    + wPara(summary.legalName || '—', { bold: true })
    + wPara('GSTIN: ' + gstin)
    + wPara('', { spacingAfter: 100 })
    + wTable([
      ['Metric', 'Value'],
      ['Total Original Demand', fmt0(summary.origTotal)],
      ['Total Pending', fmt0(summary.pendTotal)],
      ['Number of Demands', String(summary.demandCount)],
      ['Notices Issued', String(summary.noticeCount)],
      ['Bank Attachments', String(summary.bankCount)],
      ['Recorded Collections', fmt0(summary.recoveredTotal)]
    ], [4500, 4500])
    + wPara('', { spacingAfter: 300 })
    + wPara((cfg.desig || ''), { align: 'right' })
    + wPara((cfg.circle || ''), { align: 'right' });
  return buildDocxBlob(body);
}
