/* ===== DCR Excel import — multi-file, multi-quarter/year upload with reconciliation
   against the previously consolidated DCR (Demand & Collection Register). =====

   Flow: select/drop file(s) -> parseDCRWorkbook() reads & stages each one in
   _dcrPendingFiles WITHOUT touching AppState -> officer reviews the Upload
   Summary -> "Upload & Reconcile DCR" commits every staged file's rows into
   the single consolidated AppState.cases (upsert by demandId) and runs the
   reconciliation diff against the pre-commit snapshot. */

var _dcrPendingFiles = []; // [{ id, fileName, fy, quarter, quarterLabel, rows, recordCount }]

function quarterFromMonth(mo) {
  if (mo >= 4 && mo <= 6) return { q: 'Q1', label: 'Q1 (Apr-Jun)' };
  if (mo >= 7 && mo <= 9) return { q: 'Q2', label: 'Q2 (Jul-Sep)' };
  if (mo >= 10 && mo <= 12) return { q: 'Q3', label: 'Q3 (Oct-Dec)' };
  return { q: 'Q4', label: 'Q4 (Jan-Mar)' };
}

/* Reads one workbook and returns the parsed rows WITHOUT merging them into
   AppState — used for the pre-commit preview. Returns null on failure. */
function parseDCRWorkbook(arrayBuffer, fileName) {
  var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, raw: false });
  var sheetName = wb.SheetNames.find(function (n) { return n.trim().toUpperCase() === 'DCR'; }) || wb.SheetNames[0];
  var ws = wb.Sheets[sheetName];
  if (!ws) { showToast('❌ ' + fileName + ' — no sheet found'); return null; }

  // Excel merges cells (e.g. a repeated GSTIN over several demand rows) — SheetJS
  // only populates the top-left cell of a merge, so copy its value across the range.
  if (ws['!merges']) {
    ws['!merges'].forEach(function (merge) {
      var topLeft = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
      var tlVal = ws[topLeft];
      for (var r = merge.s.r; r <= merge.e.r; r++) {
        for (var c = merge.s.c; c <= merge.e.c; c++) {
          var addr = XLSX.utils.encode_cell({ r: r, c: c });
          if (!ws[addr] && tlVal) ws[addr] = Object.assign({}, tlVal);
        }
      }
    });
    ws['!merges'] = [];
  }

  var origRange = XLSX.utils.decode_range(ws['!ref'] || 'A1:W10');
  var maxRow = origRange.e.r;
  Object.keys(ws).forEach(function (key) {
    if (key[0] === '!') return;
    var cell = XLSX.utils.decode_cell(key);
    if (cell.r > maxRow) maxRow = cell.r;
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: origRange.s, e: { r: maxRow, c: origRange.e.c } });

  var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  // Financial Year + Quarter — derived from the "From Date:" header cell
  // (e.g. "2020-01-01" -> FY "2019-20", month 1 -> Q4 Jan-Mar).
  var fy = 'Unknown', quarter = { q: 'Unknown', label: 'Unknown' };
  for (var ri = 0; ri < Math.min(8, rows.length) && fy === 'Unknown'; ri++) {
    for (var ci = 0; ci < Math.min(5, rows[ri].length) - 1; ci++) {
      var label = String(rows[ri][ci] || '').trim().toLowerCase();
      if (label === 'from date:' || label === 'from date') {
        var dm = String(rows[ri][ci + 1] || '').trim().match(/^(\d{4})-(\d{2})-\d{2}/);
        if (dm) {
          var y = parseInt(dm[1], 10), mo = parseInt(dm[2], 10);
          var fyStart = mo >= 4 ? y : y - 1;
          fy = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
          quarter = quarterFromMonth(mo);
        }
        break;
      }
    }
  }
  // Fallback for sheets without a From Date cell — accept only a genuine FY-shaped label.
  if (fy === 'Unknown') {
    var fyPattern = /20(\d{2})-(\d{2})/;
    for (var rif = 0; rif < Math.min(8, rows.length) && fy === 'Unknown'; rif++) {
      for (var cif = 0; cif < Math.min(5, rows[rif].length); cif++) {
        var m = String(rows[rif][cif] || '').match(fyPattern);
        if (m && m[2] === String((parseInt(m[1], 10) + 1) % 100).padStart(2, '0')) { fy = m[0]; break; }
      }
    }
  }

  // Header row detection — look for "demand id" in the first 15 rows.
  var dataStartRow = 10;
  for (var i = 0; i < Math.min(15, rows.length); i++) {
    var rowStr = rows[i].join(' ').toLowerCase();
    if (rowStr.includes('demand id') || rowStr.includes('demand\nid')) { dataStartRow = i + 2; break; }
  }

  var toNum = function (v) { var n = parseFloat(String(v || '0').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

  // Fixed 25-column layout: 0 DemandID, 1 Date, 2 Source, 3 IssuingAuthority, 4 GSTIN,
  // 5 LegalName, 6 Mobile, 7 TaxPeriod, 8 Section, 9 DCR_date, 10 DemandRaisedBy,
  // 11-15 orig(igst,cgst,sgst,cess,total), 16-20 pend(igst,cgst,sgst,cess,total),
  // 21 demandStatus, 22 recoveryId, 23 recoveryStatus.
  var GCOL = 4, NCOL = 5, TPCOL = 7, SECCOL = 8, DCRCOL = 9, OICOL = 11, PICOL = 16, DSCOL = 21, RICOL = 22, RSCOL = 23;

  var parsedRows = [];
  for (var ri2 = dataStartRow; ri2 < rows.length; ri2++) {
    var r = rows[ri2];
    if (!r || !r.length) continue;

    var demandId = String(r[0] || '').trim();
    if (!demandId) continue;
    var didLower = demandId.toLowerCase();
    if (['demand', 'date', 'total', 'grand', 'financial', 'period', 'sl.', 'sr.'].some(function (w) { return didLower.includes(w); })) continue;
    if (!/^[A-Za-z]{1,3}[0-9]/.test(demandId)) continue;

    var gstin = String(r[GCOL] || '').trim().toUpperCase();
    if (!gstin || gstin.length < 10) continue;

    parsedRows.push({
      id: demandId + '_' + Date.now() + '_' + ri2,
      demandId: demandId,
      demandDate: String(r[1] || '').trim(),
      source: String(r[2] || '').trim(),
      gstin: gstin,
      legalName: String(r[NCOL] || '').trim(),
      taxPeriod: String(r[TPCOL] || '').trim(),
      section: String(r[SECCOL] || '').trim(),
      dcr_date: String(r[DCRCOL] || '').trim(),
      orig_igst: toNum(r[OICOL]), orig_cgst: toNum(r[OICOL + 1]), orig_sgst: toNum(r[OICOL + 2]),
      orig_cess: toNum(r[OICOL + 3]), orig_total: toNum(r[OICOL + 4]),
      pend_igst: toNum(r[PICOL]), pend_cgst: toNum(r[PICOL + 1]), pend_sgst: toNum(r[PICOL + 2]),
      pend_cess: toNum(r[PICOL + 3]), pend_total: toNum(r[PICOL + 4]),
      demandStatus: String(r[DSCOL] || '').trim(),
      recoveryId: String(r[RICOL] || '').trim(),
      recoveryStatus: String(r[RSCOL] || '').trim(),
      fy: fy,
      importedAt: new Date().toISOString()
    });
  }

  if (!parsedRows.length) { showToast('⚠️ ' + fileName + ' — no demand rows found'); return null; }

  // Fallback when the sheet had no readable "From Date:" header cell — derive
  // FY/quarter from whichever Tax Period ("MM/YYYY") appears most often among
  // the parsed rows, so the Uploaded DCR Files table doesn't show "Unknown".
  if (fy === 'Unknown') {
    var freq = {};
    parsedRows.forEach(function (row) {
      var m = String(row.taxPeriod || '').match(/^(\d{1,2})\/(\d{4})$/);
      if (m) { var key = m[1] + '/' + m[2]; freq[key] = (freq[key] || 0) + 1; }
    });
    var bestKey = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; })[0];
    if (bestKey) {
      var bp = bestKey.split('/'); var bmo = parseInt(bp[0], 10), by = parseInt(bp[1], 10);
      var bFyStart = bmo >= 4 ? by : by - 1;
      fy = bFyStart + '-' + String((bFyStart + 1) % 100).padStart(2, '0');
      quarter = quarterFromMonth(bmo);
      parsedRows.forEach(function (row) { row.fy = fy; });
    }
  }

  return { fileName: fileName, fy: fy, quarter: quarter.q, quarterLabel: quarter.label, rows: parsedRows, recordCount: parsedRows.length };
}

