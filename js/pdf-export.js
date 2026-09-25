/* ===== Shared PDF export engine — one jsPDF layout toolkit, reused by every
   export, mirroring docx-export.js so the Word and PDF download of any given
   document always match. Every builder below goes through newA4Doc()/pdfPara()/
   pdfHeading()/pdfTable()/finishPdfDoc() instead of hand-rolling text/page-break
   logic — fix a formatting rule here and it applies to every document. ===== */

/* Mirrors the DOCX engine's asymmetric margins (wider left for filing/
   binding). Font stays "times" (a standard PDF font jsPDF ships with) rather
   than Bookman Old Style — jsPDF can only render a non-standard typeface if
   its font file is embedded, and Bookman Old Style is a licensed Windows/
   Office font this app has no rights to redistribute. The DOCX (the document
   that's actually signed and served) does carry the real "Bookman Old Style"
   font name and renders correctly wherever that font is installed; the PDF
   is a secondary/computer-generated copy. */
var PDF_MARGIN = 54;       // right/top/bottom — 0.75in
var PDF_MARGIN_LEFT = 63;  // left — 0.875in
var PDF_TOP = 56;
var PDF_LINE_HEIGHT = 14;
var PDF_FONT = 'times';
var PDF_BODY_SIZE = 10.5;

/* Creates the jsPDF document plus the small set of numbers every builder
   needs (page width, right edge, bottom-of-content line) so page geometry
   lives in one place instead of being recomputed per document. */
async function newA4Doc() {
  await window.LibsReady;
  var jsPDFCtor = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
  var doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
  var pageW = doc.internal.pageSize.getWidth();
  var pageH = doc.internal.pageSize.getHeight();
  doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(PDF_BODY_SIZE);
  return {
    doc: doc, pageW: pageW, pageH: pageH,
    marginX: PDF_MARGIN_LEFT, rightX: pageW - PDF_MARGIN,
    top: PDF_TOP, bottom: pageH - 64 /* leaves room for the footer page-number line */
  };
}

/* Adds a new page (resetting y to the top margin) only if the given amount
   of vertical space isn't available before the footer zone — the single
   page-break rule every builder shares instead of ad hoc "if (y > 720)"
   checks with a different magic number in each file. */
function pdfEnsureSpace(ctx, y, needed) {
  if (y + needed > ctx.bottom) { ctx.doc.addPage(); return ctx.top; }
  return y;
}

/* Wrapped paragraph with automatic keep-with-heading page-break handling.
   Every long/user-supplied text field (legal names, addresses, narratives)
   goes through this — never a bare doc.text() — so it always wraps to the
   page width instead of running off the right edge. */
function pdfPara(ctx, text, y, opts) {
  opts = opts || {};
  var doc = ctx.doc;
  var x = opts.x != null ? opts.x : ctx.marginX;
  var maxWidth = opts.maxWidth != null ? opts.maxWidth : (ctx.rightX - ctx.marginX);
  var lineHeight = opts.lineHeight || PDF_LINE_HEIGHT;
  doc.setFont(PDF_FONT, opts.bold ? 'bold' : (opts.italic ? 'italic' : 'normal'));
  doc.setFontSize(opts.size || PDF_BODY_SIZE);
  var lines = doc.splitTextToSize(String(text == null ? '' : text), maxWidth);
  var blockHeight = lines.length * lineHeight;
  y = pdfEnsureSpace(ctx, y, blockHeight);
  doc.text(lines, opts.align === 'right' ? ctx.rightX : (opts.align === 'center' ? ctx.pageW / 2 : x), y, opts.align ? { align: opts.align } : undefined);
  return y + blockHeight + (opts.spacingAfter != null ? opts.spacingAfter : 4);
}

/* Section heading — checks that the heading AND at least a little of what
   follows fit before the page break, so a title never lands as the very
   last line on a page with its content pushed to the next one. */
function pdfHeading(ctx, text, y, opts) {
  opts = opts || {};
  y = pdfEnsureSpace(ctx, y, (opts.size || 13) + 40);
  return pdfPara(ctx, text, y, Object.assign({ bold: true, size: 13, align: 'center', spacingAfter: 10 }, opts));
}

/* Thin wrapper around jspdf-autotable with this app's shared table look
   (Times New Roman, bordered "grid" theme for real data tables, "plain" for
   borderless Sub/Ref and From/To blocks) and a consistent content margin —
   autotable already repeats the header row and paginates a table across
   pages on its own, so no extra page-break bookkeeping is needed here. */
