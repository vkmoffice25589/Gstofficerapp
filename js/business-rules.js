/* ===== Core business rules — preserved from the reference implementation ===== */

/* Filters out header/summary rows that leak into parsed DCR data. */
function isValidCase(c) {
  if (!c || !c.demandId) return false;
  var did = String(c.demandId).trim().toLowerCase();
  if (!did) return false;
  var badWords = ['demand', 'date', 'total', 'grand', 'financial', 'period', 'sl.', 'sr.', 'tax per', 'section', 'act'];
  for (var i = 0; i < badWords.length; i++) { if (did.includes(badWords[i])) return false; }
  if (!/^[a-z]{1,3}[0-9]/i.test(c.demandId)) return false;
  var tp = String(c.taxPeriod || '').toLowerCase();
  var fy = String(c.fy || '').toLowerCase();
  if (tp.includes('date') || tp.includes('period')) return false;
  if (fy.includes('date') || fy.includes('period')) return false;
  if (!c.gstin || String(c.gstin).trim().length < 10) return false;
  return true;
}

/* Notices/bank attachments/third-party notices/property attachments each
   embed the specific demands they cover, so a historical document can be
   reprinted with the exact figures as they stood when it was issued (DCR
   data changes over time — that's a real, deliberate feature). But every
   caller only ever reads a handful of fields off those embedded cases
   (see docx-export.js/pdf-export.js/notices.js demand tables) — not the
   full ~18-field DCR row (orig_* amounts, demandStatus, recoveryStatus,
   recoveryId, importedAt, gstin, legalName are all unused there, and
   gstin/legalName are redundant with the parent record anyway). Storing
   the full row per demand per document, forever, is what fills up
   localStorage over time even when the live DCR itself stays small.
   This trims to exactly what's read back later. */
function caseSnapshot(c) {
  return {
    demandId: c.demandId, taxPeriod: c.taxPeriod, section: c.section,
    dcr_date: c.dcr_date, demandDate: c.demandDate, fy: c.fy,
    pend_igst: c.pend_igst, pend_cgst: c.pend_cgst, pend_sgst: c.pend_sgst, pend_cess: c.pend_cess, pend_total: c.pend_total
  };
}
function caseSnapshots(list) { return (list || []).map(caseSnapshot); }

var EXCLUDED_STATUSES = [
  'Appeal Application Submitted - Tribunal',
  'Appeal Filed against Waiver Rejection Order',
  'Appeal filed at High Court',
  'Demand Closed and Revised Demand Created',
  'Demand Settled',
  'Demand under Waiver Scheme',
  'Demand Withdrawn',
  'First Appeal Application Admitted',
  'First Appeal Application Submitted',
  'First Appeal Order Issued- Demand Closed',
  'Interest/Penalty Waived off',
  'Interest/Penalty Waived off - Demand Closed',
  'Refund Due',
  'Refund Order issued',
  'Refund filed against order'
];

/* A case is eligible for a recovery notice only if it has real pending tax
   and isn't parked at a higher forum / closed / refund status. */
function isNoticeEligible(c) {
  var pend = Number(c.pend_total) || 0;
  if (pend <= 0) return false;
  if (c.demandStatus && EXCLUDED_STATUSES.some(function (s) {
    return c.demandStatus.trim().toLowerCase() === s.toLowerCase();
  })) return false;
  return true;
}

function getExclusionReason(c) {
  var pend = Number(c.pend_total) || 0;
  if (pend <= 0) return pend < 0 ? 'Negative pending' : 'Zero pending';
  if (c.demandStatus && EXCLUDED_STATUSES.some(function (s) {
    return c.demandStatus.trim().toLowerCase() === s.toLowerCase();
  })) return 'Higher forum — ' + c.demandStatus;
  return null;
}

/* Age of a demand in days, from dcr_date/demandDate. Unparseable dates
   return null and callers must treat that as "include in every bucket". */