/* Phase 1 — stage selected/dropped file(s) for review; nothing is merged into
   AppState yet. Multiple selections accumulate in _dcrPendingFiles. */
async function handleDCRFiles(fileList) {
  var files = Array.from(fileList || []);
  if (!files.length) return;
  await window.LibsReady;

  var remaining = files.length;
  files.forEach(function (file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = parseDCRWorkbook(e.target.result, file.name);
        if (parsed) {
          parsed.id = uid('dcrpending');
          _dcrPendingFiles.push(parsed);
        }
      } catch (err) {
        console.error(err);
        showToast('❌ ' + file.name + ' — ' + err.message);
      } finally {
        remaining--;
        if (remaining === 0) renderDCRSection();
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function wizRemovePendingDCRFile(id) {
  _dcrPendingFiles = _dcrPendingFiles.filter(function (f) { return f.id !== id; });
  renderDCRSection();
}

/* Phase 2 — merge every staged file's rows into the consolidated DCR
   (upsert by demandId, same as a plain re-import) and reconcile against the
   pre-commit snapshot. This is what "Upload & Reconcile DCR" runs. */
function wizUploadAndReconcileDCR() {
  if (!_dcrPendingFiles.length) { showToast('⚠️ Choose DCR file(s) first'); return; }

  var preSnapshot = AppState.cases.map(function (c) {
    return { demandId: c.demandId, gstin: c.gstin, pend_total: c.pend_total, demandStatus: c.demandStatus };
  });
  var previousUploadAt = AppState.lastImportAt;

  var fileNames = [];
  _dcrPendingFiles.forEach(function (pf) {
    var demandIds = [];
    pf.rows.forEach(function (c) {
      var idx = AppState.cases.findIndex(function (x) { return x.demandId === c.demandId; });
      demandIds.push(c.demandId);
      if (idx >= 0) {
        var ex = AppState.cases[idx];
        ex.pend_igst = c.pend_igst; ex.pend_cgst = c.pend_cgst; ex.pend_sgst = c.pend_sgst;
        ex.pend_cess = c.pend_cess; ex.pend_total = c.pend_total;
        ex.demandStatus = c.demandStatus; ex.recoveryStatus = c.recoveryStatus; ex.recoveryId = c.recoveryId;
        ex.importedAt = c.importedAt;
      } else {
        AppState.cases.push(c);
      }
    });
    AppState.dcrFiles.push({
      id: pf.id, fileName: pf.fileName, fy: pf.fy, quarter: pf.quarter, quarterLabel: pf.quarterLabel,
      records: pf.rows.length, uploadedAt: new Date().toISOString(), demandIds: demandIds
    });
    fileNames.push(pf.fileName);
  });

  var summary = computeReconciliationSummary(preSnapshot, AppState.cases);
  var details = reconcileDCR(preSnapshot, AppState.cases);

  AppState.lastImportAt = new Date().toISOString();
  AppState.lastImportFileName = fileNames.join(', ');
  AppState.lastReconciliation = {
    reconciledAt: AppState.lastImportAt,
    previousUploadAt: previousUploadAt,
    fileNames: fileNames,
    openingBalance: summary.openingBalance,
    newDemandsAdded: summary.newDemandsAdded,
    closedEliminated: summary.closedEliminated,
    appealHcOthers: summary.appealHcOthers,
    closingBalance: summary.closingBalance,
    details: details
  };

  _dcrPendingFiles = [];
  persist();
  updateSidebar();
  if (typeof renderWizardStepper === 'function') renderWizardStepper();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  showToast('✅ Reconciled successfully — ' + fileNames.length + ' file(s) processed');
}

/* Aggregate tile numbers for the Reconciliation Summary card. Any demand
   whose pending amount dropped is bucketed as either "Appeal / HC / Others"
   (status text mentions appeal / high court / tribunal / stay / waiver) or a
   plain "Closed / Eliminated" recovery — this is a display-only split and
   does not affect AppState.reconciliationLog (dashboard.js's Recovered KPI
   keeps reading the existing collection/partial/elimination types). */
function computeReconciliationSummary(oldSnapshot, newCases) {
  var oldMap = {};
  oldSnapshot.forEach(function (c) { oldMap[c.demandId] = c; });

  var openingBalance = oldSnapshot.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var closingBalance = newCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var newDemandsAdded = 0, closedEliminated = 0, appealHcOthers = 0;
  var appealPattern = /appeal|high court|tribunal|\bhc\b|stay|waiver|writ/i;

  newCases.forEach(function (c) {
    var old = oldMap[c.demandId];
    var newPend = Number(c.pend_total) || 0;
    if (!old) { newDemandsAdded += newPend; return; }
    var oldPend = Number(old.pend_total) || 0;
    if (newPend >= oldPend) return;
    var diff = oldPend - newPend;
    if (appealPattern.test(c.demandStatus || '')) appealHcOthers += diff;
    else closedEliminated += diff;
  });

  return { openingBalance: openingBalance, newDemandsAdded: newDemandsAdded, closedEliminated: closedEliminated, appealHcOthers: appealHcOthers, closingBalance: closingBalance };
}

/* Reconciliation — detects collections/eliminations/dropped demands between
   the pre-commit snapshot and the consolidated DCR after this batch's merge.
   Pushes entries into AppState.reconciliationLog (consumed by the Dashboard's
   Recovered KPI and activity feed — do not change the `type` values) and
   returns just the entries this call added, for the batch-scoped report. */
function reconcileDCR(oldCases, newCases) {
  var newMap = {};
  newCases.forEach(function (c) { newMap[c.demandId] = c; });

  var added = [];
  oldCases.forEach(function (old) {
    var fresh = newMap[old.demandId];
    if (!fresh) {
      added.push({
        id: uid('recon'), gstin: old.gstin, demandId: old.demandId, date: todayISO(), type: 'dropped',
        amount: Number(old.pend_total) || 0,
        remarks: 'Demand no longer in DCR — may be appeal allowed / written off', createdAt: new Date().toISOString()
      });
      return;
    }
    var oldPend = Number(old.pend_total) || 0;
    var newPend = Number(fresh.pend_total) || 0;
    if (oldPend <= 0 || newPend >= oldPend) return;

    var diff = oldPend - newPend;
    var isElim = (fresh.demandStatus || '').toLowerCase().includes('revision demand created');
    var type = isElim ? 'elimination' : (newPend === 0 ? 'collection' : 'partial');

    added.push({
      id: uid('recon'), gstin: old.gstin, demandId: old.demandId, date: todayISO(), type: type, amount: diff,
      remarks: isElim ? 'Demand closed and revision demand created' : (newPend === 0 ? 'Fully paid' : 'Partial payment — pending reduced from ' + fmt(oldPend) + ' to ' + fmt(newPend)),
      createdAt: new Date().toISOString()
    });
  });

  added.forEach(function (entry) { AppState.reconciliationLog.push(entry); });
  persist();
  return added;
}

/* ===== Rendering — the full DCR panel (header, upload zone, reconciliation
   summary, uploaded-files table). Called from renderWizardStepper(). ===== */

function renderDCRSection() {
  var el = document.getElementById('wizard-dcr-section');
  if (!el) return;

  var hasDCR = AppState.cases.length > 0;
  el.innerHTML =
    dcrPanelHead(hasDCR)
    + dcrUploadRow()
    + dcrReconciliationSummary()
    + dcrFilesTable()
    + dcrExportButtons(hasDCR)
    + '<div class="dcr-info-note"><i class="fa-solid fa-circle-info"></i> After successful reconciliation, the consolidated DCR will be used for notice generation and recovery proceedings.</div>'
    + '</div>'; // closes .dcr-panel opened in dcrPanelHead()

  wizWireDCRUploadZone();
}

function dcrPanelHead(hasDCR) {
  var lastUploaded = AppState.lastImportAt ? fmtDateTime(AppState.lastImportAt) : '—';
  return '<div class="dcr-panel">'
    + '<div class="dcr-panel-head">'
    + '<div class="dcr-head-left">'
    + '<div class="dcr-head-icon ' + (hasDCR ? 'done' : 'pending') + '"><i class="fa-solid ' + (hasDCR ? 'fa-circle-check' : 'fa-circle') + '"></i></div>'
    + '<div><div class="dcr-title">1. Upload DCR <span class="dcr-title-sub">(Demand &amp; Collection Register)</span></div>'
    + '<div class="dcr-desc">Upload quarterly DCR files. The system will reconcile the newly uploaded DCR with the previously consolidated DCR.</div></div>'
    + '</div>'
    + '<div class="dcr-head-right">'
    + '<div class="dcr-last-uploaded"><div class="dlu-label">Last Uploaded On</div><div class="dlu-val">' + xe(lastUploaded) + '</div></div>'
    + '<button type="button" class="btn btn-outline btn-sm" onclick="openDcrGuidelines()"><i class="fa-solid fa-circle-info"></i> View Guidelines</button>'
    + '<button type="button" class="btn btn-outline btn-sm"' + (AppState.lastReconciliation ? '' : ' disabled') + ' onclick="wizViewReconciliationReport()"><i class="fa-solid fa-file-lines"></i> View Reconciliation Report</button>'
    + '<button type="button" class="btn btn-danger-outline btn-sm"' + (hasDCR ? '' : ' disabled') + ' onclick="wizClearDCR()"><i class="fa-solid fa-trash"></i> Clear / Delete DCR</button>'
    + '</div>'
    + '</div>';
}

function openDcrGuidelines() { var ov = document.getElementById('dcr-guidelines-overlay'); if (ov) ov.classList.add('show'); }
function closeDcrGuidelines() { var ov = document.getElementById('dcr-guidelines-overlay'); if (ov) ov.classList.remove('show'); }

function dcrUploadRow() {
  return '<div class="dcr-upload-row">'
    + '<div class="dcr-upload-zone">'
    + '<div class="dcr-col-label">Upload New DCR File(s)</div>'
    + '<div class="dcr-dropzone" id="dcr-dropzone">'
    + '<div class="dcr-dropzone-icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>'
    + '<div class="dcr-dropzone-title">Drag &amp; drop DCR files here</div>'
    + '<div class="dcr-or">or</div>'
    + '<button type="button" class="btn btn-blue btn-sm" onclick="document.getElementById(\'dcr-file-input\').click()">Choose Files</button>'
    + '<div class="dcr-dropzone-format">Excel (.xlsx, .xls) &middot; Multiple quarters supported</div>'
    + '</div>'
    + dcrPendingFileChips()
    + '</div>'
    + dcrUploadSummaryPanel()
    + '</div>';
}

function dcrPendingFileChips() {
  if (!_dcrPendingFiles.length) return '';
  return '<div class="dcr-pending-chips">' + _dcrPendingFiles.map(function (f) {
    return '<div class="dcr-chip"><i class="fa-solid fa-file-excel"></i><span>' + xe(f.fileName) + '</span><span class="dcr-chip-count">' + f.recordCount + ' rec.</span>'
      + '<button type="button" class="dcr-chip-remove" title="Remove" onclick="wizRemovePendingDCRFile(\'' + f.id + '\')"><i class="fa-solid fa-xmark"></i></button></div>';
  }).join('') + '</div>';
}

function dcrUploadSummaryPanel() {
  var n = _dcrPendingFiles.length;
  if (!n) return dcrConsolidatedSnapshot();

  var totalRecords = _dcrPendingFiles.reduce(function (s, f) { return s + f.recordCount; }, 0);
  var fys = Array.from(new Set(_dcrPendingFiles.map(function (f) { return f.fy; }))).sort();
  var fyRange = fys.length > 1 ? (fys[0] + ' to ' + fys[fys.length - 1]) : (fys[0] || '—');
  var quarters = Array.from(new Set(_dcrPendingFiles.map(function (f) { return f.quarter; }))).sort();

  return '<div class="dcr-upload-summary">'
    + '<div class="dcr-col-label">Upload Summary</div>'
    + '<div class="dcr-mini-stats">'
    + dcrMiniStat('Files Selected', String(n), 'blue', true)
    + dcrMiniStat('Total Records', fmt0(totalRecords), 'purple')
    + dcrMiniStat('Financial Years', xe(fyRange), 'gold')
    + dcrMiniStat('Quarters', xe(quarters.join(', ') || '—'), 'green')
    + '</div>'
    + '<button type="button" class="btn btn-blue dcr-reconcile-btn" onclick="wizUploadAndReconcileDCR()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload &amp; Reconcile DCR</button>'
    + '</div>';
}

/* Idle state of the summary column — while no file is staged for upload,
   show what the consolidated DCR currently holds instead of an empty
   prompt box. Total Pending is the one number an officer actually cares
   about here, so it gets its own full-width hero tile (same pattern as
   the Arrear Action Register's Balance Arrear tile) instead of sitting at
   equal visual weight with Financial Years in a flat label/value list. */
function dcrConsolidatedSnapshot() {
  var valid = AppState.cases.filter(isValidCase);
  if (!valid.length) {
    return '<div class="dcr-upload-summary dcr-upload-summary-empty">'
      + '<i class="fa-regular fa-folder-open"></i>'
      + '<div class="dcr-summary-empty-text">Select or drag DCR file(s) to see a summary before reconciling.</div>'
      + '</div>';
  }
  var uniqueGstins = new Set(valid.map(function (c) { return c.gstin; })).size;
  var totalPending = valid.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var fys = Array.from(new Set(valid.map(function (c) { return c.fy; }).filter(function (f) { return f && f !== 'Unknown'; }))).sort();

  return '<div class="dcr-upload-summary">'
    + '<div class="dcr-col-label">Consolidated DCR Snapshot</div>'
    + '<div class="dcr-mini-stats">'
    + dcrMiniStat('Total Pending', fmt(totalPending), 'red', true)
    + dcrMiniStat('Total Records', fmt0(valid.length), 'blue')
    + dcrMiniStat('Unique Taxpayers', fmt0(uniqueGstins), 'purple')
    + dcrMiniStat('Financial Years', xe(fys.join(', ')) || '<span class="dms-muted">Not detected</span>', 'gold')
    + '</div>'
    + '<div class="dcr-summary-hint">Select or drag DCR file(s) above to add more quarters/years.</div>'
    + '</div>';
}

function dcrMiniStat(label, val, color, hero) {
  return '<div class="dcr-mini-stat ' + color + (hero ? ' hero' : '') + '"><div class="dms-label">' + xe(label) + '</div><div class="dms-val">' + val + '</div></div>';
}

function dcrReconciliationSummary() {
  var r = AppState.lastReconciliation;
  if (!r) return '';
  var tiles = [
    { label: 'Previous DCR Up to', val: r.previousUploadAt ? fmtDateShort(r.previousUploadAt) : 'First upload', icon: 'fa-calendar-days', cls: 'blue' },
    { label: 'Opening Balance (₹)', val: fmt(r.openingBalance), icon: 'fa-wallet', cls: 'green' },
    { label: 'New Demands Added (₹)', val: fmt(r.newDemandsAdded), icon: 'fa-arrow-trend-up', cls: 'blue' },
    { label: 'Closed / Eliminated (₹)', val: fmt(r.closedEliminated), icon: 'fa-arrow-trend-down', cls: 'gold' },
    { label: 'Appeal / HC / Others (₹)', val: fmt(r.appealHcOthers), icon: 'fa-building-columns', cls: 'red' },
    { label: 'Closing Balance (₹)', val: fmt(r.closingBalance), icon: 'fa-chart-pie', cls: 'purple' }
  ];
  return '<div class="dcr-recon-wrap">'
    + '<div class="dcr-recon-head">'
    + '<div class="dcr-col-label" style="margin:0;">Reconciliation Summary (with previously uploaded DCR)</div>'
    + '<span class="pill pill-green"><i class="fa-solid fa-circle-check"></i> Reconciled Successfully</span>'
    + '</div>'
    + '<div class="stats dcr-recon-tiles">' + tiles.map(function (t) {
      return '<div class="scard ' + t.cls + '"><div class="slabel"><i class="fa-solid ' + t.icon + '"></i> ' + t.label + '</div><div class="sval ' + t.cls + '" style="font-size:16px;">' + t.val + '</div></div>';
    }).join('') + '</div>'
    + '<div class="dcr-recon-actions"><button type="button" class="btn-link" onclick="wizDownloadReconciliationReport()"><i class="fa-solid fa-download"></i> Download Reconciliation Report (Excel)</button></div>'
    + '</div>';
}

function dcrKnownOrPill(val) {
  if (!val || val === 'Unknown') return '<span class="pill pill-gray">Unknown</span>';
  return xe(val);
}

function dcrFilesTable() {
  var files = AppState.dcrFiles.slice().sort(function (a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); });
  var body;
  if (!files.length) {
    body = '<div class="empty"><div class="empty-sub">No DCR files uploaded yet.</div></div>';
  } else {
    var rows = files.map(function (f) {
      return '<tr>'
        + '<td><i class="fa-solid fa-file-excel" style="color:var(--success);margin-right:6px;"></i>' + xe(f.fileName) + '</td>'
        + '<td>' + dcrKnownOrPill(f.fy) + '</td>'
        + '<td>' + dcrKnownOrPill(f.quarterLabel || f.quarter) + '</td>'
        + '<td>' + fmt0(f.records) + '</td>'
        + '<td>' + fmtDateTime(f.uploadedAt) + '</td>'
        + '<td><span class="pill pill-green"><i class="fa-solid fa-check"></i> Uploaded</span></td>'
        + '<td><button type="button" class="icon-btn-danger" title="Delete this DCR file" onclick="wizDeleteDCRFile(\'' + f.id + '\')"><i class="fa-solid fa-trash"></i></button></td>'
        + '</tr>';
    }).join('');
    body = '<div class="table-wrap"><div class="table-scroll"><table><thead><tr><th>File Name</th><th>Financial Year</th><th>Quarter</th><th>Records</th><th>Uploaded On</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  return '<div class="dcr-files-wrap"><div class="dcr-col-label">Uploaded DCR Files</div>' + body + '</div>';
}

function dcrExportButtons(hasDCR) {
  return '<div class="dcr-export-row">'
    + '<button type="button" class="btn btn-blue"' + (hasDCR ? '' : ' disabled') + ' onclick="exportDCRExcel()"><i class="fa-solid fa-file-excel"></i> Export DCR (Excel)</button>'
    + '<button type="button" class="btn btn-green"' + (AppState.lastReconciliation ? '' : ' disabled') + ' onclick="wizDownloadReconciliationReport()"><i class="fa-solid fa-file-excel"></i> Export Reconciled DCR (Excel)</button>'
    + '</div>';
}

/* Full consolidated DCR (every valid case currently held), not just the
   most recent upload — same "regenerate fresh from AppState, never persist
   the file itself" pattern every export in this app follows. */
function exportDCRExcel() {
  var valid = AppState.cases.filter(isValidCase);
  if (!valid.length) { showToast('⚠️ No DCR data to export — upload it first'); return; }
  var rows = valid.map(function (c) {
    return {
      'Demand ID': c.demandId, 'Date': c.demandDate, 'Source': c.source, 'GSTIN': c.gstin, 'Legal Name': c.legalName,
      'Tax Period': c.taxPeriod, 'Section': c.section, 'DCR Date': c.dcr_date,
      'Orig IGST': c.orig_igst, 'Orig CGST': c.orig_cgst, 'Orig SGST': c.orig_sgst, 'Orig CESS': c.orig_cess, 'Orig Total': c.orig_total,
      'Pending IGST': c.pend_igst, 'Pending CGST': c.pend_cgst, 'Pending SGST': c.pend_sgst, 'Pending CESS': c.pend_cess, 'Pending Total': c.pend_total,
      'Demand Status': c.demandStatus, 'Recovery ID': c.recoveryId, 'Recovery Status': c.recoveryStatus, 'Financial Year': c.fy
    };
  });
  var ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0]).map(function (k) { return { wch: k === 'Legal Name' ? 30 : (k === 'Demand ID' ? 20 : 14) }; });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DCR');
  XLSX.writeFile(wb, 'DCR_Export_' + todayISO() + '.xlsx');
  showToast('⬇️ Exported ' + valid.length + ' demand(s)');
}

/* Drag/drop + click wiring for the DCR dropzone — rebound on every render()
   since the dropzone element itself is recreated each time. */
function wizWireDCRUploadZone() {
  var zone = document.getElementById('dcr-dropzone');
  if (!zone) return;
  ['dragover', 'dragenter'].forEach(function (evt) {
    zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
  });
  zone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files.length) handleDCRFiles(e.dataTransfer.files);
  });
}

