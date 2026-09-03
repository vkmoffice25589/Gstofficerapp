/* ===== Shared utility / formatting helpers (single canonical copy of each) ===== */

function fmt(n) {
  n = Number(n) || 0;
  if (n === 0) return '₹0';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmt0(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/* Parses a DCR date value in any of the formats the real files use — ISO
   (YYYY-MM-DD), slash/dash DD/MM/YYYY (1 or 2 digit day/month), or a raw
   Excel serial-date number/string — into a Date, or null if unparseable.
   Single source of truth so age/range filters agree with what fmtDate displays. */
function parseDcrDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw) ? null : raw;
  var s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var d1 = new Date(s);
    if (!isNaN(d1)) return d1;
  }
  if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(s)) {
    var p = s.split(/[\/-]/);
    var d2 = new Date(p[2] + '-' + p[1] + '-' + p[0]);
    if (!isNaN(d2)) return d2;
  }
  if (!isNaN(s)) {
    var d3 = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d3)) return d3;
  }
  return null;
}

function fmtDate(d) {
  if (!d) return '—';
  if (d instanceof Date) return d.toLocaleDateString('en-IN');
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    var dt = new Date(d);
    if (!isNaN(dt)) return dt.toLocaleDateString('en-IN');
  }
  if (typeof d === 'string' && /^\d{2}[\/-]\d{2}[\/-]\d{4}/.test(d)) return d;
  if (!isNaN(d) && d !== '') {
    var date = new Date((Number(d) - 25569) * 86400 * 1000);
    if (!isNaN(date)) return date.toLocaleDateString('en-IN');
  }
  return String(d);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function numToWords(n) {
  if (!n || n === 0) return 'Zero';
  var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n < 0) return 'Minus ' + numToWords(-n);
  n = Math.round(n);
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + numToWords(n % 100) : '');
  if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
  if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
  return numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
}

function recoveryPill(rs) {
  if (!rs || rs === 'NA') return '<span class="pill pill-gray">—</span>';
  if (rs.includes('Not Recoverable')) return '<span class="pill pill-gray">Not Recoverable</span>';
  if (rs.includes('Terminated') || rs.includes('Waived')) return '<span class="pill pill-gold">Terminated</span>';
  if (rs === 'Recovered') return '<span class="pill pill-green"><i class="fa-solid fa-check"></i> Recovered</span>';
  if (rs.includes('Recoverable')) return '<span class="pill pill-red"><i class="fa-solid fa-bolt"></i> Recoverable</span>';
  if (rs.includes('Abeyance')) return '<span class="pill pill-purple">Abeyance</span>';
  return '<span class="pill pill-gray">' + xe(rs) + '</span>';
}

/* HTML-escape for safe interpolation into template strings */
function xe(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._tmr);
  showToast._tmr = setTimeout(function () { t.classList.remove('show'); }, 2600);
}

function validateGSTIN(gstin) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(String(gstin || '').trim().toUpperCase());
}
