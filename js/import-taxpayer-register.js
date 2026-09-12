/* ===== Taxpayer Register import (Active / Cancelled / Suspended lists) =====
   These are raw MIS_REG_03 exports straight off the GST portal, not a clean
   table: ~8 rows of report title/filter metadata sit above the real header
   row, the header row itself uses merged cells (so most header cells come
   back blank to a naive reader), and a numeric "1,2,3.." sub-header row sits
   between the header and the first data row. There is also no per-row
   "status" column — the file AS A WHOLE is either the Active, Cancelled or
   Suspended list, named in its own title cell (e.g. "List of Active
   Taxpayer"), so status is derived once per file rather than parsed per row. */

/* Same merge-cell expansion import-dcr.js uses: SheetJS only populates the
   top-left cell of a merged range, so copy its value across the range
   before reading — otherwise every header after the first in a merged
   block (and every masked email/mobile cell GST exports merge) reads blank. */
function expandMergedCells(ws) {
  if (!ws['!merges']) return;
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

/* Column keyword map — each column is found by scanning the detected header
   row for a cell whose lowercased text contains the keyword. Almost every
   column the portal export offers is captured (not just GSTIN/name/address)
   since the officer asked for "almost all" of it. */
var TP_REG_COLUMNS = {
  gstin: ['gstin'],
  name: ['trade name', 'legal name'],
  email: ['email'],
  mobile: ['mobile'],
  assignedTo: ['assigned to'],
  regDate: ['effective date of registration'],
  taxpayerType: ['type of taxpayer'],
  constitution: ['constitution of business'],
  rule14A: ['registered under rule 14a'],
  rule14AWithdrawalDate: ['date of withdrawal from rule 14a'],
  isMigrated: ['is_migrated', 'is migrated'],
  jurisdiction: ['lowest jurisdiction'],
  hsnCode: ['hsn code'],
  address: ['address of principal', 'principal place'],
  additionalPlaces: ['no. of additional place', 'additional place'],
  cancellationEffectiveDate: ['effective date of cancellation'],
  cancellationOrderDate: ['cancellation order date'],
  cancellationType: ['type of cancellation'],
  cancellationReason: ['reason for cancellation'],
  remarks: ['remarks'],
  suspensionDate: ['suspension date'],
  regStatusCol: ['registration status', 'reg status', 'taxpayer status']
};

function deriveRegStatusFromTitle(titleText) {
  var t = (titleText || '').toLowerCase();
  if (t.indexOf('active') !== -1) return 'Active';
  if (t.indexOf('cancel') !== -1) return 'Cancelled';
  if (t.indexOf('suspend') !== -1) return 'Suspended';
  return '';
}

/* Parses one workbook into { status, rows, totalReported, error }. Never
   touches AppState — the caller merges every file's rows in together so
   partial failures in a later file don't lose an earlier one. */
function parseTaxpayerRegisterWorkbook(arrayBuffer, fileName) {
  var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, raw: false });
  var ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { error: 'No sheet found in ' + fileName };

  expandMergedCells(ws);
  var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if (!rows.length) return { error: fileName + ' is empty' };

  var titleText = String(rows[0][0] || '');
  var status = deriveRegStatusFromTitle(titleText);

  var totalReported = null;
  for (var tr = 0; tr < Math.min(10, rows.length); tr++) {
    var m = String(rows[tr][0] || '').match(/total records found\s*=\s*([\d,]+)/i);
    if (m) { totalReported = parseInt(m[1].replace(/,/g, ''), 10); break; }
  }

  var headerRowIdx = -1;
  for (var hi = 0; hi < Math.min(15, rows.length); hi++) {
    if ((rows[hi] || []).some(function (cell) { return String(cell || '').trim().toLowerCase() === 'gstin'; })) { headerRowIdx = hi; break; }
  }
  if (headerRowIdx === -1) return { error: fileName + ' — could not find the GSTIN header row (unexpected file format)' };

  var header = rows[headerRowIdx].map(function (h) { return String(h || '').toLowerCase().trim(); });
  var colIdx = {};
  Object.keys(TP_REG_COLUMNS).forEach(function (key) {
    var keywords = TP_REG_COLUMNS[key];
    colIdx[key] = -1;
    for (var k = 0; k < keywords.length; k++) {
      for (var c = 0; c < header.length; c++) {
        if (header[c].indexOf(keywords[k]) !== -1) { colIdx[key] = c; break; }
      }
      if (colIdx[key] !== -1) break;
    }
  });
  if (colIdx.gstin === -1) return { error: fileName + ' — GSTIN column not found' };
  if (colIdx.address === -1) return { error: fileName + ' — Address column not found' };

  function val(row, key) { var c = colIdx[key]; return c === -1 ? '' : String(row[c] || '').trim(); }

  var dataStartRow = headerRowIdx + 2; // header row, then a numeric "1,2,3.." sub-row, then real data
  var parsed = [];
  for (var ri = dataStartRow; ri < rows.length; ri++) {
    var row = rows[ri];
    if (!row || !row.length) continue;
    var gstin = val(row, 'gstin').toUpperCase();
    var address = val(row, 'address');
    if (gstin.length !== 15 || !address) continue;

    var name = val(row, 'name');
    var rowStatus = status || val(row, 'regStatusCol');

    parsed.push({
      gstin: gstin, legalName: name, tradeName: '', address: address, regStatus: rowStatus,
      email: val(row, 'email'), mobile: val(row, 'mobile'), assignedTo: val(row, 'assignedTo'),
      regDate: val(row, 'regDate'), taxpayerType: val(row, 'taxpayerType'), constitution: val(row, 'constitution'),
      rule14A: val(row, 'rule14A'), rule14AWithdrawalDate: val(row, 'rule14AWithdrawalDate'), isMigrated: val(row, 'isMigrated'),
      jurisdiction: val(row, 'jurisdiction'), hsnCode: val(row, 'hsnCode'), additionalPlaces: val(row, 'additionalPlaces'),
      cancellationEffectiveDate: val(row, 'cancellationEffectiveDate'), cancellationOrderDate: val(row, 'cancellationOrderDate'),
      cancellationType: val(row, 'cancellationType'), cancellationReason: val(row, 'cancellationReason'), remarks: val(row, 'remarks'),
      suspensionDate: val(row, 'suspensionDate')
    });
  }

  return { status: status || '(status not detected)', rows: parsed, totalReported: totalReported, fileName: fileName };
}