function pdfTable(ctx, opts) {
  opts.startY = opts.startY;
  var base = {
    theme: opts.theme || 'grid',
    styles: Object.assign({ font: PDF_FONT, fontSize: 9.5, cellPadding: 4, lineColor: [200, 211, 224], lineWidth: opts.theme === 'plain' ? 0 : 0.5 }, opts.styles || {}),
    headStyles: Object.assign({ fillColor: [237, 241, 247], textColor: [15, 23, 42], fontStyle: 'bold' }, opts.headStyles || {}),
    margin: { left: ctx.marginX, right: PDF_MARGIN },
    tableWidth: 'auto',
    rowPageBreak: 'avoid'
  };
  ctx.doc.autoTable(Object.assign(base, opts));
  return ctx.doc.lastAutoTable.finalY;
}

/* Stamps "Page X of Y" bottom-center on every page — called once, right
   before the finished doc is returned. Runs after all content exists so the
   total page count (Y) is known, then restores whichever page jsPDF was
   left on. */
function finishPdfDoc(ctx) {
  var doc = ctx.doc;
  var total = doc.internal.getNumberOfPages();
  for (var i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(204, 204, 204);
    doc.line(ctx.marginX, ctx.pageH - 46, ctx.rightX, ctx.pageH - 46);
    doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(102, 102, 102);
    doc.text('Page ' + i + ' of ' + total, ctx.pageW / 2, ctx.pageH - 32, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }
  return doc;
}

/* Shared From/To letterhead block used by the bank letters — two stacked
   text columns, each line wrapped, both starting at the same y so they line
   up like a real two-column letterhead instead of two independent text
   blocks that can drift apart. */
function pdfFromTo(ctx, y, fromLines, toLines) {
  var colW = (ctx.rightX - ctx.marginX - 20) / 2;
  var leftX = ctx.marginX, rightColX = ctx.marginX + colW + 20;
  var leftY = y, rightY = y;
  fromLines.forEach(function (l) {
    ctx.doc.setFont(PDF_FONT, l.bold ? 'bold' : 'normal'); ctx.doc.setFontSize(l.size || PDF_BODY_SIZE);
    var lines = ctx.doc.splitTextToSize(l.text, colW);
    ctx.doc.text(lines, leftX, leftY); leftY += lines.length * PDF_LINE_HEIGHT;
  });
  toLines.forEach(function (l) {
    ctx.doc.setFont(PDF_FONT, l.bold ? 'bold' : 'normal'); ctx.doc.setFontSize(l.size || PDF_BODY_SIZE);
    var lines = ctx.doc.splitTextToSize(l.text, colW);
    ctx.doc.text(lines, rightColX, rightY); rightY += lines.length * PDF_LINE_HEIGHT;
  });
  return Math.max(leftY, rightY) + 6;
}

/* Shared officer signature block (Designation / Circle / City), right
   aligned, with a page-break check so the three lines can't be split by a
   page boundary. */
function pdfSignatureBlock(ctx, y, cfg, opts) {
  opts = opts || {};
  y = pdfEnsureSpace(ctx, y, 3 * PDF_LINE_HEIGHT + 10);
  y = pdfPara(ctx, cfg.desig || '', y, { align: 'right', spacingAfter: 0 });
  y = pdfPara(ctx, (cfg.circle || '') + (opts.circleSuffix || ''), y, { align: 'right', spacingAfter: 0 });
  if (opts.showCity !== false) y = pdfPara(ctx, cfg.city || '', y, { align: 'right', spacingAfter: 0 });
  return y + (opts.spacingAfter != null ? opts.spacingAfter : 14);
}

/* Shared officer closing block for the two statutory bank letters. */
function pdfOfficerClosingBlock(ctx, y, b, cfg) {
  y = pdfEnsureSpace(ctx, y, 6 * PDF_LINE_HEIGHT + 40);
  y = pdfPara(ctx, 'Date: ' + fmtDate(b.date), y, { spacingAfter: 0 });
  y = pdfPara(ctx, 'Signature:', y, { spacingAfter: 16 });
  y = pdfPara(ctx, 'Place : ' + (cfg.city || ''), y, { spacingAfter: 0 });
  y = pdfPara(ctx, 'Name of Proper Officer: ' + (cfg.officerName || '_______________________'), y, { spacingAfter: 16 });
  y = pdfPara(ctx, 'Designation: ' + (cfg.desig || ''), y, { spacingAfter: 0 });
  y = pdfPara(ctx, 'Office Address: ' + (cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), y, { spacingAfter: 0 });
  return y;
}

/* Office masthead used by the notices that don't use the two-column
   letterhead (Third-Party, Property Attachment, Recovery Profile) — mirrors
   officeHeaderBlock() in docx-export.js. */
function pdfOfficeHeaderBlock(ctx, y, cfg) {
  y = pdfPara(ctx, 'OFFICE OF THE ' + (cfg.desig || '').toUpperCase(), y, { align: 'center', bold: true, size: 12, spacingAfter: 2 });
  y = pdfPara(ctx, cfg.circle || '', y, { align: 'center', bold: true, size: 12, spacingAfter: 2 });
  y = pdfPara(ctx, (cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), y, { align: 'center', size: 10, spacingAfter: 12 });
  return y;
}

/* ===== 1. Arrear Notice (Intimation / Urgent) =====
   Mirrors buildNoticeDocx() in docx-export.js. Builds the jsPDF document
   object without saving it, so both the single-notice download
   (generateNoticePDF) and the bulk ZIP export (buildNoticePdfBlob) share one
   layout implementation. */
async function buildNoticePdfDoc(notice, cfg) {
  var ctx = await newA4Doc();
  var doc = ctx.doc;
  var isUrgent = notice.noticeKind === 'urgent';
  var legalName = notice.legalName || '—';
  var gstin = notice.gstin || '—';
  var y = ctx.top;

  y = pdfPara(ctx, 'Office of the ' + (cfg.desig || ''), y, { align: 'right', bold: true, size: 11, spacingAfter: 0 });
  y = pdfPara(ctx, cfg.circle || '', y, { align: 'right', bold: true, size: 11, spacingAfter: 0 });
  y = pdfPara(ctx, cfg.addr1 || '', y, { align: 'right', size: 10, spacingAfter: 0 });
  y = pdfPara(ctx, cfg.addr2 || '', y, { align: 'right', size: 10, spacingAfter: 14 });

  var noticeNoY = y;
  pdfPara(ctx, 'Notice No: ' + (notice.num || '—'), noticeNoY, { spacingAfter: 0 });
  y = pdfPara(ctx, 'Dated : ' + fmtDateDot(notice.date), noticeNoY, { align: 'right', spacingAfter: 14 });

  y = pdfHeading(ctx, isUrgent ? 'URGENT NOTICE' : 'INTIMATION NOTICE', y, { spacingAfter: 4 });
  y = pdfPara(ctx, 'NON-PAYMENT OF GST ARREARS', y, { align: 'center', bold: true, size: 11, spacingAfter: 14 });

  y = pdfPara(ctx, 'To', y, { spacingAfter: 2 });
  y = pdfTable(ctx, {
    startY: y,
    body: [['GSTIN', ': ' + gstin], ['Legal Name of the Business', ': ' + legalName]],
    theme: 'plain'
  }) + 8;

  var subText = 'TNGST Act 2017 – ' + (cfg.circle || '') + ' – Tvl.' + legalName + ', GSTIN : ' + gstin
    + ' - Arrears of Tax outstanding – ' + (isUrgent ? 'Urgent' : 'Intimation') + ' Notice issued – Regarding.';
  var refText = isUrgent ? 'This Office DRC-07 issued' : 'Statutory Orders issued in form DRC 07';
  y = pdfTable(ctx, {
    startY: y,
    body: [
      [{ content: 'Sub', styles: { fontStyle: 'bold' } }, subText],
      [{ content: 'Ref', styles: { fontStyle: 'bold' } }, refText]
    ],
    theme: 'plain',
    columnStyles: { 0: { cellWidth: 35 } }
  }) + 10;

  y = pdfPara(ctx, '*******', y, { align: 'center', spacingAfter: 6 });
  y = pdfPara(ctx, 'Tvl.' + legalName + ', registered with the office of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '')
    + ' is hereby informed they are in arrears of Goods and Services Tax as detailed below:', y, { spacingAfter: 8 });

  var rows = (notice.cases || []).map(function (c) {
    return [c.taxPeriod || '—', c.demandId || '—', fmtDate(c.dcr_date || c.demandDate),
      fmt0(c.pend_igst), fmt0(c.pend_cgst), fmt0(c.pend_sgst), fmt0(c.pend_cess), fmt0(c.pend_total)];
  });
  var sums = (notice.cases || []).reduce(function (s, c) {
    s.igst += Number(c.pend_igst) || 0; s.cgst += Number(c.pend_cgst) || 0; s.sgst += Number(c.pend_sgst) || 0;
    s.cess += Number(c.pend_cess) || 0; s.total += Number(c.pend_total) || 0;
    return s;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 });
  rows.push([
    { content: 'TOTAL', styles: { fontStyle: 'bold' } }, '', '',
    { content: fmt0(sums.igst), styles: { fontStyle: 'bold' } }, { content: fmt0(sums.cgst), styles: { fontStyle: 'bold' } },
    { content: fmt0(sums.sgst), styles: { fontStyle: 'bold' } }, { content: fmt0(sums.cess), styles: { fontStyle: 'bold' } },
    { content: fmt0(sums.total), styles: { fontStyle: 'bold' } }
  ]);
  y = pdfTable(ctx, {
    startY: y,
    head: [['ASSESSMENT YEAR', 'DEMAND ID', 'DATE OF DEMAND ORDER', 'IGST', 'CGST', 'SGST', 'CESS', 'TOTAL']],
    body: rows,
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } }
  }) + 12;

  y = pdfPara(ctx, '(AMOUNT IN RS)', y, { align: 'right', size: 8, spacingAfter: 4 });
  y = pdfPara(ctx, 'Total Amount Payable: Rs. ' + fmt0(sums.total) + ' (Rupees ' + numToWords(sums.total) + ' Only)', y, { bold: true, spacingAfter: 8 });
  if (notice.details) y = pdfPara(ctx, 'Remarks: ' + notice.details, y, { spacingAfter: 8 });

  var leadIn = isUrgent
    ? 'The Taxpayer is informed that the arrears have not been paid even after the expiry of 90 days from the date of the order. If the above amount is not paid immediately on receipt of this notice, recovery action will be initiated to realise the arrears in accordance with the provisions of the GST Act, 2017 by:'
    : 'The taxpayer is hereby informed that arrears are pending. If the arrears remain unpaid after the expiry of 90 days from the date of the order and no appeal has been filed, recovery action will be initiated to realise the dues in accordance with the provisions of the GST Act, 2017, by:';
  y = pdfPara(ctx, leadIn, y, { spacingAfter: 6 });

  noticeActionList.forEach(function (t) { y = pdfPara(ctx, '•  ' + t, y, { spacingAfter: 2 }); });
  y += 8;

  y = pdfPara(ctx, 'Payment Gateway:', y, { bold: true, spacingAfter: 2 });
  y = pdfPara(ctx, 'The Taxpayer is advised to pay the above said arrears through GSTIN Portal by selecting the option "Payment towards demand".', y, { spacingAfter: 10 });

  y = pdfPara(ctx, 'Note:', y, { bold: true, spacingAfter: 2 });
  [
    'If the tax has already been paid, you are requested to submit the payment details to this office immediately, otherwise it will be presumed that the balance still exists.',
    'If the case is pending before any appellate forum, you are requested to submit the details to this office immediately.',
    'Other than above no representation, in person or through postal.'
  ].forEach(function (t) { y = pdfPara(ctx, '•  ' + t, y, { spacingAfter: 2 }); });
  y += 14;

  y = pdfSignatureBlock(ctx, y, cfg, { spacingAfter: 20 });

  y = pdfEnsureSpace(ctx, y, 3 * PDF_LINE_HEIGHT + 10);
  y = pdfPara(ctx, 'To,', y, { spacingAfter: 0 });
  y = pdfPara(ctx, legalName, y, { bold: true, spacingAfter: 0 });
  if (notice.address) y = pdfPara(ctx, notice.address, y, { spacingAfter: 0 });

  return finishPdfDoc(ctx);
}

