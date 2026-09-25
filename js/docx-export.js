/* ===== Shared Word (.docx) export engine — one OOXML builder, reused by every export =====

   Every generated notice/order/letter in this app funnels through the four
   primitives below (wPara, wTable, wKeepTogetherBlock, buildDocxBlob) instead
   of hand-rolling XML per document. Fix a formatting rule here and it applies
   to every current AND future document — that is the whole point of this
   file existing as a single shared module rather than one export function
   per document type re-implementing paragraphs/tables/page setup itself. */

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* OOXML's w:jc uses "both" for full justification, not the CSS/HTML term "justify" —
   an invalid enum value here is a hard schema violation that made Word refuse to open
   the file ("found a problem with its contents"), unlike the python-docx/lxml checks
   used during development which don't validate enum values at all. */
function normJc(align) { return align === 'justify' ? 'both' : align; }

/* ===== Page geometry — A4, matching the office's own signed orders =====
   Twips (1/1440 inch). Left margin is wider than top/bottom/right (1260 vs
   1080) — the standard extra allowance for filing/binding on departmental
   letters — everything else is 0.75in. Header/footer sit at 0.33in from the
   page edge. Every document shares this — there is no per-document setup. */
var DOCX_PAGE_W = 11906, DOCX_PAGE_H = 16838;   // A4
var DOCX_MARGIN = 1080;                          // top/bottom/right — 0.75in
var DOCX_MARGIN_LEFT = 1260;                     // 0.875in — filing/binding allowance
var DOCX_HF_DIST = 480;                          // 0.33in
var DOCX_CONTENT_WIDTH = DOCX_PAGE_W - DOCX_MARGIN_LEFT - DOCX_MARGIN; // usable table width

/* One font, one baseline size, everywhere — no styles.xml-less theme fallback
   (Word's default Calibri) can leak through because every run below carries
   this explicitly. Times New Roman, matching the PDF's font (jsPDF's
   built-in "times") so the Word and PDF downloads of any document look the
   same rather than diverging on typeface. */
var DOCX_FONT_NAME = 'Times New Roman';
var DOCX_FONT = '<w:rFonts w:ascii="' + DOCX_FONT_NAME + '" w:hAnsi="' + DOCX_FONT_NAME + '" w:cs="' + DOCX_FONT_NAME + '"/>';
var DOCX_BODY_SIZE = 12;   // pt
var DOCX_TABLE_SIZE = 11;  // pt

/* 1.15 line spacing (276 = 1.15 x 240) with an 8pt (160 twip) paragraph gap —
   the office's own house style; single-spacing read as too cramped and
   1.5/double reads as a generic web printout rather than a typed order. */
var DOCX_LINE = 276;
var DOCX_SPACING_AFTER = 160;
var DOCX_FIRST_LINE_INDENT = 720; // 0.5in — narrative body paragraphs only

function wRunProps(opts) {
  opts = opts || {};
  var bold = opts.bold ? '<w:b/>' : '';
  var italic = opts.italic ? '<w:i/>' : '';
  var color = opts.color ? '<w:color w:val="' + opts.color + '"/>' : '';
  var size = '<w:sz w:val="' + ((opts.size || DOCX_BODY_SIZE) * 2) + '"/>';
  return '<w:rPr>' + bold + italic + DOCX_FONT + size + color + '</w:rPr>';
}

/* opts: align, bold, italic, size, spacingBefore, spacingAfter, line, color,
   keepNext (glue to the paragraph that follows — use on every heading so it
   never gets stranded alone at the bottom of a page), keepLines (don't let
   this paragraph's own wrapped lines split across a page break), runs
   (mixed bold/plain segments within one paragraph), firstLineIndent (0.5in
   indent on the first line only — the office's convention for numbered
   narrative body paragraphs, not for headings/labels/table cells). */
function wPara(text, opts) {
  opts = opts || {};
  var align = normJc(opts.align || 'left');
  var size = opts.size || DOCX_BODY_SIZE;
  var spacingAfter = opts.spacingAfter != null ? opts.spacingAfter : DOCX_SPACING_AFTER;
  var spacingBefore = opts.spacingBefore ? ' w:before="' + opts.spacingBefore + '"' : '';
  var line = opts.line || DOCX_LINE;
  var spacing = '<w:spacing w:after="' + spacingAfter + '"' + spacingBefore + ' w:line="' + line + '" w:lineRule="auto"/>';
  var keepNext = opts.keepNext ? '<w:keepNext/>' : '';
  var keepLines = opts.keepLines ? '<w:keepLines/>' : '';
  var indent = opts.firstLineIndent ? '<w:ind w:firstLine="' + DOCX_FIRST_LINE_INDENT + '"/>' : '';
  var runs = (opts.runs || [{ text: text, bold: opts.bold, italic: opts.italic }]).map(function (run) {
    return '<w:r>' + wRunProps({ bold: run.bold, italic: run.italic, size: size, color: opts.color }) + '<w:t xml:space="preserve">' + xmlEsc(run.text) + '</w:t></w:r>';
  }).join('');
  return '<w:p><w:pPr>' + keepNext + keepLines + indent + spacing + '<w:jc w:val="' + align + '"/></w:pPr>' + runs + '</w:p>';
}