function readFileAsArrayBuffer(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function (e) { resolve(e.target.result); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsArrayBuffer(file);
  });
}

/* Accepts a FileList/array of files (the 3-zone UI normally sends one file
   at a time, but this still accepts several — e.g. drag-dropping all three
   onto one zone still works). Every row gets tagged with the id of the file
   it came from, so a file can later be individually removed the same way a
   DCR file can. */
async function handleTaxpayerRegisterFiles(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  var logEl = document.getElementById('tp-reg-log');
  var statusEl = document.getElementById('tp-reg-status');
  if (logEl) { logEl.style.display = 'block'; logEl.innerHTML = '⏳ Loading Excel engine...'; }
  if (statusEl) statusEl.textContent = '';
  await window.LibsReady;

  var fileSummaries = [];
  var mapped = 0, updated = 0;

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (logEl) logEl.innerHTML = '⏳ Reading ' + xe(file.name) + ' (' + (i + 1) + ' of ' + files.length + ')...';
    try {
      var buf = await readFileAsArrayBuffer(file);
      var result = parseTaxpayerRegisterWorkbook(buf, file.name);
      if (result.error) { fileSummaries.push('❌ ' + xe(file.name) + ' — ' + xe(result.error)); continue; }

      var fileId = uid('tpregfile');
      result.rows.forEach(function (rec) {
        rec.sourceFileId = fileId;
        var existed = !!AppState.addressCache[rec.gstin];
        AppState.addressCache[rec.gstin] = rec;
        if (existed) updated++; else mapped++;
      });
      AppState.taxpayerRegisterFiles.push({
        id: fileId, fileName: file.name, status: result.status, records: result.rows.length, uploadedAt: new Date().toISOString()
      });

      fileSummaries.push('✅ ' + xe(file.name) + ' — <strong>' + result.status + '</strong>: ' + result.rows.length + ' parsed'
        + (result.totalReported != null && result.totalReported !== result.rows.length ? ' <span style="color:var(--orange);">(portal reports ' + result.totalReported + ')</span>' : ''));
    } catch (err) {
      fileSummaries.push('❌ ' + xe(file.name) + ' — ' + xe(err.message));
      console.error(err);
    }
  }

  AppState.lastRegisterImportAt = new Date().toISOString();
  var latestFile = AppState.taxpayerRegisterFiles[AppState.taxpayerRegisterFiles.length - 1];
  AppState.lastRegisterImportFileName = latestFile ? latestFile.fileName : AppState.lastRegisterImportFileName;
  AppState.lastRegisterImportFileSize = files[files.length - 1] ? files[files.length - 1].size : AppState.lastRegisterImportFileSize;
  persist();

  if (logEl) {
    logEl.innerHTML = '<strong>Taxpayer Register import complete</strong><br>' + fileSummaries.join('<br>') + '<br>'
      + '🆕 New GSTINs mapped: <strong>' + mapped + '</strong> &nbsp; 🔄 Existing updated: <strong>' + updated + '</strong><br>'
      + '📦 Total in register: <strong>' + Object.keys(AppState.addressCache).length + '</strong>';
  }

  if (statusEl) statusEl.textContent = '✅ ' + (mapped + updated) + ' GSTINs loaded';
  showToast('✅ Taxpayer Register imported! ' + (mapped + updated) + ' GSTINs mapped.');
  updateSidebar();
  if (typeof renderWizardStepper === 'function') renderWizardStepper();
  if (typeof renderReports === 'function') renderReports();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
}