async function generateNoticePDF(notice, cfg) {
  var doc = await buildNoticePdfDoc(notice, cfg);
  doc.save((notice.num || 'notice').replace(/[\/\\]/g, '_') + '.pdf');
}

async function buildNoticePdfBlob(notice, cfg) {
  var doc = await buildNoticePdfDoc(notice, cfg);
  return doc.output('blob');
}

/* ===== Bank Attachment — Covering Letter to Bank (PDF) =====
   Mirrors buildBankLetterDocx() in docx-export.js. */
async function buildBankLetterPdfDoc(b, cfg) {
  var ctx = await newA4Doc();
  var tradeName = bankAttTradeName(b);
  var amountWords = numToWords(b.totalAmt) + ' Only';
  var y = ctx.top;

  y = pdfHeading(ctx, 'COMMERCIAL TAXES DEPARTMENT', y, { spacingAfter: 14 });

  y = pdfFromTo(ctx, y,
    [
      { text: 'From', bold: false },
      { text: (cfg.officerName ? cfg.officerName + ',' : '') + ' ' + (cfg.desig || ''), bold: true },
      { text: cfg.circle || '' },
      { text: (cfg.addr1 || '') + ' ' + (cfg.addr2 || '') }
    ],
    [
      { text: 'To', bold: false },
      { text: 'THE BRANCH MANAGER,', bold: true },
      { text: (b.bankName || '—').toUpperCase(), bold: true },
      { text: 'IFSC : ' + (b.ifsc || '—') }
    ].concat(b.branchAddr ? [{ text: b.branchAddr }] : [])
  );

  y = pdfPara(ctx, 'GSTIN: ' + (b.gstin || '—') + '/' + (b.ref || '—') + '  dated: ' + fmtDate(b.date), y, { spacingAfter: 10 });
  y = pdfPara(ctx, 'Sir / Madam,', y, { spacingAfter: 4 });

  var subText = 'GST Act, 2017 – ' + (cfg.circle || '') + ' – Tvl. ' + (b.legalName || '—') + ', GSTIN – ' + (b.gstin || '—')
    + ' – Arrear of Tax Rs. ' + fmt0(b.totalAmt) + ' – Arrears of Tax outstanding against the dealer – Form DRC-13 issued – Regarding.';
  y = pdfTable(ctx, {
    startY: y,
    body: [
      [{ content: 'Sub', styles: { fontStyle: 'bold' } }, subText],
      [{ content: 'Ref', styles: { fontStyle: 'bold' } }, 'This Office DRC-07 issued']
    ],
    theme: 'plain',
    columnStyles: { 0: { cellWidth: 35 } }
  }) + 10;

  y = pdfPara(ctx, '*******', y, { align: 'center', spacingAfter: 6 });

  var paras = [
    'Tvl. ' + (b.legalName || '—') + (tradeName && tradeName !== b.legalName ? ' (' + tradeName + ')' : '') + ', having an Current Account / CC with your Bank, is an assessee on the file of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '') + ' and is in arrears of tax of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') under the GST Act.',
    'Under Section 79(1)(c) of the SGST Act, 2017 read with Section 142(7)(a) of the SGST Act, 2017 & Rule 145(1) of the SGST Rules, 2017, you are required to remit to me forthwith the sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') from out of money you hold for or on account of the defaulter. If you do not hold money to that extent now, the amount available may be remitted now and the balance remitted as and when funds become available, as first charge to the Government. If the dealer is having an Overdraft account, you may require to remit the amount. A statutory demand notice in Form DRC-13 is enclosed.',
    'You are also prohibited from paying any money to the assessee from the Current Account (or) Overdraft Account, till the above notice is withdrawn.',
    'I request you to give the account balance as on today or on receiving the Form DRC-13, whichever is later.',
    'The above mentioned demand amount or the amount available in the taxpayer bank account has to be issued as a Demand Draft or Bank Cheque in favour of the undersigned.'
  ];
  paras.forEach(function (t) { y = pdfPara(ctx, t, y, { spacingAfter: 8 }); });

  y = pdfPara(ctx, 'Encl: Form DRC-13.', y, { spacingAfter: 20 });
  y = pdfOfficerClosingBlock(ctx, y, b, cfg);

  return finishPdfDoc(ctx);
}