/* A heading paragraph is just wPara with keepNext baked in — used for every
   section title (URGENT NOTICE, FORM GST DRC-13, etc.) so the title can
   never end up alone on the last line of a page with its content pushed to
   the next one. */
function wHeading(text, opts) {
  opts = opts || {};
  opts.keepNext = true;
  opts.bold = opts.bold !== false;
  return wPara(text, opts);
}

/* Explicit small spacer paragraph — replaces bare "<w:p/>" spacers, which
   carry no font/size and so pick up Word's theme default (Calibri) the
   instant a cursor or diff tool touches them. Every blank line in these
   documents goes through here instead of ad hoc empty paragraphs. */
function wSpacer(size) {
  return '<w:p><w:pPr><w:spacing w:after="0" w:line="' + DOCX_LINE + '" w:lineRule="auto"/></w:pPr><w:r>' + wRunProps({ size: size || 6 }) + '<w:t xml:space="preserve"></w:t></w:r></w:p>';
}

/* Forces a manual page break — used sparingly (keepNext/keepLines/cantSplit
   handle nearly everything automatically); reserved for spots where a fresh
   page is genuinely part of the document's layout (e.g. a very long
   document's signature page). */
function wPageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

/* Wraps arbitrary already-built paragraph/table XML in a single-cell,
   borderless table whose one row carries <w:cantSplit/>. Word will not break
   a "cantSplit" row across two pages, so this is the standard OOXML trick
   for "keep this whole block together" spanning MULTIPLE paragraphs (plain
   keepNext/keepLines only glue two paragraphs or one paragraph's own lines —
   neither covers a 4-line signature block or a From/To letterhead). */
function wKeepTogetherBlock(innerXml, width) {
  width = width || DOCX_CONTENT_WIDTH;
  /* A table cell (CT_Tc) whose content ends directly in a nested </w:tbl>
     with no trailing paragraph is a schema violation some validators (and
     older Word/LibreOffice builds) reject — every wTable() output already
     self-terminates with a spacer paragraph, but the plain wFromToGrid()
     letterhead table does not, so patch that case here rather than at every
     call site. */
  var needsTrailingPara = /<\/w:tbl>\s*$/.test(innerXml);
  return '<w:tbl><w:tblPr><w:tblW w:w="' + width + '" w:type="dxa"/>'
    + '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
    + '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="' + width + '"/></w:tblGrid>'
    + '<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/><w:tcMar>'
    + '<w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>'
    + '</w:tcMar></w:tcPr>' + innerXml + (needsTrailingPara ? wSpacer(2) : '') + '</w:tc></w:tr></w:tbl>';
}

/* opts: noBorder, noHeaderShade, colWidths given in dxa. Every table:
     - repeats its header row on every page it spans (w:tblHeader)
     - never splits a single row across a page break (w:cantSplit)
     - gets real cell padding (w:tcMar) instead of Word's bare default
     - auto-scales the given column widths to the shared content width, so a
       hardcoded set of widths from an older/narrower layout can never
       overflow the page — the single source of truth for "how wide is the
       page" lives in DOCX_CONTENT_WIDTH, not in each call site. */
function wTable(rows, colWidths, opts) {
  opts = opts || {};
  var rawTotal = colWidths.reduce(function (s, w) { return s + w; }, 0);
  var scale = rawTotal > DOCX_CONTENT_WIDTH ? (DOCX_CONTENT_WIDTH / rawTotal) : 1;
  var widths = colWidths.map(function (w) { return Math.round(w * scale); });
  var totalWidth = widths.reduce(function (s, w) { return s + w; }, 0);
  var grid = widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('');

  var cellMar = '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>';

  var trs = rows.map(function (row, ri) {
    var isHeaderRow = ri === 0 && !opts.noHeaderShade;
    var tcs = row.map(function (cell, ci) {
      cell = typeof cell === 'object' ? cell : { text: cell };
      var bold = isHeaderRow || cell.bold ? true : false;
      var align = normJc(cell.align || (opts.noHeaderShade ? 'left' : (ci === 0 ? 'left' : 'center')));
      var shade = isHeaderRow ? '<w:shd w:val="clear" w:fill="EDF1F7"/>' : '';
      var vAlign = '<w:vAlign w:val="center"/>';
      return '<w:tc><w:tcPr><w:tcW w:w="' + widths[ci] + '" w:type="dxa"/>' + shade + cellMar + vAlign + '</w:tcPr>'
        + '<w:p><w:pPr><w:spacing w:after="0" w:line="' + DOCX_LINE + '" w:lineRule="auto"/><w:jc w:val="' + align + '"/></w:pPr>'
        + '<w:r>' + wRunProps({ bold: bold, size: DOCX_TABLE_SIZE }) + '<w:t xml:space="preserve">' + xmlEsc(cell.text) + '</w:t></w:r></w:p></w:tc>';
    }).join('');
    var trPr = '<w:trPr><w:cantSplit/>' + (isHeaderRow ? '<w:tblHeader/>' : '') + '</w:trPr>';
    return '<w:tr>' + trPr + tcs + '</w:tr>';
  }).join('');

  var borders = opts.noBorder
    ? '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="C8D3E0"/><w:left w:val="single" w:sz="4" w:color="C8D3E0"/>'
      + '<w:bottom w:val="single" w:sz="4" w:color="C8D3E0"/><w:right w:val="single" w:sz="4" w:color="C8D3E0"/>'
      + '<w:insideH w:val="single" w:sz="4" w:color="C8D3E0"/><w:insideV w:val="single" w:sz="4" w:color="C8D3E0"/></w:tblBorders>';
  return '<w:tbl><w:tblPr><w:tblW w:w="' + totalWidth + '" w:type="dxa"/>' + borders
    + '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + trs + '</w:tbl>' + wSpacer(4);
}