/* Kept as a thin single-file wrapper for any external caller expecting the
   old one-file-at-a-time signature. */
function handleTaxpayerRegisterFile(file) {
  if (!file) return;
  return handleTaxpayerRegisterFiles([file]);
}

/* ===== Full section renderer — header, three status-coloured upload zones,
   import log, uploaded-files table, register summary + export. Mirrors
   renderDCRSection() in import-dcr.js so the two halves of the Data Upload
   page follow the same structure. Called from renderWizardStepper(). ===== */
function renderTpRegSection() {
  var el = document.getElementById('wizard-tpreg-section');
  if (!el) return;
  var hasReg = hasRegisterData();

  el.innerHTML =
    tpRegPanelHead(hasReg)
    + tpRegZonesRow()
    + '<div id="tp-reg-log" class="import-log" style="display:none;"></div>'
    + '<div id="tp-reg-status" style="margin-top:6px;font-size:12px;color:var(--green);"></div>'
    + taxpayerRegisterFilesTable()
    + '<div id="tp-reg-summary"></div>'
    + '</div>'; // closes .tpreg-panel opened in tpRegPanelHead()

  renderTaxpayerRegisterSummary();
  wizWireTpRegZones();
}

function tpRegPanelHead(hasReg) {
  var lastUploaded = AppState.lastRegisterImportAt ? fmtDateTime(AppState.lastRegisterImportAt) : '—';
  return '<div class="tpreg-panel">'
    + '<div class="dcr-panel-head">'
    + '<div class="dcr-head-left">'
    + '<div class="dcr-head-icon ' + (hasReg ? 'done' : 'pending') + '"><i class="fa-solid ' + (hasReg ? 'fa-circle-check' : 'fa-users') + '"></i></div>'
    + '<div><div class="dcr-title">2. Upload Taxpayer Register <span class="dcr-title-sub">(State &amp; Centre Combined Taxpayer List)</span></div>'
    + '<div class="dcr-desc">Upload the Active, Cancelled and Suspended taxpayer lists from the GST portal — each is auto-detected from the file itself.</div></div>'
    + '</div>'
    + '<div class="dcr-head-right">'
    + '<div class="dcr-last-uploaded"><div class="dlu-label">Last Uploaded On</div><div class="dlu-val">' + xe(lastUploaded) + '</div></div>'
    + '<button type="button" class="btn btn-outline btn-sm" onclick="openTpRegGuidelines()"><i class="fa-solid fa-circle-info"></i> View Guidelines</button>'
    + '</div>'
    + '</div>';
}