async function generateBankLetterPDF(b, cfg) {
  var doc = await buildBankLetterPdfDoc(b, cfg);
  doc.save((b.ref || 'bank_letter').replace(/[\/\\]/g, '_') + '_Letter.pdf');
}

/* ===== Bank Attachment — Release Order (PDF) =====
   Mirrors buildBankReleaseDocx() in docx-export.js. */
async function buildBankReleasePdfDoc(b, cfg) {
  var ctx = await newA4Doc();
  var isTemporary = RELEASE_TEMPORARY_REASONS.indexOf(b.releasedReason) !== -1;
  var y = ctx.top;

  y = pdfHeading(ctx, 'COMMERCIAL TAXES DEPARTMENT', y, { spacingAfter: 14 });

  y = pdfFromTo(ctx, y,
    [
      { text: 'From' },
      { text: (cfg.officerName ? cfg.officerName + ', ' : '') + (cfg.desig || ''), bold: true },
      { text: cfg.circle || '' },
      { text: cfg.city || '' }
    ],
    [
      { text: 'To' },
      { text: 'The Branch Manager', bold: true },
      { text: b.bankName || '—', bold: true }
    ].concat(b.branchAddr ? [{ text: b.branchAddr }] : [])
  );

  y = pdfPara(ctx, 'GSTIN: ' + (b.gstin || '—') + '/ dated: ' + fmtDate(b.releasedDate || todayISO()), y, { spacingAfter: 10 });
  y = pdfPara(ctx, 'Sir/Madam,', y, { spacingAfter: 4 });

  var subText = 'GST Act 2017 – Tvl. ' + (b.legalName || '—') + ' - Payment of GST Arrear - Arrears of Tax Recovery Under Section 145(1) – Notice in DRC-13 issued – Attachment ' + (isTemporary ? 'Temporarily Withdrawn' : 'Released') + ' - Regarding.';
  var refText = 'This office Ref in GSTIN. ' + (b.gstin || '—') + ', dt.' + fmtDate(b.date) + '.'
    + (b.releasedPetitionDate ? ' The Taxpayer\'s Petition Dated: ' + fmtDate(b.releasedPetitionDate) + '.' : '');
  y = pdfTable(ctx, {
    startY: y,
    body: [
      [{ content: 'Sub:-', styles: { fontStyle: 'bold' } }, subText],
      [{ content: 'Ref:', styles: { fontStyle: 'bold' } }, refText]
    ],
    theme: 'plain',
    columnStyles: { 0: { cellWidth: 35 } }
  }) + 10;

  y = pdfPara(ctx, '*********', y, { align: 'center', spacingAfter: 6 });

  var narrative = 'Tvl. ' + (b.legalName || '—') + ' doing business at ' + (b.releasedAddr || '—').replace(/\.+\s*$/, '') + '. ' + (b.releasedNarrative || '');
  y = pdfPara(ctx, narrative, y, { spacingAfter: 8 });

  var closing = isTemporary
    ? 'In view of the above, the Bank Attachment issued by this circle in the reference 1st cited is temporarily withdrawn and all action (lien, freeze, etc.) that has been imposed to withhold the account may be withdrawn.'
    : 'In view of the above, the Bank Attachment issued by this circle in the reference 1st cited is released and all action (lien, freeze, etc.) that has been imposed to withhold the account may be withdrawn.';
  y = pdfPara(ctx, closing, y, { spacingAfter: 20 });

  y = pdfSignatureBlock(ctx, y, cfg, { showCity: false, circleSuffix: '.', spacingAfter: 20 });

  y = pdfEnsureSpace(ctx, y, 3 * PDF_LINE_HEIGHT);
  y = pdfPara(ctx, 'Copy to: ', y, { spacingAfter: 0 });
  y = pdfPara(ctx, b.legalName || '—', y, { spacingAfter: 0 });
  y = pdfPara(ctx, b.releasedAddr || '—', y, { spacingAfter: 0 });

  return finishPdfDoc(ctx);
}