/* Removes one uploaded DCR file's row. A demand is only actually dropped from
   the consolidated DCR if no OTHER remaining file also touched it — this
   avoids deleting data a later upload already refreshed. */
function wizDeleteDCRFile(fileId) {
  var file = AppState.dcrFiles.find(function (f) { return f.id === fileId; });
  if (!file) return;
  if (!confirm('Delete "' + file.fileName + '" from the consolidated DCR?\n\nDemand records that only came from this file will be removed. This cannot be undone.')) return;

  AppState.dcrFiles = AppState.dcrFiles.filter(function (f) { return f.id !== fileId; });

  var stillReferenced = {};
  AppState.dcrFiles.forEach(function (f) { f.demandIds.forEach(function (id) { stillReferenced[id] = true; }); });
  var toRemove = {};
  (file.demandIds || []).forEach(function (id) { if (!stillReferenced[id]) toRemove[id] = true; });
  AppState.cases = AppState.cases.filter(function (c) { return !toRemove[c.demandId]; });

  if (!AppState.dcrFiles.length) {
    AppState.lastImportAt = null; AppState.lastImportFileName = null; AppState.lastImportFileSize = null;
  } else {
    var latest = AppState.dcrFiles.slice().sort(function (a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); })[0];
    AppState.lastImportAt = latest.uploadedAt;
    AppState.lastImportFileName = latest.fileName;
  }

  persist();
  updateSidebar();
  if (typeof renderWizardStepper === 'function') renderWizardStepper();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  showToast('🗑 DCR file removed');
}