/* Field-code page-number footer, e.g. "Page 2 of 5" — computed by Word/
   LibreOffice at render time, not baked in as a static number. Centered,
   small, muted, with a thin rule separating it from the body text above. */
function docxFooterXml() {
  var rp = function () { return '<w:rPr>' + DOCX_FONT + '<w:sz w:val="18"/><w:color w:val="666666"/></w:rPr>'; };
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/></w:pBdr><w:jc w:val="center"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    + '<w:r>' + rp() + '<w:t xml:space="preserve">Page </w:t></w:r>'
    + '<w:r>' + rp() + '<w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r>' + rp() + '<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    + '<w:r>' + rp() + '<w:fldChar w:fldCharType="end"/></w:r>'
    + '<w:r>' + rp() + '<w:t xml:space="preserve"> of </w:t></w:r>'
    + '<w:r>' + rp() + '<w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r>' + rp() + '<w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>'
    + '<w:r>' + rp() + '<w:fldChar w:fldCharType="end"/></w:r>'
    + '</w:p></w:ftr>';
}

/* A quiet running header — a single rule near the top margin so a
   continuation page reads as part of the same letter rather than a bare
   page of text, plus (when given) a small identifying line such as the
   notice/reference number so a loose printed page 2 can still be matched
   back to its cover page. */
function docxHeaderXml(headerText) {
  var line = headerText
    ? ('<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="right"/></w:pPr>'
      + '<w:r><w:rPr>' + DOCX_FONT + '<w:i/><w:sz w:val="17"/><w:color w:val="808080"/></w:rPr><w:t xml:space="preserve">' + xmlEsc(headerText) + '</w:t></w:r></w:p>')
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + line
    + '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/></w:pBdr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>'
    + '</w:hdr>';
}

/* opts.headerText — short identifying line (e.g. "Notice No: NOT/2026/0004")
   shown in the running header on every page; omit for documents where the
   body's own letterhead already makes this obvious on page 1 and a repeat
   isn't meaningful. */
async function buildDocxBlob(bodyXml, opts) {
  opts = opts || {};
  await window.LibsReady;
  var zip = new JSZip();

  /* A document body ending directly in </w:tbl> right before <w:sectPr> (no
     trailing paragraph) is a well-known source of "Word found a problem
     with its contents" repair prompts — several builders' last element is a
     wKeepTogetherBlock() signature/closing table, so guard here once rather
     than remembering to append a spacer at the end of every builder. */
  if (/<\/w:tbl>\s*$/.test(bodyXml)) bodyXml += wSpacer(2);

  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    + '</Types>');

  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');

  zip.folder('word').folder('_rels').file('document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
    + '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
    + '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    + '</Relationships>');

  zip.file('word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults><w:rPrDefault><w:rPr>' + DOCX_FONT + '<w:sz w:val="' + (DOCX_BODY_SIZE * 2) + '"/><w:szCs w:val="' + (DOCX_BODY_SIZE * 2) + '"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="' + DOCX_SPACING_AFTER + '" w:line="' + DOCX_LINE + '" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '</w:styles>');

  zip.file('word/settings.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:updateFields w:val="true"/></w:settings>');

  zip.file('word/header1.xml', docxHeaderXml(opts.headerText));
  zip.file('word/footer1.xml', docxFooterXml());

  zip.folder('word').file('document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<w:body>' + bodyXml
    + '<w:sectPr>'
    + '<w:headerReference w:type="default" r:id="rIdHeader"/>'
    + '<w:footerReference w:type="default" r:id="rIdFooter"/>'
    + '<w:pgSz w:w="' + DOCX_PAGE_W + '" w:h="' + DOCX_PAGE_H + '"/>'
    + '<w:pgMar w:top="' + DOCX_MARGIN + '" w:right="' + DOCX_MARGIN + '" w:bottom="' + DOCX_MARGIN + '" w:left="' + DOCX_MARGIN_LEFT + '" w:header="' + DOCX_HF_DIST + '" w:footer="' + DOCX_HF_DIST + '" w:gutter="0"/>'
    + '</w:sectPr>'
    + '</w:body></w:document>');

  return zip.generateAsync({ type: 'blob' });
}

function downloadBlob(blob, filename) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
}