async function generateBankReleasePDF(b, cfg) {
  var doc = await buildBankReleasePdfDoc(b, cfg);
  doc.save((b.ref || 'bank_release').replace(/[\/\\]/g, '_') + '_Release.pdf');
}

/* ===== Bank Attachment — Form GST DRC-13 (PDF) =====
   Mirrors buildBankDrc13Docx() in docx-export.js. */
async function buildBankDrc13PdfDoc(b, cfg) {
  var ctx = await newA4Doc();
  var tradeName = bankAttTradeName(b);
  var amountWords = numToWords(b.totalAmt) + ' Only';
  var y = ctx.top;

  y = pdfHeading(ctx, 'FORM GST DRC – 13', y, { size: 13, spacingAfter: 6 });
  y = pdfPara(ctx, '[See rule 145(1)]', y, { align: 'center', spacingAfter: 4 });
  y = pdfPara(ctx, 'Notice to a third person under section 79(1)(c)', y, { align: 'center', bold: true, spacingAfter: 16 });

  y = pdfEnsureSpace(ctx, y, 4 * PDF_LINE_HEIGHT);
  y = pdfPara(ctx, 'To', y, { spacingAfter: 0 });
  y = pdfPara(ctx, 'THE BRANCH MANAGER,', y, { bold: true, spacingAfter: 0 });
  y = pdfPara(ctx, (b.bankName || '—').toUpperCase(), y, { bold: true, spacingAfter: 0 });
  y = pdfPara(ctx, 'IFSC : ' + (b.ifsc || '—'), y, { spacingAfter: 12 });

  y = pdfEnsureSpace(ctx, y, 7 * PDF_LINE_HEIGHT);
  y = pdfPara(ctx, 'Particulars of defaulter:-', y, { bold: true, spacingAfter: 0 });
  [
    'A/c No.  ' + (b.accno || '—'),
    'PAN No.:-  ' + (b.pan || '—'),
    'GSTIN.  ' + (b.gstin || '—'),
    'Legal Name - ' + (b.legalName || '—'),
    'Trade Name- ' + (tradeName || '—'),
    'Demand order No: '
  ].forEach(function (t) { y = pdfPara(ctx, t, y, { spacingAfter: 0 }); });
  y += 6;

  y = pdfPara(ctx, '(AMOUNT IN RS)', y, { align: 'right', size: 8, spacingAfter: 2 });

  var rows = (b.cases || []).map(function (c) {
    return [c.fy || '—', c.demandId || '—', fmtDate(c.dcr_date || c.demandDate), c.section || '—',
      fmt0(c.pend_igst), fmt0(c.pend_cgst), fmt0(c.pend_sgst), fmt0(c.pend_cess), fmt0(c.pend_total)];
  });
  var sums = (b.cases || []).reduce(function (s, c) {
    s.igst += Number(c.pend_igst) || 0; s.cgst += Number(c.pend_cgst) || 0; s.sgst += Number(c.pend_sgst) || 0;
    s.cess += Number(c.pend_cess) || 0; s.total += Number(c.pend_total) || 0;
    return s;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 });
  rows.push([
    { content: 'TOTAL', styles: { fontStyle: 'bold' } }, '', '', '',
    { content: fmt0(sums.igst), styles: { fontStyle: 'bold' } }, { content: fmt0(sums.cgst), styles: { fontStyle: 'bold' } },
    { content: fmt0(sums.sgst), styles: { fontStyle: 'bold' } }, { content: fmt0(sums.cess), styles: { fontStyle: 'bold' } },
    { content: fmt0(sums.total), styles: { fontStyle: 'bold' } }
  ]);
  y = pdfTable(ctx, {
    startY: y,
    head: [['ASSESSMENT YEAR', 'DEMAND ID', 'DATE OF DEMAND ORDER', 'SEC', 'IGST', 'CGST', 'SGST', 'CESS', 'TOTAL']],
    body: rows,
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }
  }) + 12;

  var paras = [
    'Whereas a sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') on account of demand, is payable under the provisions of Sec 78 of the GST Act, 2017 by ' + (b.legalName || '—') + ', holding GSTIN: ' + (b.gstin || '—') + '. It is observed that a sum Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') is due or may become due to the said taxable person from you; or',
    'It is observed that you hold or are likely to hold a sum Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') for or on account of the said person.',
    'You are hereby directed to pay a sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') to the Government forthwith or upon the money becoming due or being held in compliance of the provisions contained in clause (c)(i) of sub-section (1) of section 79 of the Act.',
    'Please note that any payment made by you in compliance of this notice will be deemed under section 79 of the Act to have been made under the authority of the said taxable person and the certificate from the government in FORM GST DRC-14 will constitute a good and sufficient discharge of your liability to such person to the extent of the amount specified in the certificate.',
    'Also, please note that if you discharge any liability to the said taxable person after receipt of this notice, you will be personally liable to the State/Central Government under section 79 of the Act to the extent of the liability discharged, or to the extent of the liability of the taxable person for tax, cess, interest and penalty, whichever is less.',
    'Please note that, in case you fail to make payment in pursuance of this notice, you shall be deemed to be a defaulter in respect of the amount specified in the notice and consequences of the Act or the rules made thereunder shall follow.',
    'The above mentioned demand amount or the amount available in the taxpayer bank account has to be issued as a Demand Draft or Bank Cheque in favour of the undersigned.'
  ];
  paras.forEach(function (t) { y = pdfPara(ctx, t, y, { spacingAfter: 8 }); });

  y = pdfOfficerClosingBlock(ctx, y, b, cfg);
  return finishPdfDoc(ctx);
}