/* Top-level "Clear / Delete DCR" — wipes the entire consolidated DCR dataset. */
function wizClearDCR() {
  if (!AppState.cases.length && !AppState.dcrFiles.length) return;
  if (!confirm('⚠️ Clear the entire consolidated DCR (all uploaded quarters/years)?\n\nThis removes all DCR demand records from this device. Notices already generated are not affected. This cannot be undone.')) return;

  AppState.cases = [];
  AppState.dcrFiles = [];
  AppState.lastReconciliation = null;
  AppState.lastImportAt = null; AppState.lastImportFileName = null; AppState.lastImportFileSize = null;
  _dcrPendingFiles = [];

  persist();
  updateSidebar();
  if (typeof renderWizardStepper === 'function') renderWizardStepper();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  showToast('🗑 DCR data cleared');
}

function wizViewReconciliationReport() {
  var r = AppState.lastReconciliation;
  if (!r) { showToast('⚠️ No reconciliation report yet'); return; }
  var rows = (r.details || []).map(function (d) {
    return '<tr><td>' + xe(d.gstin) + '</td><td>' + xe(d.demandId) + '</td><td style="text-transform:capitalize;">' + xe(d.type) + '</td><td style="text-align:right;">' + fmt0(d.amount) + '</td><td>' + xe(d.remarks) + '</td></tr>';
  }).join('');
  var win = window.open('', '_blank');
  if (!win) { showToast('⚠️ Enable pop-ups to view the report'); return; }
  win.document.write(
    '<html><head><title>DCR Reconciliation Report</title><style>'
    + 'body{font-family:Arial,sans-serif;padding:32px;color:#0F172A;} h2{margin:0 0 4px;} .sub{color:#64748B;font-size:13px;margin-bottom:20px;}'
    + 'table{width:100%;border-collapse:collapse;} th,td{border:1px solid #E2E8F0;padding:8px 10px;font-size:12.5px;} th{background:#F1F5F9;text-align:left;}'
    + '.stats{display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap;} .stat{border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;min-width:150px;} .stat b{display:block;font-size:15px;}'
    + '</style></head><body>'
    + '<h2>DCR Reconciliation Report</h2>'
    + '<div class="sub">Files: ' + xe((r.fileNames || []).join(', ')) + ' &middot; Reconciled: ' + xe(fmtDateTime(r.reconciledAt)) + '</div>'
    + '<div class="stats">'
    + '<div class="stat">Opening Balance<b>' + fmt(r.openingBalance) + '</b></div>'
    + '<div class="stat">New Demands Added<b>' + fmt(r.newDemandsAdded) + '</b></div>'
    + '<div class="stat">Closed / Eliminated<b>' + fmt(r.closedEliminated) + '</b></div>'
    + '<div class="stat">Appeal / HC / Others<b>' + fmt(r.appealHcOthers) + '</b></div>'
    + '<div class="stat">Closing Balance<b>' + fmt(r.closingBalance) + '</b></div>'
    + '</div>'
    + (rows ? ('<table><thead><tr><th>GSTIN</th><th>Demand ID</th><th>Type</th><th>Amount (₹)</th><th>Remarks</th></tr></thead><tbody>' + rows + '</tbody></table>')
      : '<p>No individual demand changes in this reconciliation — only new demands were added.</p>')
    + '</body></html>'
  );
  win.document.close();
}

