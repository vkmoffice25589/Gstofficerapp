/* ===== DCR Excel import (Demand & Collection Register) ===== */

function addLog(logEl, msg, cls) {
  var line = document.createElement('div');
  line.className = 'log-line ' + (cls === 'ok' ? 'log-ok' : cls === 'err' ? 'log-err' : 'log-warn');
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

async function handleDCRFiles(files) {
  var resultsEl = document.getElementById('import-results');
  var log = document.getElementById('import-log');
  if (resultsEl) resultsEl.style.display = 'block';
  log.innerHTML = '';
  addLog(log, '📌 Processing ' + files.length + ' file(s)...', 'warn');
  addLog(log, '⏳ Loading Excel engine...', 'warn');
  await window.LibsReady;

  var remaining = files.length;

  Array.from(files).forEach(function (file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(e.target.result, { type: 'array', cellDates: false, raw: false });
        var sheetName = wb.SheetNames.find(function (n) { return n.trim().toUpperCase() === 'DCR'; }) || wb.SheetNames[0];
        var ws = wb.Sheets[sheetName];
        if (!ws) { addLog(log, '❌ ' + file.name + ' — No sheet found', 'err'); return; }

        addLog(log, '📄 ' + file.name + ' — Sheet: "' + sheetName + '", reading rows...', 'warn');

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

        var range = XLSX.utils.decode_range(ws['!ref']);
        addLog(log, '   Range: rows ' + (range.s.r + 1) + '-' + (range.e.r + 1) + ', cols ' + (range.s.c + 1) + '-' + (range.e.c + 1), 'warn');

        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        addLog(log, '   Total rows read: ' + rows.length, 'warn');

        // Financial Year — derive from the "From Date:" header cell (e.g. "2020-01-01" -> "2019-20").
        // Real DCR exports carry the quarter's actual From/To dates here, not a literal FY label.
        var fy = 'Unknown';
        for (var ri = 0; ri < Math.min(8, rows.length) && fy === 'Unknown'; ri++) {
          for (var ci = 0; ci < Math.min(5, rows[ri].length) - 1; ci++) {
            var label = String(rows[ri][ci] || '').trim().toLowerCase();
            if (label === 'from date:' || label === 'from date') {
              var dm = String(rows[ri][ci + 1] || '').trim().match(/^(\d{4})-(\d{2})-\d{2}/);
              if (dm) {
                var y = parseInt(dm[1], 10), mo = parseInt(dm[2], 10);
                var fyStart = mo >= 4 ? y : y - 1;
                fy = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
              }
              break;
            }
          }
        }
        // Fallback for sheets without a From Date cell — accept only a genuine FY-shaped label
        // (e.g. "2019-20"), not an incidental "yyyy-mm" date fragment.
        if (fy === 'Unknown') {
          var fyPattern = /20(\d{2})-(\d{2})/;
          for (var rif = 0; rif < Math.min(8, rows.length) && fy === 'Unknown'; rif++) {
            for (var cif = 0; cif < Math.min(5, rows[rif].length); cif++) {
              var m = String(rows[rif][cif] || '').match(fyPattern);
              if (m && m[2] === String((parseInt(m[1], 10) + 1) % 100).padStart(2, '0')) { fy = m[0]; break; }
            }
          }
        }
        addLog(log, '   Financial Year: ' + fy, 'warn');

        // Header row detection — look for "demand id" in the first 15 rows.
        var dataStartRow = 10;
        for (var i = 0; i < Math.min(15, rows.length); i++) {
          var rowStr = rows[i].join(' ').toLowerCase();
          if (rowStr.includes('demand id') || rowStr.includes('demand\nid')) {
            dataStartRow = i + 2;
            addLog(log, '   Header found at row ' + (i + 1) + ', data starts row ' + (dataStartRow + 1), 'warn');
            break;
          }
        }

        var imported = 0, updated = 0, skipped = 0;
        var preImportSnapshot = AppState.cases.map(function (c) {
          return { demandId: c.demandId, gstin: c.gstin, pend_total: c.pend_total, demandStatus: c.demandStatus };
        });

        var toNum = function (v) { var n = parseFloat(String(v || '0').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

        // Fixed 25-column layout: 0 DemandID, 1 Date, 2 Source, 3 IssuingAuthority, 4 GSTIN,
        // 5 LegalName, 6 Mobile, 7 TaxPeriod, 8 Section, 9 DCR_date, 10 DemandRaisedBy,
        // 11-15 orig(igst,cgst,sgst,cess,total), 16-20 pend(igst,cgst,sgst,cess,total),
        // 21 demandStatus, 22 recoveryId, 23 recoveryStatus.
        var GCOL = 4, NCOL = 5, TPCOL = 7, SECCOL = 8, DCRCOL = 9, OICOL = 11, PICOL = 16, DSCOL = 21, RICOL = 22, RSCOL = 23;

        for (var ri2 = dataStartRow; ri2 < rows.length; ri2++) {
          var r = rows[ri2];
          if (!r || !r.length) continue;

          var demandId = String(r[0] || '').trim();
          if (!demandId) continue;
          var didLower = demandId.toLowerCase();
          if (['demand', 'date', 'total', 'grand', 'financial', 'period', 'sl.', 'sr.'].some(function (w) { return didLower.includes(w); })) continue;
          if (!/^[A-Za-z]{1,3}[0-9]/.test(demandId)) continue;

          var gstin = String(r[GCOL] || '').trim().toUpperCase();
          if (!gstin || gstin.length < 10) { skipped++; continue; }

          var existingIdx = AppState.cases.findIndex(function (c) { return c.demandId === demandId; });

          var c = {
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
          };

          if (existingIdx >= 0) {
            var ex = AppState.cases[existingIdx];
            ex.pend_igst = c.pend_igst; ex.pend_cgst = c.pend_cgst; ex.pend_sgst = c.pend_sgst;
            ex.pend_cess = c.pend_cess; ex.pend_total = c.pend_total;
            ex.demandStatus = c.demandStatus; ex.recoveryStatus = c.recoveryStatus; ex.recoveryId = c.recoveryId;
            ex.importedAt = c.importedAt;
            updated++;
          } else {
            AppState.cases.push(c);
            imported++;
          }
        }

        AppState.lastImportAt = new Date().toISOString();
        AppState.lastImportFileName = file.name;
        persist();
        runPostImportReconciliation(preImportSnapshot);
        addLog(log, '✅ ' + file.name + ' (FY ' + fy + ') — ' + imported + ' new, ' + updated + ' updated, ' + skipped + ' skipped', 'ok');
        renderImportPreview();
        updateSidebar();
        if (typeof renderWizardStepper === 'function') renderWizardStepper();
        if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
      } catch (err) {
        addLog(log, '❌ ' + file.name + ' — Error: ' + err.message, 'err');
        console.error(err);
      } finally {
        remaining--;
        if (remaining === 0) showToast('✅ DCR import complete');
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* Reconciliation — detects collections/eliminations/dropped demands between imports. */
function reconcileDCR(oldCases, newCases) {
  var newMap = {};
  newCases.forEach(function (c) { newMap[c.demandId] = c; });

  oldCases.forEach(function (old) {
    var fresh = newMap[old.demandId];
    if (!fresh) {
      AppState.reconciliationLog.push({
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

    AppState.reconciliationLog.push({
      id: uid('recon'), gstin: old.gstin, demandId: old.demandId, date: todayISO(), type: type, amount: diff,
      remarks: isElim ? 'Demand closed and revision demand created' : (newPend === 0 ? 'Fully paid' : 'Partial payment — pending reduced from ' + fmt(oldPend) + ' to ' + fmt(newPend)),
      createdAt: new Date().toISOString()
    });
  });

  persist();
}

function runPostImportReconciliation(oldSnapshot) {
  if (!oldSnapshot || !oldSnapshot.length) return;
  reconcileDCR(oldSnapshot, AppState.cases);
}

function renderImportPreview() {
  var wrap = document.getElementById('import-preview');
  if (!wrap) return;
  var valid = AppState.cases.filter(isValidCase);
  var uniqueGstins = new Set(valid.map(function (c) { return c.gstin; })).size;
  var totalPend = valid.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
  var fys = Array.from(new Set(valid.map(function (c) { return c.fy; }).filter(Boolean)));

  wrap.innerHTML =
    '<div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:0;">' +
    '<div class="scard blue"><div class="slabel">Total Cases</div><div class="sval blue">' + AppState.cases.length + '</div><div class="ssub">' + valid.length + ' valid</div></div>' +
    '<div class="scard gold"><div class="slabel">Unique Taxpayers</div><div class="sval gold">' + uniqueGstins + '</div><div class="ssub">by GSTIN</div></div>' +
    '<div class="scard red"><div class="slabel">Total Pending</div><div class="sval red" style="font-size:16px;">' + fmt(totalPend) + '</div><div class="ssub">across all valid cases</div></div>' +
    '<div class="scard green"><div class="slabel">Financial Years</div><div class="sval green" style="font-size:14px;">' + (fys.join(', ') || '—') + '</div><div class="ssub">' + fys.length + ' loaded</div></div>' +
    '</div>';
}

/* Upload zone is now the "Upload DCR" stepper card on the Generate Arrear Notice
   wizard (see wizWireStepperUploads() in wizard.js) — this only wires the file input. */
function wireImportPage() {
  var input = document.getElementById('dcr-file-input');
  if (!input) return;
  input.addEventListener('change', function (e) { if (e.target.files.length) handleDCRFiles(e.target.files); });
  renderImportPreview();
}