async function generateBankDrc13PDF(b, cfg) {
  var doc = await buildBankDrc13PdfDoc(b, cfg);
  doc.save((b.ref || 'bank_drc13').replace(/[\/\\]/g, '_') + '_DRC13.pdf');
}

/* ===== Third-Party (Debtor) Notice — DRC-13 style (PDF) =====
   Mirrors buildThirdPartyDocx() in docx-export.js. */
async function buildThirdPartyPdfDoc(tp, cfg) {
  var ctx = await newA4Doc();
  var y = ctx.top;

  y = pdfOfficeHeaderBlock(ctx, y, cfg);
  y = pdfHeading(ctx, 'FORM GST DRC-13', y, { spacingAfter: 4 });
  y = pdfPara(ctx, 'Notice to a Third Person under Section 79(1)(c)', y, { align: 'center', size: 11, spacingAfter: 14 });

  y = pdfEnsureSpace(ctx, y, 5 * PDF_LINE_HEIGHT);
  y = pdfPara(ctx, 'To,', y, { spacingAfter: 0 });
  y = pdfPara(ctx, tp.debtorLegal || '—', y, { bold: true, spacingAfter: 0 });
  if (tp.debtorTrade) y = pdfPara(ctx, tp.debtorTrade, y, { spacingAfter: 0 });
  if (tp.debtorGstin) y = pdfPara(ctx, 'GSTIN: ' + tp.debtorGstin, y, { spacingAfter: 0 });
  if (tp.debtorAddr) y = pdfPara(ctx, tp.debtorAddr, y, { spacingAfter: 0 });
  y += 10;

  y = pdfPara(ctx, 'Whereas ' + (tp.legalName || tp.defaulterGstin) + ' (GSTIN: ' + (tp.defaulterGstin || '—') + ') has failed to pay the tax dues detailed below, and whereas it appears that you owe / hold money for or on account of the said defaulter, you are hereby required, under Section 79(1)(c) of the GST Act, to pay to the Government the amount due to the defaulter, or up to the amount specified below, whichever is less.', y, { spacingAfter: 10 });

  var d = demandRowsForDocx(tp.cases || []);
  y = pdfTable(ctx, {
    startY: y,
    head: [d.rows[0]],
    body: d.rows.slice(1).map(function (r) { return r.map(function (c) { return typeof c === 'object' ? c.text : c; }); }),
    columnStyles: { 4: { halign: 'right' } }
  }) + 12;

  y = pdfPara(ctx, 'Amount to be paid: Rs. ' + fmt0(d.total), y, { bold: true, spacingAfter: 20 });
  y = pdfSignatureBlock(ctx, y, cfg, { showCity: false });

  return finishPdfDoc(ctx);
}