var TP_REG_ZONES = [
  { key: 'active', label: 'Active Taxpayers', icon: 'fa-user-check', color: 'green' },
  { key: 'cancelled', label: 'Cancelled Taxpayers', icon: 'fa-user-xmark', color: 'red' },
  { key: 'suspended', label: 'Suspended Taxpayers', icon: 'fa-user-clock', color: 'orange' }
];

function tpRegZonesRow() {
  return '<div class="tpreg-zones">' + TP_REG_ZONES.map(function (z) {
    return '<div class="tpreg-zone tpreg-zone-' + z.color + '" id="tpreg-zone-' + z.key + '">'
      + '<div class="tpreg-zone-label"><i class="fa-solid ' + z.icon + '"></i> ' + xe(z.label) + '</div>'
      + '<div class="tpreg-dropzone">'
      + '<i class="fa-solid fa-cloud-arrow-up"></i>'
      + '<div>Drag &amp; drop file here</div>'
      + '<div class="tpreg-or">or</div>'
      + '<button type="button" class="btn btn-sm tpreg-choose-btn" onclick="document.getElementById(\'tpreg-input-' + z.key + '\').click()">Choose File</button>'
      + '<input type="file" id="tpreg-input-' + z.key + '" accept=".xlsx,.xls" style="display:none;"/>'
      + '</div>'
      + '<div class="tpreg-zone-format">.xlsx, .xls</div>'
      + '</div>';
  }).join('') + '</div>';
}

/* Drag/drop + click wiring for all three zones — rebound on every render()
   since the zones are recreated each time (same pattern as the DCR dropzone). */
function wizWireTpRegZones() {
  TP_REG_ZONES.forEach(function (z) {
    var zone = document.getElementById('tpreg-zone-' + z.key);
    var input = document.getElementById('tpreg-input-' + z.key);
    if (!zone || !input) return;
    input.addEventListener('change', function (e) { if (e.target.files.length) handleTaxpayerRegisterFiles(e.target.files); e.target.value = ''; });
    ['dragover', 'dragenter'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer.files.length) handleTaxpayerRegisterFiles(e.dataTransfer.files);
    });
  });
}

function tpRegStatusPill(status) {
  var s = (status || '').toLowerCase();
  var cls = s.startsWith('active') ? 'green' : s.startsWith('cancel') ? 'red' : s.startsWith('suspend') ? 'orange' : 'gray';
  return '<span class="pill pill-' + cls + '">' + xe(status || 'Unknown') + '</span>';
}

