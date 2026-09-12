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

/* Every run explicitly carries Times New Roman — without a styles.xml part
   (this engine emits none) Word falls back to its own theme default
   (Calibri), which reads as informal next to the Times New Roman every
   Indian court/government letter uses. Default body size is 12pt (was
   10pt) with 1.5 line spacing within wrapped paragraphs, matching that
   formal-document convention instead of a cramped single-spaced 10pt. */
var DOCX_FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';
function wPara(text, opts) {
  opts = opts || {};
  var align = normJc(opts.align || 'left');
  var bold = opts.bold ? '<w:b/>' : '';
  var size = '<w:sz w:val="' + ((opts.size || 12) * 2) + '"/>';
  var spacing = '<w:spacing w:after="' + (opts.spacingAfter != null ? opts.spacingAfter : 160) + '" w:line="360" w:lineRule="auto"/>';
  var runs = (opts.runs || [{ text: text, bold: opts.bold }]).map(function (run) {
    var rb = run.bold ? '<w:b/>' : '';
    return '<w:r><w:rPr>' + rb + DOCX_FONT + size + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(run.text) + '</w:t></w:r>';
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
        + '<w:p><w:pPr><w:spacing w:after="40" w:line="300" w:lineRule="auto"/><w:jc w:val="' + align + '"/></w:pPr><w:r><w:rPr>' + bold + DOCX_FONT + '<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">' + xmlEsc(cell.text) + '</w:t></w:r></w:p></w:tc>';
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

/* Borderless 2-column table whose cells hold already-built paragraph XML
   (from wPara()) rather than plain text — wTable() XML-escapes its cell
   content as text, which would dump literal "<w:p>..." markup onto the
   page if given raw XML, so a From/To letterhead block needs this instead
   (same reasoning as noticeHeaderTable() above, generalised to 2 columns
   of arbitrary width). */
function rawXmlTable2Col(leftXml, rightXml, leftW, rightW) {
  return '<w:tbl><w:tblPr><w:tblW w:w="' + (leftW + rightW) + '" w:type="dxa"/>'
    + '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
    + '</w:tblPr><w:tblGrid><w:gridCol w:w="' + leftW + '"/><w:gridCol w:w="' + rightW + '"/></w:tblGrid>'
    + '<w:tr>'
    + '<w:tc><w:tcPr><w:tcW w:w="' + leftW + '" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + leftXml + '</w:tc>'
    + '<w:tc><w:tcPr><w:tcW w:w="' + rightW + '" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + rightXml + '</w:tc>'
    + '</w:tr></w:tbl><w:p/>';
}

/* ===== 2. Bank Attachment — Release Order =====
   Matches the office's "Bank release Reference" letter: same From/To
   letterhead as the covering letter, a Sub/Ref block citing the original
   attachment and the taxpayer's petition date, a narrative paragraph
   (case-specific facts the officer enters on the Release Attachment tab,
   wrapped by the standard opening/closing sentences), and a "Copy to"
   footer addressed to the taxpayer — no separate Date/Place/Signature
   block, matching the sample exactly. Reads release fields directly off
   the saved bankAtt record (releasedReason/releasedDate/etc.) so the
   order can be regenerated later without re-asking the officer. */
var RELEASE_TEMPORARY_REASONS = ['First Appeal Filed', 'WP Filed & Stay Obtained'];
function buildBankReleaseDocx(b, cfg) {
  var isTemporary = RELEASE_TEMPORARY_REASONS.indexOf(b.releasedReason) !== -1;
  var fromText = wPara('From', { size: 10, spacingAfter: 20 })
    + wPara((cfg.officerName ? cfg.officerName + ', ' : '') + (cfg.desig || '') + ',', { bold: true, size: 10, spacingAfter: 20 })
    + wPara(cfg.circle || '', { size: 10, spacingAfter: 20 })
    + wPara(cfg.city || '', { size: 10, spacingAfter: 20 });
  var toText = wPara('To', { size: 10, spacingAfter: 20 })
    + wPara('The Branch Manager', { bold: true, size: 10, spacingAfter: 20 })
    + wPara(b.bankName || '—', { bold: true, size: 10, spacingAfter: 20 })
    + (b.branchAddr ? wPara(b.branchAddr, { size: 10, spacingAfter: 20 }) : '');

  var subText = 'GST Act 2017 – Tvl. ' + (b.legalName || '—') + ' - Payment of GST Arrear - Arrears of Tax Recovery Under Section 145(1) – Notice in DRC-13 issued – Attachment ' + (isTemporary ? 'Temporarily Withdrawn' : 'Released') + ' - Regarding.';
  var refText = 'This office Ref in GSTIN. ' + (b.gstin || '—') + ', dt.' + fmtDate(b.date) + '.'
    + (b.releasedPetitionDate ? ' The Taxpayer\'s Petition Dated: ' + fmtDate(b.releasedPetitionDate) + '.' : '');
  var closing = isTemporary
    ? 'In view of the above, the Bank Attachment issued by this circle in the reference 1st cited is temporarily withdrawn and all action (lien, freeze, etc.) that has been imposed to withhold the account may be withdrawn.'
    : 'In view of the above, the Bank Attachment issued by this circle in the reference 1st cited is released and all action (lien, freeze, etc.) that has been imposed to withhold the account may be withdrawn.';

  var body = wPara('COMMERCIAL TAXES DEPARTMENT', { align: 'center', bold: true, size: 13, spacingAfter: 160 })
    + rawXmlTable2Col(fromText, toText, 4300, 5406)
    + wPara('GSTIN: ' + (b.gstin || '—') + '/ dated: ' + fmtDate(b.releasedDate || todayISO()), { spacingAfter: 160 })
    + wPara('Sir/Madam,', { spacingAfter: 100 })
    + wTable([[{ text: 'Sub:-', bold: true }, subText], [{ text: 'Ref:', bold: true }, refText]], [900, 8806], { noBorder: true, noHeaderShade: true })
    + wPara('*********', { align: 'center', spacingAfter: 160 })
    + wPara('Tvl. ' + (b.legalName || '—') + ' doing business at ' + (b.releasedAddr || '—').replace(/\.+\s*$/, '') + '. ' + (b.releasedNarrative || ''), { align: 'justify', spacingAfter: 120 })
    + wPara(closing, { align: 'justify', spacingAfter: 300 })
    + wPara((cfg.desig || ''), { align: 'right' })
    + wPara((cfg.circle || '') + '.', { align: 'right', spacingAfter: 300 })
    + wPara('Copy to: ', { spacingAfter: 20 })
    + wPara(b.legalName || '—', { spacingAfter: 20 })
    + wPara(b.releasedAddr || '—', { spacingAfter: 20 });
  return buildDocxBlob(body);
}

/* 9-column tax-head breakdown table for the DRC-13 bank notice — same shape
   as demandRowsForNoticeDocx but with a Section column, matching the
   office's official DRC-13 format (FORM GST DRC-13, Rule 145(1)). */
function demandRowsForBankDrc13(cases) {
  var rows = [['ASSESSMENT YEAR', 'DEMAND ID', 'DATE OF DEMAND ORDER', 'SEC', 'IGST', 'CGST', 'SGST', 'CESS', 'TOTAL']];
  var sums = { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 };
  cases.forEach(function (c) {
    var igst = Number(c.pend_igst) || 0, cgst = Number(c.pend_cgst) || 0, sgst = Number(c.pend_sgst) || 0,
      cess = Number(c.pend_cess) || 0, total = Number(c.pend_total) || 0;
    sums.igst += igst; sums.cgst += cgst; sums.sgst += sgst; sums.cess += cess; sums.total += total;
    rows.push([
      c.fy || '—', c.demandId || '—', fmtDate(c.dcr_date || c.demandDate), c.section || '—',
      { text: fmt0(igst), align: 'right' }, { text: fmt0(cgst), align: 'right' },
      { text: fmt0(sgst), align: 'right' }, { text: fmt0(cess), align: 'right' },
      { text: fmt0(total), align: 'right' }
    ]);
  });
  rows.push([
    { text: 'TOTAL', bold: true }, '', '', '',
    { text: fmt0(sums.igst), bold: true, align: 'right' }, { text: fmt0(sums.cgst), bold: true, align: 'right' },
    { text: fmt0(sums.sgst), bold: true, align: 'right' }, { text: fmt0(sums.cess), bold: true, align: 'right' },
    { text: fmt0(sums.total), bold: true, align: 'right' }
  ]);
  return { rows: rows, total: sums.total };
}

/* Trade name isn't stored on the bank-attachment record itself — it lives in
   the address cache the same way every other module looks it up (see
   arGetTraderName in arrear-action-register.js). Falls back to legal name,
   same convention as elsewhere. */
function bankAttTradeName(b) {
  var addr = AppState.addressCache[b.gstin] || AppState.addressCache[(b.gstin || '').toUpperCase()];
  return (addr && (addr.tradeName || addr.legalName)) || b.legalName || '';
}

/* ===== 2a. Bank Attachment — Covering Letter to Bank =====
   Matches the office's "Bank Attachment Reference to bank" letter format:
   a From/To letterhead table, a Sub/Ref block, then the statutory request
   to remit funds under Section 79(1)(c), with Form DRC-13 enclosed. */
function buildBankLetterDocx(b, cfg) {
  var tradeName = bankAttTradeName(b);
  var amountWords = numToWords(b.totalAmt) + ' Only';
  var fromText = wPara('From', { size: 10, spacingAfter: 20 })
    + wPara((cfg.officerName ? cfg.officerName + ',' : '') + '     ' + (cfg.desig || ''), { bold: true, size: 10, spacingAfter: 20 })
    + wPara(cfg.circle || '', { size: 10, spacingAfter: 20 })
    + wPara((cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), { size: 10, spacingAfter: 20 });
  var toText = wPara('To', { size: 10, spacingAfter: 20 })
    + wPara('THE BRANCH MANAGER,', { bold: true, size: 10, spacingAfter: 20 })
    + wPara((b.bankName || '—').toUpperCase(), { bold: true, size: 10, spacingAfter: 20 })
    + wPara('IFSC : ' + (b.ifsc || '—'), { size: 10, spacingAfter: 20 })
    + (b.branchAddr ? wPara(b.branchAddr, { size: 10, spacingAfter: 20 }) : '');

  var subText = 'GST Act, 2017 – ' + (cfg.circle || '') + ' – Tvl. ' + (b.legalName || '—') + ', GSTIN – ' + (b.gstin || '—')
    + ' – Arrear of Tax Rs. ' + fmt0(b.totalAmt) + ' – Arrears of Tax outstanding against the dealer – Form DRC-13 issued – Regarding.';

  var body = wPara('COMMERCIAL TAXES DEPARTMENT', { align: 'center', bold: true, size: 13, spacingAfter: 160 })
    + rawXmlTable2Col(fromText, toText, 4300, 5406)
    + wPara('GSTIN: ' + (b.gstin || '—') + '/' + (b.ref || '—') + '  dated: ' + fmtDate(b.date), { spacingAfter: 160 })
    + wPara('Sir / Madam,', { spacingAfter: 100 })
    + wTable([[{ text: 'Sub', bold: true }, subText], [{ text: 'Ref', bold: true }, 'This Office DRC-07 issued']], [900, 8806], { noBorder: true, noHeaderShade: true })
    + wPara('*******', { align: 'center', spacingAfter: 160 })
    + wPara('Tvl. ' + (b.legalName || '—') + (tradeName && tradeName !== b.legalName ? ' (' + tradeName + ')' : '') + ', having an Current Account / CC with your Bank, is an assessee on the file of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '') + ' and is in arrears of tax of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') under the GST Act.', { align: 'justify', spacingAfter: 120 })
    + wPara('Under Section 79(1)(c) of the SGST Act, 2017 read with Section 142(7)(a) of the SGST Act, 2017 & Rule 145(1) of the SGST Rules, 2017, you are required to remit to me forthwith the sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') from out of money you hold for or on account of the defaulter. If you do not hold money to that extent now, the amount available may be remitted now and the balance remitted as and when funds become available, as first charge to the Government. If the dealer is having an Overdraft account, you may require to remit the amount. A statutory demand notice in Form DRC-13 is enclosed.', { align: 'justify', spacingAfter: 120 })
    + wPara('You are also prohibited from paying any money to the assessee from the Current Account (or) Overdraft Account, till the above notice is withdrawn.', { align: 'justify', spacingAfter: 120 })
    + wPara('I request you to give the account balance as on today or on receiving the Form DRC-13, whichever is later.', { align: 'justify', spacingAfter: 120 })
    + wPara('The above mentioned demand amount or the amount available in the taxpayer bank account has to be issued as a Demand Draft or Bank Cheque in favour of the undersigned.', { align: 'justify', spacingAfter: 200 })
    + wPara('Encl: Form DRC-13.', { spacingAfter: 300 })
    + wPara('Date: ' + fmtDate(b.date), { spacingAfter: 20 })
    + wPara('Signature:', { spacingAfter: 200 })
    + wPara('Place : ' + (cfg.city || ''), { spacingAfter: 20 })
    + wPara('Name of Proper Officer: ' + (cfg.officerName || '_______________________'), { spacingAfter: 200 })
    + wPara('Designation: ' + (cfg.desig || ''), { spacingAfter: 20 })
    + wPara('Office Address: ' + (cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), { spacingAfter: 20 });
  return buildDocxBlob(body);
}

/* ===== 2b. Bank Attachment — Form GST DRC-13 (Rule 145(1)) =====
   The statutory "Notice to a third person under Section 79(1)(c)" served on
   the bank, matching the office's DRC-13 format exactly. */
function buildBankDrc13Docx(b, cfg) {
  var tradeName = bankAttTradeName(b);
  var d = demandRowsForBankDrc13(b.cases || []);
  var amountWords = numToWords(b.totalAmt) + ' Only';

  var body = wPara('FORM GST DRC – 13', { align: 'center', bold: true, size: 13, spacingAfter: 20 })
    + wPara('[See rule 145(1)]', { align: 'center', size: 10, spacingAfter: 20 })
    + wPara('Notice to a third person under section 79(1)(c)', { align: 'center', bold: true, size: 11, spacingAfter: 200 })
    + wPara('To', { spacingAfter: 20 })
    + wPara('THE BRANCH MANAGER,', { bold: true, spacingAfter: 20 })
    + wPara((b.bankName || '—').toUpperCase(), { bold: true, spacingAfter: 20 })
    + wPara('IFSC : ' + (b.ifsc || '—'), { spacingAfter: 160 })
    + wPara('Particulars of defaulter:-', { bold: true, spacingAfter: 60 })
    + wPara('A/c No.  ' + (b.accno || '—'), { spacingAfter: 20 })
    + wPara('PAN No.:-  ' + (b.pan || '—'), { spacingAfter: 20 })
    + wPara('GSTIN.  ' + (b.gstin || '—'), { spacingAfter: 20 })
    + wPara('Legal Name - ' + (b.legalName || '—'), { spacingAfter: 20 })
    + wPara('Trade Name- ' + (tradeName || '—'), { spacingAfter: 20 })
    + wPara('Demand order No: ', { spacingAfter: 160 })
    + wPara('Amount in Rs', { align: 'right', size: 9, spacingAfter: 60 })
    + wTable(d.rows, [1300, 1500, 1300, 700, 1000, 1000, 1000, 900, 1006])
    + wPara('Whereas a sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') on account of demand, is payable under the provisions of Sec 78 of the GST Act, 2017 by ' + (b.legalName || '—') + ', holding GSTIN: ' + (b.gstin || '—') + '. It is observed that a sum Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') is due or may become due to the said taxable person from you; or', { align: 'justify', spacingAfter: 80 })
    + wPara('It is observed that you hold or are likely to hold a sum Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') for or on account of the said person.', { align: 'justify', spacingAfter: 80 })
    + wPara('You are hereby directed to pay a sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') to the Government forthwith or upon the money becoming due or being held in compliance of the provisions contained in clause (c)(i) of sub-section (1) of section 79 of the Act.', { align: 'justify', spacingAfter: 120 })
    + wPara('Please note that any payment made by you in compliance of this notice will be deemed under section 79 of the Act to have been made under the authority of the said taxable person and the certificate from the government in FORM GST DRC-14 will constitute a good and sufficient discharge of your liability to such person to the extent of the amount specified in the certificate.', { align: 'justify', spacingAfter: 120 })
    + wPara('Also, please note that if you discharge any liability to the said taxable person after receipt of this notice, you will be personally liable to the State/Central Government under section 79 of the Act to the extent of the liability discharged, or to the extent of the liability of the taxable person for tax, cess, interest and penalty, whichever is less.', { align: 'justify', spacingAfter: 120 })
    + wPara('Please note that, in case you fail to make payment in pursuance of this notice, you shall be deemed to be a defaulter in respect of the amount specified in the notice and consequences of the Act or the rules made thereunder shall follow.', { align: 'justify', spacingAfter: 120 })
    + wPara('The above mentioned demand amount or the amount available in the taxpayer bank account has to be issued as a Demand Draft or Bank Cheque in favour of the undersigned.', { align: 'justify', spacingAfter: 300 })
    + wPara('Date: ' + fmtDate(b.date), { spacingAfter: 20 })
    + wPara('Signature:', { spacingAfter: 200 })
    + wPara('Place : ' + (cfg.city || ''), { spacingAfter: 20 })
    + wPara('Name of Proper Officer: ' + (cfg.officerName || '_______________________'), { spacingAfter: 200 })
    + wPara('Designation: ' + (cfg.desig || ''), { spacingAfter: 20 })
    + wPara('Office Address: ' + (cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), { spacingAfter: 20 });
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