async function generateThirdPartyPDF(tp, cfg) {
  var doc = await buildThirdPartyPdfDoc(tp, cfg);
  doc.save(('DRC13_' + (tp.defaulterGstin || 'notice')).replace(/[\/\\]/g, '_') + '.pdf');
}

async function buildThirdPartyPdfBlob(tp, cfg) {
  var doc = await buildThirdPartyPdfDoc(tp, cfg);
  return doc.output('blob');
}

/* ===== Property Attachment Order — Section 79(d) (PDF) =====
   Mirrors buildPropertyAttachmentDocx() in docx-export.js. */
async function buildPropertyAttachmentPdfDoc(pa, cfg) {
  var ctx = await newA4Doc();
  var y = ctx.top;

  y = pdfOfficeHeaderBlock(ctx, y, cfg);
  y = pdfHeading(ctx, 'ORDER OF ATTACHMENT OF PROPERTY', y, { spacingAfter: 4 });
  y = pdfPara(ctx, 'under Section 79(1)(d) of the GST Act', y, { align: 'center', size: 11, spacingAfter: 14 });

  y = pdfPara(ctx, 'Defaulter: ' + (pa.legalName || '—') + '   GSTIN: ' + (pa.gstin || '—'), y, { bold: true, spacingAfter: 10 });
  y = pdfPara(ctx, 'Whereas the amounts detailed below remain outstanding and unpaid, and recovery by other modes has not been effective, the movable/immovable property described below, belonging to the above defaulter, is hereby attached in exercise of powers under Section 79(1)(d) of the GST Act, until the outstanding dues are discharged in full.', y, { spacingAfter: 10 });

  var d = demandRowsForDocx(pa.cases || []);
  y = pdfTable(ctx, {
    startY: y,
    head: [d.rows[0]],
    body: d.rows.slice(1).map(function (r) { return r.map(function (c) { return typeof c === 'object' ? c.text : c; }); }),
    columnStyles: { 4: { halign: 'right' } }
  }) + 12;

  y = pdfEnsureSpace(ctx, y, 3 * PDF_LINE_HEIGHT);
  y = pdfPara(ctx, 'Property Description: ' + (pa.propertyDescription || '—'), y, { spacingAfter: 0 });
  y = pdfPara(ctx, 'Location / Survey No.: ' + (pa.propertyLocation || '—'), y, { spacingAfter: 0 });
  y = pdfPara(ctx, 'Estimated Value: Rs. ' + fmt0(pa.propertyValue), y, { spacingAfter: 20 });

  y = pdfSignatureBlock(ctx, y, cfg, { showCity: false });
  return finishPdfDoc(ctx);
}

