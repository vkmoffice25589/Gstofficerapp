/* ===== Settings page ===== */

function fillSettingsForm(s) {
  document.getElementById('cfg-division').value = s.division || '';
  document.getElementById('cfg-circle').value = s.circle || '';
  document.getElementById('cfg-addr1').value = s.addr1 || '';
  document.getElementById('cfg-addr2').value = s.addr2 || '';
  document.getElementById('cfg-desig').value = s.desig || '';
  document.getElementById('cfg-city').value = s.city || '';
  document.getElementById('cfg-officer-name').value = s.officerName || '';
}

function updateSettingsPreview(s) {
  var el = document.getElementById('settings-preview');
  if (!el) return;
  el.textContent =
    'Office of the ' + s.desig + ',\n' + s.circle + ',\n' + s.addr1 + '\n' + s.addr2 + '\nDated: DD-MM-YYYY\n\n' +
    '--- [ notice body ] ---\n\n' + s.desig + ',\n' + s.circle + ',\n' + s.city;
}

function updateSidebarOfficeCard(s) {
  var hc = document.getElementById('hdr-office-circle');
  var hdg = document.getElementById('hdr-desig');
  var hdv = document.getElementById('hdr-division');
  var hi = document.getElementById('hdr-avatar-initials');
  if (hc) hc.textContent = s.circle;
  if (hdg) hdg.textContent = s.desig;
  if (hdv) hdv.textContent = s.division;
  if (hi) hi.textContent = designationInitials(s.desig);
}

/* e.g. "Assistant Commissioner (ST),(FAC)" -> "AC" */
function designationInitials(desig) {
  var words = String(desig || '').replace(/[(),.]/g, ' ').trim().split(/\s+/).filter(Boolean);
  var initials = words.slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  return initials || 'GO';
}

function saveSettings() {
  var s = {
    division: document.getElementById('cfg-division').value.trim() || defaultSettings.division,
    circle: document.getElementById('cfg-circle').value.trim() || defaultSettings.circle,
    addr1: document.getElementById('cfg-addr1').value.trim() || defaultSettings.addr1,
    addr2: document.getElementById('cfg-addr2').value.trim() || defaultSettings.addr2,
    desig: document.getElementById('cfg-desig').value.trim() || defaultSettings.desig,
    city: document.getElementById('cfg-city').value.trim() || defaultSettings.city,
    officerName: document.getElementById('cfg-officer-name').value.trim()
  };
  saveSettingsObject(s);
  var statusEl = document.getElementById('settings-status');
  statusEl.textContent = '✅ Saved!';
  setTimeout(function () { statusEl.textContent = ''; }, 2500);
  updateSettingsPreview(s);
  updateSidebarOfficeCard(s);
  if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
}

function loadDefaultSettings() {
  var s = Object.assign({}, defaultSettings);
  fillSettingsForm(s);
  updateSettingsPreview(s);
}

function initSettingsPage() {
  var s = getSettings();
  fillSettingsForm(s);
  updateSettingsPreview(s);
}