/* ===== Missing-field check — run before a document is actually generated =====
   These are legal documents; a blank GSTIN or amount should be a deliberate,
   visible decision by the officer, not something that silently prints "—"
   with nobody noticing until the notice is already served. fieldSpecs is an
   array of [recordKey, humanLabel] pairs. Returns true if it's fine to
   proceed (nothing missing, or the officer confirmed anyway). */
function findMissingFields(record, fieldSpecs) {
  return fieldSpecs.filter(function (f) {
    var v = record ? record[f[0]] : undefined;
    if (Array.isArray(v)) return v.length === 0;
    return v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '—';
  }).map(function (f) { return f[1]; });
}

function confirmMissingFields(record, fieldSpecs, docLabel) {
  var missing = findMissingFields(record, fieldSpecs);
  if (!missing.length) return true;
  return confirm('⚠️ ' + docLabel + ' is missing the following:\n\n• ' + missing.join('\n• ')
    + '\n\nThese will print blank in the document. Generate it anyway?');
}

function officeHeaderBlock(cfg) {
  return wHeading('OFFICE OF THE ' + (cfg.desig || '').toUpperCase(), { align: 'center', size: 12 })
    + wHeading(cfg.circle || '', { align: 'center', size: 12 })
    + wPara((cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), { align: 'center', size: 10, keepNext: true })
    + wSpacer(6);
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
   the office block right-aligned on the right, matching the letterhead
   layout. Kept together as one atomic block so Word can't split the
   letterhead's four lines across a page break. */
function noticeHeaderTable(cfg, leftText) {
  var rightParas = wPara('Office of the ' + (cfg.desig || ''), { align: 'right', bold: true, size: 11, spacingAfter: 20 })
    + wPara((cfg.circle || ''), { align: 'right', bold: true, size: 11, spacingAfter: 20 })
    + wPara(cfg.addr1 || '', { align: 'right', size: 10, spacingAfter: 20 })
    + wPara(cfg.addr2 || '', { align: 'right', size: 10, spacingAfter: 20 });
  var leftPara = wPara(leftText || '', { align: 'left', size: 10, spacingAfter: 20 });
  return wKeepTogetherBlock(wFromToGrid(leftPara, rightParas, 3200, 6106)) + wSpacer(4);
}

/* Shared borderless 2-column layout for From/To and side-by-side letterhead
   blocks. Cells hold already-built paragraph XML (from wPara()), not plain
   text — wTable() XML-escapes its cell content as text, which would dump
   literal "<w:p>..." markup onto the page if given raw XML here instead. */
function wFromToGrid(leftXml, rightXml, leftW, rightW) {
  leftW = leftW || Math.round(DOCX_CONTENT_WIDTH * 0.44);
  rightW = rightW || (DOCX_CONTENT_WIDTH - leftW);
  return '<w:tbl><w:tblPr><w:tblW w:w="' + (leftW + rightW) + '" w:type="dxa"/>'
    + '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
    + '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="' + leftW + '"/><w:gridCol w:w="' + rightW + '"/></w:tblGrid>'
    + '<w:tr><w:trPr><w:cantSplit/></w:trPr>'
    + '<w:tc><w:tcPr><w:tcW w:w="' + leftW + '" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + leftXml + '</w:tc>'
    + '<w:tc><w:tcPr><w:tcW w:w="' + rightW + '" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + rightXml + '</w:tc>'
    + '</w:tr></w:tbl>';
}

var noticeActionList = [
  'Attaching properties under section 79(d) of the GST act 2017.',
  'Detaining Properties under section 79(d) of the GST act 2017.',
  'Action will be taken under section 79(e) of the GST act 2017 & CRR Act 1890.',
  'Filing an application before the Court Of Magistrate under section 79(f) of the GST act 2017.'
];

/* Shared signature block — Designation / Circle / City, right-aligned, kept
   together so it never splits across a page break with the office name on
   one page and the city on the next. */
function wSignatureBlock(cfg, opts) {
  opts = opts || {};
  var inner = wPara((cfg.desig || ''), { align: 'right', keepLines: true })
    + wPara((cfg.circle || '') + (opts.circleSuffix || ''), { align: 'right', keepLines: true })
    + (opts.showCity !== false ? wPara(cfg.city || '', { align: 'right', keepLines: true }) : '');
  return wKeepTogetherBlock(inner) + wSpacer(opts.spacingAfter != null ? opts.spacingAfter : 8);
}

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
  var actionList = noticeActionList.map(function (t) { return wPara('✓  ' + t, { spacingAfter: 60, keepLines: true }); }).join('');

  var toBlock = wKeepTogetherBlock(
    wPara('To')
    + wTable([
      ['GSTIN', ': ' + gstin],
      ['Legal Name of the Business', ': ' + legalName]
    ], [3600, 6106], { noBorder: true, noHeaderShade: true })
  ) + wSpacer(4);

  var body = noticeHeaderTable(cfg, '')
    + wPara('Notice No: ' + (notice.num || '—') + '          Dated : ' + fmtDateDot(notice.date), { spacingAfter: 160, keepNext: true })
    + wHeading(isUrgent ? 'URGENT NOTICE' : 'INTIMATION NOTICE', { align: 'center', size: 13, spacingAfter: 20 })
    + wHeading('NON-PAYMENT OF GST ARREARS', { align: 'center', size: 12, spacingAfter: 200 })
    + toBlock
    + wTable([[{ text: 'Sub', bold: true }, subText], [{ text: 'Ref', bold: true }, refText]], [900, 8806], { noBorder: true, noHeaderShade: true })
    + wPara('*******', { align: 'center', spacingAfter: 120 })
    + wPara('Tvl.' + legalName + ', registered with the office of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '')
      + ' is hereby informed they are in arrears of Goods and Services Tax as detailed below:', { align: 'justify', firstLineIndent: true, spacingAfter: 120, keepNext: true })
    + wTable(d.rows, [1500, 1600, 1300, 1000, 1000, 1000, 900, 1300])
    + wPara('(AMOUNT IN RS)', { align: 'right', size: 9, spacingAfter: 160 })
    + wPara('Total Amount Payable: ' + fmt(d.total) + ' (Rupees ' + numToWords(d.total) + ' Only)', { bold: true, spacingAfter: 160 })
    + (notice.details ? wPara('Remarks: ' + notice.details, { spacingAfter: 160 }) : '')
    + wPara((isUrgent
      ? 'The Taxpayer is informed that the arrears have not been paid even after the expiry of 90 days from the date of the order. If the above amount is not paid immediately on receipt of this notice, recovery action will be initiated to realise the arrears in accordance with the provisions of the GST Act, 2017 by:'
      : 'The taxpayer is hereby informed that arrears are pending. If the arrears remain unpaid after the expiry of 90 days from the date of the order and no appeal has been filed, recovery action will be initiated to realise the dues in accordance with the provisions of the GST Act, 2017, by:'), { align: 'justify', firstLineIndent: true, spacingAfter: 100, keepNext: true })
    + actionList
    + wPara('Payment Gateway:', { bold: true, spacingAfter: 40, keepNext: true })
    + wPara('The Taxpayer is advised to pay the above said arrears through GSTIN Portal by selecting the option "Payment towards demand".', { align: 'justify', firstLineIndent: true, spacingAfter: 160 })
    + wPara('Note:', { bold: true, spacingAfter: 40, keepNext: true })
    + wPara('➤  If the tax has already been paid, you are requested to submit the payment details to this office immediately, otherwise it will be presumed that the balance still exists.', { spacingAfter: 60, keepLines: true })
    + wPara('➤  If the case is pending before any appellate forum, you are requested to submit the details to this office immediately.', { spacingAfter: 60, keepLines: true })
    + wPara('➤  Other than above no representation, in person or through postal.', { spacingAfter: 300, keepLines: true })
    + wSignatureBlock(cfg, { spacingAfter: 300 })
    + wKeepTogetherBlock(
      wPara('To,')
      + wPara(legalName, { bold: true })
      + (notice.address ? wPara(notice.address, { keepLines: true }) : '')
    );
  return buildDocxBlob(body, { headerText: 'Notice No: ' + (notice.num || '—') + '   |   GSTIN: ' + gstin });
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
    + (b.branchAddr ? wPara(b.branchAddr, { size: 10, spacingAfter: 20, keepLines: true }) : '');

  var subText = 'GST Act 2017 – Tvl. ' + (b.legalName || '—') + ' - Payment of GST Arrear - Arrears of Tax Recovery Under Section 145(1) – Notice in DRC-13 issued – Attachment ' + (isTemporary ? 'Temporarily Withdrawn' : 'Released') + ' - Regarding.';
  var refText = 'This office Ref in GSTIN. ' + (b.gstin || '—') + ', dt.' + fmtDate(b.date) + '.'
    + (b.releasedPetitionDate ? ' The Taxpayer\'s Petition Dated: ' + fmtDate(b.releasedPetitionDate) + '.' : '');
  var closing = isTemporary
    ? 'In view of the above, the Bank Attachment issued by this circle in the reference 1st cited is temporarily withdrawn and all action (lien, freeze, etc.) that has been imposed to withhold the account may be withdrawn.'
    : 'In view of the above, the Bank Attachment issued by this circle in the reference 1st cited is released and all action (lien, freeze, etc.) that has been imposed to withhold the account may be withdrawn.';

  var body = wHeading('COMMERCIAL TAXES DEPARTMENT', { align: 'center', size: 13, spacingAfter: 160 })
    + wKeepTogetherBlock(wFromToGrid(fromText, toText, 4300, 5406)) + wSpacer(4)
    + wPara('GSTIN: ' + (b.gstin || '—') + '/ dated: ' + fmtDate(b.releasedDate || todayISO()), { spacingAfter: 160 })
    + wPara('Sir/Madam,', { spacingAfter: 100, keepNext: true })
    + wTable([[{ text: 'Sub:-', bold: true }, subText], [{ text: 'Ref:', bold: true }, refText]], [900, 8806], { noBorder: true, noHeaderShade: true })
    + wPara('*********', { align: 'center', spacingAfter: 160 })
    + wPara('Tvl. ' + (b.legalName || '—') + ' doing business at ' + (b.releasedAddr || '—').replace(/\.+\s*$/, '') + '. ' + (b.releasedNarrative || ''), { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara(closing, { align: 'justify', firstLineIndent: true, spacingAfter: 300 })
    + wSignatureBlock(cfg, { showCity: false, circleSuffix: '.', spacingAfter: 300 })
    + wKeepTogetherBlock(
      wPara('Copy to: ', { spacingAfter: 20 })
      + wPara(b.legalName || '—', { spacingAfter: 20 })
      + wPara(b.releasedAddr || '—', { spacingAfter: 20, keepLines: true })
    );
  return buildDocxBlob(body, { headerText: 'Bank Release — GSTIN: ' + (b.gstin || '—') });
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

/* Shared closing block for the two statutory bank letters (Covering Letter
   and Form DRC-13) — Date / Signature / Place / Officer / Designation /
   Office Address, kept together as one unit. */
function wOfficerClosingBlock(b, cfg) {
  var inner = wPara('Date: ' + fmtDate(b.date), { spacingAfter: 20 })
    + wPara('Signature:', { spacingAfter: 200 })
    + wPara('Place : ' + (cfg.city || ''), { spacingAfter: 20 })
    + wPara('Name of Proper Officer: ' + (cfg.officerName || '_______________________'), { spacingAfter: 200 })
    + wPara('Designation: ' + (cfg.desig || ''), { spacingAfter: 20 })
    + wPara('Office Address: ' + (cfg.addr1 || '') + ' ' + (cfg.addr2 || ''), { spacingAfter: 20, keepLines: true });
  return wKeepTogetherBlock(inner);
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
    + (b.branchAddr ? wPara(b.branchAddr, { size: 10, spacingAfter: 20, keepLines: true }) : '');

  var subText = 'GST Act, 2017 – ' + (cfg.circle || '') + ' – Tvl. ' + (b.legalName || '—') + ', GSTIN – ' + (b.gstin || '—')
    + ' – Arrear of Tax Rs. ' + fmt0(b.totalAmt) + ' – Arrears of Tax outstanding against the dealer – Form DRC-13 issued – Regarding.';

  var body = wHeading('COMMERCIAL TAXES DEPARTMENT', { align: 'center', size: 13, spacingAfter: 160 })
    + wKeepTogetherBlock(wFromToGrid(fromText, toText, 4300, 5406)) + wSpacer(4)
    + wPara('GSTIN: ' + (b.gstin || '—') + '/' + (b.ref || '—') + '  dated: ' + fmtDate(b.date), { spacingAfter: 160 })
    + wPara('Sir / Madam,', { spacingAfter: 100, keepNext: true })
    + wTable([[{ text: 'Sub', bold: true }, subText], [{ text: 'Ref', bold: true }, 'This Office DRC-07 issued']], [900, 8806], { noBorder: true, noHeaderShade: true })
    + wPara('*******', { align: 'center', spacingAfter: 160 })
    + wPara('Tvl. ' + (b.legalName || '—') + (tradeName && tradeName !== b.legalName ? ' (' + tradeName + ')' : '') + ', having an Current Account / CC with your Bank, is an assessee on the file of the ' + (cfg.desig || '') + ', ' + (cfg.circle || '') + ' and is in arrears of tax of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') under the GST Act.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('Under Section 79(1)(c) of the SGST Act, 2017 read with Section 142(7)(a) of the SGST Act, 2017 & Rule 145(1) of the SGST Rules, 2017, you are required to remit to me forthwith the sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') from out of money you hold for or on account of the defaulter. If you do not hold money to that extent now, the amount available may be remitted now and the balance remitted as and when funds become available, as first charge to the Government. If the dealer is having an Overdraft account, you may require to remit the amount. A statutory demand notice in Form DRC-13 is enclosed.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('You are also prohibited from paying any money to the assessee from the Current Account (or) Overdraft Account, till the above notice is withdrawn.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('I request you to give the account balance as on today or on receiving the Form DRC-13, whichever is later.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('The above mentioned demand amount or the amount available in the taxpayer bank account has to be issued as a Demand Draft or Bank Cheque in favour of the undersigned.', { align: 'justify', firstLineIndent: true, spacingAfter: 200, keepNext: true })
    + wPara('Encl: Form DRC-13.', { spacingAfter: 300 })
    + wOfficerClosingBlock(b, cfg);
  return buildDocxBlob(body, { headerText: 'DRC-13 Covering Letter — GSTIN: ' + (b.gstin || '—') });
}

/* ===== 2b. Bank Attachment — Form GST DRC-13 (Rule 145(1)) =====
   The statutory "Notice to a third person under Section 79(1)(c)" served on
   the bank, matching the office's DRC-13 format exactly. */
function buildBankDrc13Docx(b, cfg) {
  var tradeName = bankAttTradeName(b);
  var d = demandRowsForBankDrc13(b.cases || []);
  var amountWords = numToWords(b.totalAmt) + ' Only';

  var particulars = wPara('Particulars of defaulter:-', { bold: true, spacingAfter: 60, keepNext: true })
    + wPara('A/c No.  ' + (b.accno || '—'), { spacingAfter: 20 })
    + wPara('PAN No.:-  ' + (b.pan || '—'), { spacingAfter: 20 })
    + wPara('GSTIN.  ' + (b.gstin || '—'), { spacingAfter: 20 })
    + wPara('Legal Name - ' + (b.legalName || '—'), { spacingAfter: 20, keepLines: true })
    + wPara('Trade Name- ' + (tradeName || '—'), { spacingAfter: 20, keepLines: true })
    + wPara('Demand order No: ', { spacingAfter: 160 });

  var body = wHeading('FORM GST DRC – 13', { align: 'center', size: 13, spacingAfter: 20 })
    + wPara('[See rule 145(1)]', { align: 'center', size: 10, spacingAfter: 20, keepNext: true })
    + wHeading('Notice to a third person under section 79(1)(c)', { align: 'center', size: 11, spacingAfter: 200 })
    + wKeepTogetherBlock(
      wPara('To', { spacingAfter: 20 })
      + wPara('THE BRANCH MANAGER,', { bold: true, spacingAfter: 20 })
      + wPara((b.bankName || '—').toUpperCase(), { bold: true, spacingAfter: 20, keepLines: true })
      + wPara('IFSC : ' + (b.ifsc || '—'), { spacingAfter: 160 })
    ) + wSpacer(4)
    + wKeepTogetherBlock(particulars) + wSpacer(4)
    + wPara('Amount in Rs', { align: 'right', size: 9, spacingAfter: 60 })
    + wTable(d.rows, [1300, 1500, 1300, 700, 1000, 1000, 1000, 900, 1006])
    + wPara('Whereas a sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') on account of demand, is payable under the provisions of Sec 78 of the GST Act, 2017 by ' + (b.legalName || '—') + ', holding GSTIN: ' + (b.gstin || '—') + '. It is observed that a sum Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') is due or may become due to the said taxable person from you; or', { align: 'justify', firstLineIndent: true, spacingAfter: 80 })
    + wPara('It is observed that you hold or are likely to hold a sum Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') for or on account of the said person.', { align: 'justify', firstLineIndent: true, spacingAfter: 80 })
    + wPara('You are hereby directed to pay a sum of Rs. ' + fmt0(b.totalAmt) + '/- (Rupees ' + amountWords + ') to the Government forthwith or upon the money becoming due or being held in compliance of the provisions contained in clause (c)(i) of sub-section (1) of section 79 of the Act.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('Please note that any payment made by you in compliance of this notice will be deemed under section 79 of the Act to have been made under the authority of the said taxable person and the certificate from the government in FORM GST DRC-14 will constitute a good and sufficient discharge of your liability to such person to the extent of the amount specified in the certificate.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('Also, please note that if you discharge any liability to the said taxable person after receipt of this notice, you will be personally liable to the State/Central Government under section 79 of the Act to the extent of the liability discharged, or to the extent of the liability of the taxable person for tax, cess, interest and penalty, whichever is less.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('Please note that, in case you fail to make payment in pursuance of this notice, you shall be deemed to be a defaulter in respect of the amount specified in the notice and consequences of the Act or the rules made thereunder shall follow.', { align: 'justify', firstLineIndent: true, spacingAfter: 120 })
    + wPara('The above mentioned demand amount or the amount available in the taxpayer bank account has to be issued as a Demand Draft or Bank Cheque in favour of the undersigned.', { align: 'justify', firstLineIndent: true, spacingAfter: 300, keepNext: true })
    + wOfficerClosingBlock(b, cfg);
  return buildDocxBlob(body, { headerText: 'FORM GST DRC-13 — GSTIN: ' + (b.gstin || '—') });
}

/* ===== 3. Third-Party (Debtor) Notice — DRC-13 style ===== */
function buildThirdPartyDocx(tp, cfg) {
  var d = demandRowsForDocx(tp.cases || []);
  var toBlock = wKeepTogetherBlock(
    wPara('To,')
    + wPara(tp.debtorLegal || '—', { bold: true })
    + (tp.debtorTrade ? wPara(tp.debtorTrade) : '')
    + (tp.debtorGstin ? wPara('GSTIN: ' + tp.debtorGstin) : '')
    + (tp.debtorAddr ? wPara(tp.debtorAddr, { keepLines: true }) : '')
  );
  var body = officeHeaderBlock(cfg)
    + wHeading('FORM GST DRC-13', { align: 'center', size: 13, spacingAfter: 0 })
    + wHeading('Notice to a Third Person under Section 79(1)(c)', { align: 'center', size: 11, spacingAfter: 160 })
    + toBlock + wSpacer(6)
    + wPara('Whereas ' + (tp.legalName || tp.defaulterGstin) + ' (GSTIN: ' + (tp.defaulterGstin || '—') + ') has failed to pay the tax dues detailed below, and whereas it appears that you owe / hold money for or on account of the said defaulter, you are hereby required, under Section 79(1)(c) of the GST Act, to pay to the Government the amount due to the defaulter, or up to the amount specified below, whichever is less.', { align: 'justify', firstLineIndent: true, spacingAfter: 160, keepNext: true })
    + wTable(d.rows, [2200, 2200, 1600, 1800, 2200])
    + wPara('Amount to be paid: ' + fmt(d.total), { bold: true, spacingAfter: 300 })
    + wSignatureBlock(cfg, { showCity: false });
  return buildDocxBlob(body, { headerText: 'FORM GST DRC-13 — GSTIN: ' + (tp.defaulterGstin || '—') });
}

/* ===== 4. Property Attachment Order — Section 79(d) ===== */
function buildPropertyAttachmentDocx(pa, cfg) {
  var d = demandRowsForDocx(pa.cases || []);
  var body = officeHeaderBlock(cfg)
    + wHeading('ORDER OF ATTACHMENT OF PROPERTY', { align: 'center', size: 13, spacingAfter: 0 })
    + wHeading('under Section 79(1)(d) of the GST Act', { align: 'center', bold: false, size: 11, spacingAfter: 160 })
    + wPara('Defaulter: ' + (pa.legalName || '—') + '   GSTIN: ' + (pa.gstin || '—'), { bold: true, spacingAfter: 160, keepNext: true })
    + wPara('Whereas the amounts detailed below remain outstanding and unpaid, and recovery by other modes has not been effective, the movable/immovable property described below, belonging to the above defaulter, is hereby attached in exercise of powers under Section 79(1)(d) of the GST Act, until the outstanding dues are discharged in full.', { align: 'justify', firstLineIndent: true, spacingAfter: 160, keepNext: true })
    + wTable(d.rows, [2200, 2200, 1600, 1800, 2200])
    + wKeepTogetherBlock(
      wPara('Property Description: ' + (pa.propertyDescription || '—'), { keepLines: true })
      + wPara('Location / Survey No.: ' + (pa.propertyLocation || '—'), { keepLines: true })
      + wPara('Estimated Value: ' + fmt(pa.propertyValue), { spacingAfter: 300 })
    )
    + wSignatureBlock(cfg, { showCity: false });
  return buildDocxBlob(body, { headerText: 'Property Attachment — GSTIN: ' + (pa.gstin || '—') });
}

/* ===== 5. Recovery Profile dossier ===== */
function buildRecoveryProfileDocx(gstin, summary, cfg) {
  var body = officeHeaderBlock(cfg)
    + wHeading('RECOVERY PROFILE', { align: 'center', size: 13, spacingAfter: 160 })
    + wPara(summary.legalName || '—', { bold: true, keepNext: true })
    + wPara('GSTIN: ' + gstin, { spacingAfter: 160 })
    + wTable([
      ['Metric', 'Value'],
      ['Total Original Demand', fmt0(summary.origTotal)],
      ['Total Pending', fmt0(summary.pendTotal)],
      ['Number of Demands', String(summary.demandCount)],
      ['Notices Issued', String(summary.noticeCount)],
      ['Bank Attachments', String(summary.bankCount)],
      ['Recorded Collections', fmt0(summary.recoveredTotal)]
    ], [4500, 4500])
    + wPara('', { spacingAfter: 300, size: 6 })
    + wSignatureBlock(cfg, { showCity: false });
  return buildDocxBlob(body, { headerText: 'Recovery Profile — GSTIN: ' + gstin });
}