async function generatePropertyAttachmentPDF(pa, cfg) {
  var doc = await buildPropertyAttachmentPdfDoc(pa, cfg);
  doc.save(('PropertyAttachment_' + (pa.gstin || 'order')).replace(/[\/\\]/g, '_') + '.pdf');
}

async function buildPropertyAttachmentPdfBlob(pa, cfg) {
  var doc = await buildPropertyAttachmentPdfDoc(pa, cfg);
  return doc.output('blob');
}

/* ===== Recovery Profile dossier (PDF) =====
   Mirrors buildRecoveryProfileDocx() in docx-export.js. */
async function buildRecoveryProfilePdfDoc(gstin, summary, cfg) {
  var ctx = await newA4Doc();
  var y = ctx.top;

  y = pdfOfficeHeaderBlock(ctx, y, cfg);
  y = pdfHeading(ctx, 'RECOVERY PROFILE', y, { spacingAfter: 10 });
  y = pdfPara(ctx, summary.legalName || '—', y, { bold: true, spacingAfter: 0 });
  y = pdfPara(ctx, 'GSTIN: ' + gstin, y, { spacingAfter: 10 });

  y = pdfTable(ctx, {
    startY: y,
    head: [['Metric', 'Value']],
    body: [
      ['Total Original Demand', fmt0(summary.origTotal)],
      ['Total Pending', fmt0(summary.pendTotal)],
      ['Number of Demands', String(summary.demandCount)],
      ['Notices Issued', String(summary.noticeCount)],
      ['Bank Attachments', String(summary.bankCount)],
      ['Recorded Collections', fmt0(summary.recoveredTotal)]
    ],
    columnStyles: { 1: { halign: 'right' } }
  }) + 20;

  y = pdfSignatureBlock(ctx, y, cfg, { showCity: false });
  return finishPdfDoc(ctx);
}

async function generateRecoveryProfilePDF(gstin, summary, cfg) {
  var doc = await buildRecoveryProfilePdfDoc(gstin, summary, cfg);
  doc.save(('RecoveryProfile_' + gstin).replace(/[\/\\]/g, '_') + '.pdf');
}