function taxpayerRegisterFilesTable() {
  var files = (AppState.taxpayerRegisterFiles || []).slice().sort(function (a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); });
  var body;
  if (!files.length) {
    body = '<div class="empty"><div class="empty-sub">No Taxpayer Register files uploaded yet.</div></div>';
  } else {
    var rows = files.map(function (f) {
      return '<tr>'
        + '<td>' + tpRegStatusPill(f.status) + '</td>'
        + '<td><i class="fa-solid fa-file-excel" style="color:var(--success);margin-right:6px;"></i>' + xe(f.fileName) + '</td>'
        + '<td>' + fmt0(f.records) + '</td>'
        + '<td>' + fmtDateTime(f.uploadedAt) + '</td>'
        + '<td><span class="pill pill-green"><i class="fa-solid fa-check"></i> Uploaded</span></td>'
        + '<td>'
        + '<button type="button" class="icon-btn-outline" title="View file details" onclick="wizViewTaxpayerRegisterFile(\'' + f.id + '\')"><i class="fa-solid fa-eye"></i></button> '
        + '<button type="button" class="icon-btn-danger" title="Delete this file" onclick="wizDeleteTaxpayerRegisterFile(\'' + f.id + '\')"><i class="fa-solid fa-trash"></i></button>'
        + '</td>'
        + '</tr>';
    }).join('');
    body = '<div class="table-wrap"><div class="table-scroll"><table><thead><tr><th>Type</th><th>File Name</th><th>Records</th><th>Uploaded On</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  return '<div class="dcr-files-wrap"><div class="dcr-col-label">Uploaded Taxpayer Register Files</div>' + body + '</div>';
}

function wizViewTaxpayerRegisterFile(fileId) {
  var f = (AppState.taxpayerRegisterFiles || []).find(function (x) { return x.id === fileId; });
  if (!f) return;
  showToast('📄 ' + f.fileName + ' — ' + f.status + ' — ' + fmt0(f.records) + ' records — uploaded ' + fmtDateTime(f.uploadedAt));
}

/* Removes one uploaded file's rows from the register. Unlike DCR files, a
   GSTIN only ever appears in exactly one Active/Cancelled/Suspended file at
   a time, so this can simply drop every addressCache entry tagged with this
   file's id — no cross-file reference counting needed. */
function wizDeleteTaxpayerRegisterFile(fileId) {
  var file = (AppState.taxpayerRegisterFiles || []).find(function (f) { return f.id === fileId; });
  if (!file) return;
  if (!confirm('Delete "' + file.fileName + '" (' + file.status + ') from the Taxpayer Register?\n\n' + file.records + ' taxpayer record(s) will be removed. This cannot be undone.')) return;

  AppState.taxpayerRegisterFiles = AppState.taxpayerRegisterFiles.filter(function (f) { return f.id !== fileId; });
  Object.keys(AppState.addressCache).forEach(function (gstin) {
    if (AppState.addressCache[gstin].sourceFileId === fileId) delete AppState.addressCache[gstin];
  });

  if (!AppState.taxpayerRegisterFiles.length) {
    AppState.lastRegisterImportAt = null; AppState.lastRegisterImportFileName = null; AppState.lastRegisterImportFileSize = null;
  }

  persist();
  updateSidebar();
  if (typeof renderWizardStepper === 'function') renderWizardStepper();
  if (typeof renderReports === 'function') renderReports();
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  showToast('🗑 Taxpayer Register file removed');
}

function renderTaxpayerRegisterSummary() {
  var wrap = document.getElementById('tp-reg-summary');
  if (!wrap) return;
  var total = Object.keys(AppState.addressCache).length;
  if (!total) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fa-solid fa-address-book" style="font-size:40px;color:var(--blue);opacity:0.4;"></i></div><div class="empty-title">No Register Loaded</div><div class="empty-sub">Upload the Active / Cancelled / Suspended taxpayer lists to enable collectibility classification</div></div>';
    return;
  }
  var counts = { active: 0, cancelled: 0, suspended: 0, other: 0 };
  Object.values(AppState.addressCache).forEach(function (v) {
    var s = (v.regStatus || '').toLowerCase();
    if (s.startsWith('active')) counts.active++;
    else if (s.startsWith('cancel')) counts.cancelled++;
    else if (s.startsWith('suspend')) counts.suspended++;
    else counts.other++;
  });
  wrap.innerHTML =
    '<div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:0;">' +
    '<div class="scard blue"><div class="slabel">Total Loaded</div><div class="sval blue">' + total + '</div><div class="ssub">GSTINs in register</div></div>' +
    '<div class="scard green"><div class="slabel">Active</div><div class="sval green">' + counts.active + '</div><div class="ssub">collectible</div></div>' +
    '<div class="scard red"><div class="slabel">Cancelled</div><div class="sval red">' + counts.cancelled + '</div><div class="ssub">non-collectible</div></div>' +
    '<div class="scard orange"><div class="slabel">Suspended</div><div class="sval orange">' + counts.suspended + '</div><div class="ssub">non-collectible</div></div>' +
    '</div>' +
    '<button class="btn btn-blue" style="margin-top:14px;width:100%;justify-content:center;" onclick="exportTaxpayerRegisterExcel()"><i class="fa-solid fa-file-excel"></i> Export Taxpayer Register (Excel)</button>';
}

