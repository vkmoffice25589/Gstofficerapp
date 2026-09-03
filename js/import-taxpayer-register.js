/* ===== Taxpayer Register import (Active / Cancelled / Suspended lists) ===== */

async function handleTaxpayerRegisterFile(file) {
  if (!file) return;
  var logEl = document.getElementById('tp-reg-log');
  var statusEl = document.getElementById('tp-reg-status');
  logEl.style.display = 'block';
  logEl.innerHTML = '⏳ Loading Excel engine...';
  if (statusEl) statusEl.textContent = '';
  await window.LibsReady;
  logEl.innerHTML = '⏳ Reading file...';

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows.length) { logEl.innerHTML = '❌ Empty file!'; return; }

      var header = rows[0].map(function (h) { return String(h).toLowerCase().trim(); });
      function findCol(keywords) {
        for (var k = 0; k < keywords.length; k++) {
          for (var i = 0; i < header.length; i++) {
            if (header[i].indexOf(keywords[k]) !== -1) return i;
          }
        }
        return -1;
      }

      var gstinCol = findCol(['gstin', 'gst no', 'gst number']);
      var legalCol = findCol(['legal name', 'legal  name', 'legalname']);
      var tradeCol = findCol(['trade name', 'trade  name', 'tradename']);
      var addrCol = findCol(['address of principal', 'principal place', 'address', 'ppob']);
      var statusCol = findCol(['registration status', 'reg status', 'taxpayer status', 'status']);

      if (gstinCol === -1) { logEl.innerHTML = '❌ GSTIN column not found! Check file format.'; return; }
      if (addrCol === -1) { logEl.innerHTML = '❌ Address column not found! Check file format.'; return; }

      var mapped = 0, updated = 0, skipped = 0;

      for (var r = 1; r < rows.length; r++) {
        var row = rows[r];
        var gstin = String(row[gstinCol] || '').trim().toUpperCase();
        var legal = legalCol >= 0 ? String(row[legalCol] || '').trim() : '';
        var trade = tradeCol >= 0 ? String(row[tradeCol] || '').trim() : '';
        var address = String(row[addrCol] || '').trim();
        var regSt = statusCol >= 0 ? String(row[statusCol] || '').trim() : '';

        if (gstin.length !== 15 || !address) { skipped++; continue; }

        var existed = !!AppState.addressCache[gstin];
        AppState.addressCache[gstin] = {
          legalName: legal,
          tradeName: trade === legal ? '' : trade,
          address: address,
          regStatus: regSt
        };
        if (existed) updated++; else mapped++;
      }

      AppState.lastRegisterImportAt = new Date().toISOString();
      AppState.lastRegisterImportFileName = file.name;
      persist();

      logEl.innerHTML =
        '✅ <strong>Taxpayer Register imported successfully!</strong><br>' +
        '📌 Columns detected — GSTIN: Col ' + (gstinCol + 1) + ' | Address: Col ' + (addrCol + 1) +
        (legalCol >= 0 ? ' | Legal Name: Col ' + (legalCol + 1) : ' | ⚠️ Legal Name: not found') +
        (tradeCol >= 0 ? ' | Trade Name: Col ' + (tradeCol + 1) : ' | ⚠️ Trade Name: not found (won\'t display)') +
        (statusCol >= 0 ? ' | Reg Status: Col ' + (statusCol + 1) : ' | ⚠️ Reg Status: not found (collectible filter disabled)') + '<br>' +
        '🆕 New GSTINs mapped: <strong>' + mapped + '</strong><br>' +
        '🔄 Existing updated: <strong>' + updated + '</strong><br>' +
        '⏭ Skipped (invalid): <strong>' + skipped + '</strong><br>' +
        '📦 Total in cache: <strong>' + Object.keys(AppState.addressCache).length + '</strong>';

      if (statusEl) statusEl.textContent = '✅ ' + (mapped + updated) + ' GSTINs loaded';
      showToast('✅ Taxpayer Register imported! ' + (mapped + updated) + ' addresses mapped.');
      renderTaxpayerRegisterSummary();
      updateSidebar();
      if (typeof renderWizardStepper === 'function') renderWizardStepper();
      if (typeof renderReports === 'function') renderReports();
      if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
    } catch (err) {
      logEl.innerHTML = '❌ Error reading file: ' + err.message;
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
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
    '</div>';
}

/* Upload zone is now the "Upload Taxpayer Register" stepper card on the Generate
   Arrear Notice wizard (see wizWireStepperUploads() in wizard.js) — this only wires the file input. */
function wireTaxpayerRegisterPage() {
  var input = document.getElementById('tp-reg-input');
  if (!input) return;
  input.addEventListener('change', function (e) { if (e.target.files.length) handleTaxpayerRegisterFile(e.target.files[0]); });
  renderTaxpayerRegisterSummary();
}