function getDemandAgeDays(c) {
  var d = parseDcrDate(c.dcr_date || c.demandDate);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function isNoticeTypeMatch(c, noticeType) {
  if (!noticeType) return true;
  var age = getDemandAgeDays(c);
  if (age === null) return true; // unknown date — include in both buckets
  return noticeType === 'urgent' ? age >= 90 : age < 90;
}

/* Register (Active/Cancelled/Suspended taxpayer list) collectibility. */
function isCollectible(gstin) {
  var info = AppState.addressCache[gstin];
  if (!info || !info.regStatus) return null; // unknown — register not loaded for this GSTIN
  var s = info.regStatus.toLowerCase();
  return s === 'active' || s === 'act' || s.startsWith('active');
}

function hasRegisterData() {
  return Object.values(AppState.addressCache).some(function (v) { return v && v.regStatus; });
}

/* Canonical "what name do we show for this taxpayer" lookup — the Taxpayer
   Register only ever carries a trade name (matched by GSTIN), never a legal
   name, so every taxpayer-name display in the app should prefer the
   register's trade name and fall back to the DCR's legal name, not the
   other way round. Centralised here instead of each list/table re-deriving
   its own fallback so a register re-import fixes every screen at once. */
function taxpayerDisplayName(gstin, legalNameFallback) {
  var reg = AppState.addressCache[gstin] || AppState.addressCache[(gstin || '').toUpperCase()];
  return (reg && reg.tradeName) || legalNameFallback || (reg && reg.legalName) || '—';
}

/* Companion to taxpayerDisplayName() for screens that show Trade Name and
   Legal Name side by side (Search GSTIN bar, Arrear Action Register detail
   drawer). Many sole proprietors trade under their own name, so the
   register's trade name and the DCR's legal name are often genuinely
   identical — repeating the exact same text under both labels reads as a
   bug, so this collapses that case to a plain "Same as Trade Name" note
   instead of printing the name twice. */
function taxpayerLegalNameCell(gstin, legalName) {
  var reg = AppState.addressCache[gstin] || AppState.addressCache[(gstin || '').toUpperCase()];
  var trade = ((reg && reg.tradeName) || '').trim();
  if (trade && legalName && trade.toLowerCase() === String(legalName).trim().toLowerCase()) return 'Same as Trade Name';
  return legalName || '—';
}

function isSection62Excluded(c, excludeSec62) {
  return excludeSec62 && String(c.section || '').trim() === '62';
}

/* Bulk-notice eligibility map. "Recoverable" is a COMPUTED status — a case is
   recoverable whenever isNoticeEligible(c) passes (positive pending, not
   parked in an excluded/closed/appeal/refund/waiver status) — exactly the same
   definition the Dashboard's own "Recoverable" pill uses (see dashboard.js,
   which derives it from eligibleCases.length, never from the raw DCR
   recoveryStatus column). That raw column's real-world values are things like
   "Recovery Initiated" / "NA" / "Recovered" — it does not reliably contain the
   literal word "Recoverable" — so this must not gate eligibility on it.
   noticeType ('intimation'|'urgent'|''), excludeSec62 (Section 62 toggle),
   opts { odFrom, odTo, tpFrom, tpTo } — same Order Date / Tax Period range
   filters the Issue Notice wizard's Advanced Filters drawer offers. */
function getTaxpayerMap(noticeType, excludeSec62, opts) {
  opts = opts || {};
  var map = {};
  AppState.cases.filter(isValidCase).forEach(function (c) {
    if (!isNoticeEligible(c)) return;
    if (!isNoticeTypeMatch(c, noticeType)) return;
    if (isSection62Excluded(c, excludeSec62)) return;
    if (opts.odFrom || opts.odTo) {
      var d = parseDcrDate(c.dcr_date || c.demandDate);
      if (d) {
        if (opts.odFrom && d < new Date(opts.odFrom)) return;
        if (opts.odTo && d > new Date(opts.odTo + 'T23:59:59')) return;
      }
    }
    if (opts.tpFrom && (c.taxPeriod || '').toUpperCase().indexOf(opts.tpFrom.toUpperCase()) === -1) return;
    if (opts.tpTo && (c.taxPeriod || '').toUpperCase().indexOf(opts.tpTo.toUpperCase()) === -1) return;
    if (!map[c.gstin]) map[c.gstin] = { gstin: c.gstin, legalName: c.legalName, cases: [] };
    map[c.gstin].cases.push(c);
  });
  Object.keys(map).forEach(function (g) { if (!map[g].cases.length) delete map[g]; });
  return map;
}

/* Same filter chain as getTaxpayerMap, but reports the demand count remaining
   after each stage — lets the Bulk Notice screen show exactly which filter
   zeroed out the results, instead of just a final "0". */
function bulkFilterFunnel(noticeType, excludeSec62, opts) {
  opts = opts || {};
  var valid = AppState.cases.filter(isValidCase);
  var eligible = valid.filter(isNoticeEligible);
  var typeMatched = eligible.filter(function (c) { return isNoticeTypeMatch(c, noticeType); });
  var sec62Matched = typeMatched.filter(function (c) { return !isSection62Excluded(c, excludeSec62); });
  var final = sec62Matched.filter(function (c) {
    if (opts.odFrom || opts.odTo) {
      var d = parseDcrDate(c.dcr_date || c.demandDate);
      if (d) {
        if (opts.odFrom && d < new Date(opts.odFrom)) return false;
        if (opts.odTo && d > new Date(opts.odTo + 'T23:59:59')) return false;
      }
    }
    if (opts.tpFrom && (c.taxPeriod || '').toUpperCase().indexOf(opts.tpFrom.toUpperCase()) === -1) return false;
    if (opts.tpTo && (c.taxPeriod || '').toUpperCase().indexOf(opts.tpTo.toUpperCase()) === -1) return false;
    return true;
  });
  return {
    totalValid: valid.length,
    eligible: eligible.length,
    typeMatched: typeMatched.length,
    sec62Matched: sec62Matched.length,
    final: final.length,
    finalGstins: new Set(final.map(function (c) { return c.gstin; })).size
  };
}

/**
 * THE single canonical per-GSTIN aggregation used by Reports AND the Dashboard.
 * Groups all valid cases by GSTIN, sums pending arrear, and splits each group's
 * cases into eligibleCases (notice-eligible AND recoveryStatus contains
 * "Recoverable") vs ineligibleCases — identical rule Reports has always used.
 */
function computeGstinGroups(caseList) {
  var source = (caseList || AppState.cases).filter(isValidCase);
  var byGstin = {};
  source.forEach(function (c) {
    var gstin = String(c.gstin || '').trim();
    if (!byGstin[gstin]) {
      byGstin[gstin] = { gstin: gstin, legalName: c.legalName, total: 0, demands: 0, cases: [], eligibleCases: [], ineligibleCases: [] };
    }
    var g = byGstin[gstin];
    g.total += Number(c.pend_total) || 0;
    g.demands++;
    g.cases.push(c);
    if (isNoticeEligible(c) && (c.recoveryStatus || '').includes('Recoverable')) {
      g.eligibleCases.push(c);
    } else {
      g.ineligibleCases.push(c);
    }
  });
  return Object.values(byGstin);
}

function eligibleTotal(group) {
  return group.eligibleCases.reduce(function (s, c) { return s + (Number(c.pend_total) || 0); }, 0);
}

function classifyCollectibility(group) {
  var hasReg = hasRegisterData();
  var hasEligible = group.eligibleCases.length > 0;
  if (!hasEligible) return 'noncollectible';
  if (hasReg && isCollectible(group.gstin) === false) return 'noncollectible';
  return 'collectible';
}
