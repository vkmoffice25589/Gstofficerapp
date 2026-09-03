/* ===== PDF export via jsPDF + autotable — mirrors buildNoticeDocx() in docx-export.js
   so the PDF and Word downloads of a notice always match the office's official format. ===== */

/* Builds the jsPDF document object without saving it, so both the single-notice
   download (generateNoticePDF) and the bulk ZIP export (buildNoticePdfBlob) share
   one layout implementation. */
async function buildNoticePdfDoc(notice, cfg) {
  await window.LibsReady;
  var jsPDFCtor = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
  var doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
  var pageW = doc.internal.pageSize.getWidth();
  var marginX = 50, rightX = pageW - 50;
  var isUrgent = notice.noticeKind === 'urgent';
  var legalName = notice.legalName || '—';
  var gstin = notice.gstin || '—';
  var y = 50;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Office of the ' + (cfg.desig || ''), rightX, y, { align: 'right' }); y += 14;
  doc.text(cfg.circle || '', rightX, y, { align: 'right' }); y += 14;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(cfg.addr1 || '', rightX, y, { align: 'right' }); y += 12;
  doc.text(cfg.addr2 || '', rightX, y, { align: 'right' }); y += 22;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Notice No: ' + (notice.num || '—'), marginX, y);
  doc.text('Dated : ' + fmtDateDot(notice.date), rightX, y, { align: 'right' }); y += 24;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(isUrgent ? 'URGENT NOTICE' : 'INTIMATION NOTICE', pageW / 2, y, { align: 'center' }); y += 16;
  doc.setFontSize(11);
  doc.text('NON-PAYMENT OF GST ARREARS', pageW / 2, y, { align: 'center' }); y += 20;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('To', marginX, y); y += 4;

  doc.autoTable({
    startY: y,
    body: [['GSTIN', ': ' + gstin], ['Legal Name of the Business', ': ' + legalName]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2 },
    margin: { left: marginX, right: 50 }
  });
  y = doc.lastAutoTable.finalY + 8;

  var subText = 'TNGST Act 2017 – ' + (cfg.circle || '') + ' – Tvl.' + legalName + ', GSTIN : ' + gstin
    + ' - Arrears of Tax outstanding – ' + (isUrgent ? 'Urgent' : 'Intimation') + ' Notice issued – Regarding.';
  var refText = isUrgent ? 'This Office DRC-07 issued' : 'Statutory Orders issued in form DRC 07';

  doc.autoTable({
    startY: y,
    body: [
      [{ content: 'Sub', styles: { fontStyle: 'bold' } }, subText],
      [{ content: 'Ref', styles: { fontStyle: 'bold' } }, refText]
    ],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 35 } },
    margin: { left: marginX, right: 50 }
  });
  y = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(10);
  doc.text('*******', pageW / 2, y, { align: 'center' }); y += 16;

  var opening = 'Tvl.' + legalName + ', registered with the office of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '')
    + ' is hereby informed they are in arrears of Goods and Services Tax as detailed below:';
  var openingLines = doc.splitTextToSize(opening, rightX - marginX);
  doc.text(openingLines, marginX, y); y += openingLines.length * 12 + 8;

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

  doc.autoTable({
    startY: y,
    head: [['ASSESSMENT YEAR', 'DEMAND ID', 'DATE OF DEMAND ORDER', 'IGST', 'CGST', 'SGST', 'CESS', 'TOTAL']],
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [31, 78, 121], textColor: 255 },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    margin: { left: marginX, right: 50 }
  });
  y = doc.lastAutoTable.finalY + 14;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('(AMOUNT IN RS)', rightX, y, { align: 'right' }); y += 16;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  var payableLine = 'Total Amount Payable: Rs. ' + fmt0(sums.total) + ' (Rupees ' + numToWords(sums.total) + ' Only)';
  var payableLines = doc.splitTextToSize(payableLine, rightX - marginX);
  doc.text(payableLines, marginX, y); y += payableLines.length * 13 + 6;
  if (notice.details) {
    doc.setFont('helvetica', 'normal');
    var remarkLines = doc.splitTextToSize('Remarks: ' + notice.details, rightX - marginX);
    doc.text(remarkLines, marginX, y); y += remarkLines.length * 12 + 8;
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  var leadIn = isUrgent
    ? 'The Taxpayer is informed that the arrears have not been paid even after the expiry of 90 days from the date of the order. If the above amount is not paid immediately on receipt of this notice, recovery action will be initiated to realise the arrears in accordance with the provisions of the GST Act, 2017 by:'
    : 'The taxpayer is hereby informed that arrears are pending. If the arrears remain unpaid after the expiry of 90 days from the date of the order and no appeal has been filed, recovery action will be initiated to realise the dues in accordance with the provisions of the GST Act, 2017, by:';
  var leadInLines = doc.splitTextToSize(leadIn, rightX - marginX);
  doc.text(leadInLines, marginX, y); y += leadInLines.length * 11 + 6;

  noticeActionList.forEach(function (t) {
    var lines = doc.splitTextToSize('•  ' + t, rightX - marginX);
    doc.text(lines, marginX, y); y += lines.length * 11 + 2;
  });
  y += 10;

  doc.setFont('helvetica', 'bold'); doc.text('Payment Gateway:', marginX, y); y += 14;
  doc.setFont('helvetica', 'normal');
  var payLines = doc.splitTextToSize('The Taxpayer is advised to pay the above said arrears through GSTIN Portal by selecting the option "Payment towards demand".', rightX - marginX);
  doc.text(payLines, marginX, y); y += payLines.length * 11 + 10;

  doc.setFont('helvetica', 'bold'); doc.text('Note:', marginX, y); y += 14;
  doc.setFont('helvetica', 'normal');
  [
    'If the tax has already been paid, you are requested to submit the payment details to this office immediately, otherwise it will be presumed that the balance still exists.',
    'If the case is pending before any appellate forum, you are requested to submit the details to this office immediately.',
    'Other than above no representation, in person or through postal.'
  ].forEach(function (t) {
    var lines = doc.splitTextToSize('•  ' + t, rightX - marginX);
    doc.text(lines, marginX, y); y += lines.length * 11 + 2;
  });
  y += 16;

  if (y > 720) { doc.addPage(); y = 50; }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(cfg.desig || '', rightX, y, { align: 'right' }); y += 14;
  doc.text(cfg.circle || '', rightX, y, { align: 'right' }); y += 14;
  doc.text(cfg.city || '', rightX, y, { align: 'right' }); y += 28;

  doc.text('To,', marginX, y); y += 14;
  doc.setFont('helvetica', 'bold'); doc.text(legalName, marginX, y); y += 14;
  doc.setFont('helvetica', 'normal');
  if (notice.address) doc.text(notice.address, marginX, y);

  return doc;
}

async function generateNoticePDF(notice, cfg) {
  var doc = await buildNoticePdfDoc(notice, cfg);
  doc.save((notice.num || 'notice').replace(/[\/\\]/g, '_') + '.pdf');
}

async function buildNoticePdfBlob(notice, cfg) {
  var doc = await buildNoticePdfDoc(notice, cfg);
  return doc.output('blob');
}