/* ===== Export — one workbook, one sheet per status, almost every column
   captured on import (not just the handful the rest of the app reads). ===== */
var TP_REG_EXPORT_COLUMNS = [
  ['gstin', 'GSTIN'], ['legalName', 'Trade Name / Legal Name'], ['regStatus', 'Registration Status'],
  ['email', 'Email'], ['mobile', 'Mobile No.'], ['assignedTo', 'Assigned To'],
  ['regDate', 'Effective Date of Registration'], ['taxpayerType', 'Type of Taxpayer'], ['constitution', 'Constitution of Business'],
  ['rule14A', 'Registered under Rule 14A'], ['rule14AWithdrawalDate', 'Date of Withdrawal from Rule 14A'], ['isMigrated', 'Is Migrated'],
  ['jurisdiction', 'Lowest Jurisdiction'], ['hsnCode', 'HSN Code'], ['additionalPlaces', 'No. of Additional Places'],
  ['cancellationEffectiveDate', 'Effective Date of Cancellation'], ['cancellationOrderDate', 'Cancellation Order Date'],
  ['cancellationType', 'Type of Cancellation'], ['cancellationReason', 'Reason for Cancellation'],
  ['suspensionDate', 'Suspension Date'], ['remarks', 'Remarks'], ['address', 'Address of Principal Place of Business']
];

function exportTaxpayerRegisterExcel() {
  var entries = Object.keys(AppState.addressCache).map(function (gstin) {
    var v = AppState.addressCache[gstin];
    return Object.assign({ gstin: gstin }, v);
  });
  if (!entries.length) { showToast('⚠️ No taxpayer register data to export — upload it first'); return; }

  var groups = { Active: [], Cancelled: [], Suspended: [], Other: [] };
  entries.forEach(function (v) {
    var s = (v.regStatus || '').toLowerCase();
    if (s.startsWith('active')) groups.Active.push(v);
    else if (s.startsWith('cancel')) groups.Cancelled.push(v);
    else if (s.startsWith('suspend')) groups.Suspended.push(v);
    else groups.Other.push(v);
  });

  var wb = XLSX.utils.book_new();
  var headers = TP_REG_EXPORT_COLUMNS.map(function (c) { return c[1]; });
  Object.keys(groups).forEach(function (label) {
    var list = groups[label];
    if (!list.length) return;
    var aoa = [headers].concat(list.map(function (v) {
      return TP_REG_EXPORT_COLUMNS.map(function (c) { return v[c[0]] || ''; });
    }));
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = TP_REG_EXPORT_COLUMNS.map(function (c) { return { wch: c[0] === 'address' ? 45 : (c[0] === 'legalName' ? 32 : 16) }; });
    XLSX.utils.book_append_sheet(wb, ws, label);
  });

  XLSX.writeFile(wb, 'Taxpayer_Register_' + todayISO() + '.xlsx');
  showToast('⬇️ Exported ' + entries.length + ' taxpayer(s)');
}

function openTpRegGuidelines() { var ov = document.getElementById('tpreg-guidelines-overlay'); if (ov) ov.classList.add('show'); }
function closeTpRegGuidelines() { var ov = document.getElementById('tpreg-guidelines-overlay'); if (ov) ov.classList.remove('show'); }