function wizDownloadReconciliationReport() {
  var r = AppState.lastReconciliation;
  if (!r) { showToast('⚠️ No reconciliation report yet'); return; }
  var summarySheet = XLSX.utils.json_to_sheet([
    { Metric: 'Opening Balance', 'Amount (₹)': r.openingBalance },
    { Metric: 'New Demands Added', 'Amount (₹)': r.newDemandsAdded },
    { Metric: 'Closed / Eliminated', 'Amount (₹)': r.closedEliminated },
    { Metric: 'Appeal / HC / Others', 'Amount (₹)': r.appealHcOthers },
    { Metric: 'Closing Balance', 'Amount (₹)': r.closingBalance }
  ]);
  var detailRows = (r.details || []).map(function (d) {
    return { GSTIN: d.gstin, 'Demand ID': d.demandId, Type: d.type, 'Amount (₹)': d.amount, Remarks: d.remarks };
  });
  var detailSheet = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ GSTIN: '', 'Demand ID': '', Type: '', 'Amount (₹)': '', Remarks: 'No individual demand changes — only new demands were added.' }]);

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Details');
  var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/octet-stream' }), 'DCR_Reconciliation_Report_' + todayISO() + '.xlsx');
}

/* Wires the native file input's change event — the dropzone's own drag/drop
   listeners are rebound per-render in wizWireDCRUploadZone(). */
function wireImportPage() {
  var input = document.getElementById('dcr-file-input');
  if (!input) return;
  input.addEventListener('change', function (e) {
    if (e.target.files.length) handleDCRFiles(e.target.files);
    input.value = '';
  });
}
