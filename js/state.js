/* ===== Central application state + persistence ===== */

var APP_VERSION = '1.0.0';

var AppState = {
  cases: [],               // DCR demand records
  notices: [],              // issued arrear notices
  bankAtts: [],              // bank attachments
  thirdPartyNotices: [],      // DRC-13 third-party debtor notices
  propertyAttachments: [],     // Section 79(d) property attachments
  followups: [],
  paymentRecords: [],          // manual payment entries
  arrearRegister: [],             // Arrear Action Register — roster of taxpayers being tracked
  arrearActions: [],               // Arrear Action Register — case-wise action history entries (per GSTIN, many per type)
  reconciliationLog: [],        // auto-detected collection/elimination events from re-imports
  addressCache: {},              // GSTIN -> { legalName, tradeName, address, regStatus }
  dcrFiles: [],                  // { id, fileName, fy, quarter, quarterLabel, records, uploadedAt, demandIds } per uploaded DCR file
  taxpayerRegisterFiles: [],     // { id, fileName, status, records, uploadedAt } per uploaded Active/Cancelled/Suspended file
  lastReconciliation: null,      // summary tiles + detail rows for the most recent DCR upload/reconcile batch
  lastImportAt: null,
  lastImportFileName: null,
  lastImportFileSize: null,
  lastRegisterImportAt: null,
  lastRegisterImportFileName: null,
  lastRegisterImportFileSize: null
};

var STORAGE_KEYS = {
  cases: 'dcr_cases',
  notices: 'dcr_notices',
  bankAtts: 'dcr_banks',
  thirdPartyNotices: 'dcr_third_party',
  propertyAttachments: 'dcr_property',
  followups: 'dcr_fu',
  paymentRecords: 'dcr_payments',
  arrearRegister: 'dcr_arrear_register',
  arrearActions: 'dcr_arrear_actions',
  reconciliationLog: 'dcr_recon',
  addressCache: 'dcr_addr',
  dcrFiles: 'dcr_files',
  taxpayerRegisterFiles: 'dcr_tp_reg_files',
  lastReconciliation: 'dcr_last_reconciliation',
  settings: 'office_settings',
  version: 'app_version',
  lastImportAt: 'dcr_last_import',
  lastImportFileName: 'dcr_last_import_name',
  lastImportFileSize: 'dcr_last_import_size',
  lastRegisterImportAt: 'dcr_last_register_import',
  lastRegisterImportFileName: 'dcr_last_register_import_name',
  lastRegisterImportFileSize: 'dcr_last_register_import_size'
};

var defaultSettings = {
  division: 'Chennai North Division',
  circle: 'Villivakkam Assessment Circle',
  addr1: 'No.1 PAPJM Annex Building, 2nd Floor, Room No. 204,',
  addr2: 'Greams Road, Chennai 600 006.',
  desig: 'Assistant Commissioner (ST),(FAC)',
  city: 'Chennai-6',
  officerName: ''
};

function getSettings() {
  try {
    var s = localStorage.getItem(STORAGE_KEYS.settings);
    return s ? Object.assign({}, defaultSettings, JSON.parse(s)) : Object.assign({}, defaultSettings);
  } catch (e) {
    return Object.assign({}, defaultSettings);
  }
}

function saveSettingsObject(s) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
}

/* Category keys stored in IndexedDB — mirrors AppState's array/object
   fields (everything except the small lastImport... / lastRegisterImport...
   strings, which live together in the 'meta' store since they're tiny). */
var IDB_CATEGORY_KEYS = [
  'cases', 'notices', 'bankAtts', 'thirdPartyNotices', 'propertyAttachments',
  'followups', 'paymentRecords', 'arrearRegister', 'arrearActions',
  'reconciliationLog', 'addressCache', 'dcrFiles', 'taxpayerRegisterFiles', 'lastReconciliation'
];

var Storage = {
  /* ---------- Load ---------- */
  load: function () {
    return idbAvailable().then(function (available) {
      if (!available) return Storage._loadFromLocalStorage();
      return Storage._migrateFromLocalStorageIfNeeded().then(function () {
        return Promise.all(IDB_CATEGORY_KEYS.map(function (k) { return idbGet(k, 'v'); }).concat([idbGet('meta', 'v')]));
      }).then(function (results) {
        IDB_CATEGORY_KEYS.forEach(function (k, i) {
          AppState[k] = results[i] !== undefined ? results[i] : (k === 'addressCache' ? {} : (k === 'lastReconciliation' ? null : []));
        });
        var meta = results[results.length - 1] || {};
        AppState.lastImportAt = meta.lastImportAt || null;
        AppState.lastImportFileName = meta.lastImportFileName || null;
        AppState.lastImportFileSize = meta.lastImportFileSize || null;
        AppState.lastRegisterImportAt = meta.lastRegisterImportAt || null;
        AppState.lastRegisterImportFileName = meta.lastRegisterImportFileName || null;
        AppState.lastRegisterImportFileSize = meta.lastRegisterImportFileSize || null;
      });
    }).catch(function (e) {
      console.error('Storage.load error — falling back to localStorage:', e);
      return Storage._loadFromLocalStorage();
    }).then(function () {
      Storage.compactEmbeddedCases();
    });
  },

  /* One-time copy of any pre-existing localStorage data into IndexedDB, run
     once (marked via meta.migrated) so upgrading never loses data already
     on a user's machine. The old localStorage keys are removed afterwards
     — that's what actually frees up the old ~5-10MB quota. */
  _migrateFromLocalStorageIfNeeded: function () {
    return idbGet('meta', 'v').then(function (meta) {
      if (meta && meta.migrated) return;
      var hasLegacy = !!localStorage.getItem(STORAGE_KEYS.cases) || !!localStorage.getItem(STORAGE_KEYS.notices) || !!localStorage.getItem(STORAGE_KEYS.addressCache);
      if (!hasLegacy) return idbPut('meta', 'v', { migrated: true });

      console.log('Storage: migrating existing data from localStorage to IndexedDB…');
      var writes = IDB_CATEGORY_KEYS.map(function (k) {
        var fallback = (k === 'addressCache') ? '{}' : (k === 'lastReconciliation' ? 'null' : '[]');
        var value = JSON.parse(localStorage.getItem(STORAGE_KEYS[k]) || fallback);
        return idbPut(k, 'v', value);
      });
      var metaObj = {
        migrated: true,
        lastImportAt: localStorage.getItem(STORAGE_KEYS.lastImportAt) || null,
        lastImportFileName: localStorage.getItem(STORAGE_KEYS.lastImportFileName) || null,
        lastImportFileSize: localStorage.getItem(STORAGE_KEYS.lastImportFileSize) || null,
        lastRegisterImportAt: localStorage.getItem(STORAGE_KEYS.lastRegisterImportAt) || null,
        lastRegisterImportFileName: localStorage.getItem(STORAGE_KEYS.lastRegisterImportFileName) || null,
        lastRegisterImportFileSize: localStorage.getItem(STORAGE_KEYS.lastRegisterImportFileSize) || null
      };
      writes.push(idbPut('meta', 'v', metaObj));

      return Promise.all(writes).then(function () {
        Object.keys(STORAGE_KEYS).forEach(function (k) {
          if (k === 'settings' || k === 'version') return; // these stay in localStorage — tiny, never a bloat risk
          localStorage.removeItem(STORAGE_KEYS[k]);
        });
        console.log('Storage: migration to IndexedDB complete — old localStorage data cleared.');
      });
    });
  },

  /* Fallback path only — used if IndexedDB is genuinely unavailable. */
  _loadFromLocalStorage: function () {
    try {
      AppState.cases = JSON.parse(localStorage.getItem(STORAGE_KEYS.cases) || '[]');
      AppState.notices = JSON.parse(localStorage.getItem(STORAGE_KEYS.notices) || '[]');
      AppState.bankAtts = JSON.parse(localStorage.getItem(STORAGE_KEYS.bankAtts) || '[]');
      AppState.thirdPartyNotices = JSON.parse(localStorage.getItem(STORAGE_KEYS.thirdPartyNotices) || '[]');
      AppState.propertyAttachments = JSON.parse(localStorage.getItem(STORAGE_KEYS.propertyAttachments) || '[]');
      AppState.followups = JSON.parse(localStorage.getItem(STORAGE_KEYS.followups) || '[]');
      AppState.paymentRecords = JSON.parse(localStorage.getItem(STORAGE_KEYS.paymentRecords) || '[]');
      AppState.arrearRegister = JSON.parse(localStorage.getItem(STORAGE_KEYS.arrearRegister) || '[]');
      AppState.arrearActions = JSON.parse(localStorage.getItem(STORAGE_KEYS.arrearActions) || '[]');
      AppState.reconciliationLog = JSON.parse(localStorage.getItem(STORAGE_KEYS.reconciliationLog) || '[]');
      AppState.addressCache = JSON.parse(localStorage.getItem(STORAGE_KEYS.addressCache) || '{}');
      AppState.dcrFiles = JSON.parse(localStorage.getItem(STORAGE_KEYS.dcrFiles) || '[]');
      AppState.taxpayerRegisterFiles = JSON.parse(localStorage.getItem(STORAGE_KEYS.taxpayerRegisterFiles) || '[]');
      AppState.lastReconciliation = JSON.parse(localStorage.getItem(STORAGE_KEYS.lastReconciliation) || 'null');
      AppState.lastImportAt = localStorage.getItem(STORAGE_KEYS.lastImportAt) || null;
      AppState.lastImportFileName = localStorage.getItem(STORAGE_KEYS.lastImportFileName) || null;
      AppState.lastImportFileSize = localStorage.getItem(STORAGE_KEYS.lastImportFileSize) || null;
      AppState.lastRegisterImportAt = localStorage.getItem(STORAGE_KEYS.lastRegisterImportAt) || null;
      AppState.lastRegisterImportFileName = localStorage.getItem(STORAGE_KEYS.lastRegisterImportFileName) || null;
      AppState.lastRegisterImportFileSize = localStorage.getItem(STORAGE_KEYS.lastRegisterImportFileSize) || null;
    } catch (e) {
      console.error('Storage._loadFromLocalStorage error:', e);
    }
  },
  /* Notices/bank attachments/third-party notices/property attachments saved
     before caseSnapshot() existed still carry the full DCR row (~18 fields)
     per embedded demand instead of the ~11 fields actually used to reprint
     a document. Re-map every embedded case list down to the lean snapshot
     on load — this is idempotent (a no-op once already compacted) and is
     usually what actually recovers the storage space, since a small DCR
     can still leave behind years of full-size embedded snapshots in
     historical notices/attachments. */
  compactEmbeddedCases: function () {
    if (typeof caseSnapshots !== 'function') return;
    var changed = false;
    function compactList(list) {
      (list || []).forEach(function (rec) {
        if (!rec || !rec.cases || !rec.cases.length) return;
        var before = JSON.stringify(rec.cases);
        var lean = caseSnapshots(rec.cases);
        if (JSON.stringify(lean) !== before) { rec.cases = lean; changed = true; }
      });
    }
    compactList(AppState.notices);
    compactList(AppState.bankAtts);
    compactList(AppState.thirdPartyNotices);
    compactList(AppState.propertyAttachments);
    if (changed) {
      console.log('Storage: compacted embedded DCR snapshots in notices/attachments to free up space.');
      Storage.save();
    }
  },
  /* Fire-and-forget from every caller's point of view (nothing in the app
     needs to `await persist()`) — AppState is already updated synchronously
     by the caller before this runs, so the UI already reflects the change;
     this just needs to eventually land on disk. */
  save: function () {
    return idbAvailable().then(function (available) {
      if (!available) return Storage._saveToLocalStorage();
      return Storage._saveToIndexedDB();
    }).then(function () {
      Storage._onSaveOk();
    }).catch(function (e) {
      Storage._onSaveFail(e);
    });
  },

  _saveToIndexedDB: function () {
    var meta = {
      migrated: true,
      lastImportAt: AppState.lastImportAt, lastImportFileName: AppState.lastImportFileName, lastImportFileSize: AppState.lastImportFileSize,
      lastRegisterImportAt: AppState.lastRegisterImportAt, lastRegisterImportFileName: AppState.lastRegisterImportFileName, lastRegisterImportFileSize: AppState.lastRegisterImportFileSize
    };
    var writes = IDB_CATEGORY_KEYS.map(function (k) { return idbPut(k, 'v', AppState[k]); });
    writes.push(idbPut('meta', 'v', meta));
    return Promise.all(writes);
  },

  /* Fallback path only — used if IndexedDB is genuinely unavailable. Keeps
     the exact same all-or-nothing localStorage behavior as before, quota
     limitations included, since there's no larger store to fall back to. */
  _saveToLocalStorage: function () {
    localStorage.setItem(STORAGE_KEYS.cases, JSON.stringify(AppState.cases));
    localStorage.setItem(STORAGE_KEYS.notices, JSON.stringify(AppState.notices));
    localStorage.setItem(STORAGE_KEYS.bankAtts, JSON.stringify(AppState.bankAtts));
    localStorage.setItem(STORAGE_KEYS.thirdPartyNotices, JSON.stringify(AppState.thirdPartyNotices));
    localStorage.setItem(STORAGE_KEYS.propertyAttachments, JSON.stringify(AppState.propertyAttachments));
    localStorage.setItem(STORAGE_KEYS.followups, JSON.stringify(AppState.followups));
    localStorage.setItem(STORAGE_KEYS.paymentRecords, JSON.stringify(AppState.paymentRecords));
    localStorage.setItem(STORAGE_KEYS.arrearRegister, JSON.stringify(AppState.arrearRegister));
    localStorage.setItem(STORAGE_KEYS.arrearActions, JSON.stringify(AppState.arrearActions));
    localStorage.setItem(STORAGE_KEYS.reconciliationLog, JSON.stringify(AppState.reconciliationLog));
    localStorage.setItem(STORAGE_KEYS.addressCache, JSON.stringify(AppState.addressCache));
    localStorage.setItem(STORAGE_KEYS.dcrFiles, JSON.stringify(AppState.dcrFiles));
    localStorage.setItem(STORAGE_KEYS.taxpayerRegisterFiles, JSON.stringify(AppState.taxpayerRegisterFiles));
    localStorage.setItem(STORAGE_KEYS.lastReconciliation, JSON.stringify(AppState.lastReconciliation || null));
    localStorage.setItem(STORAGE_KEYS.version, APP_VERSION);
    if (AppState.lastImportAt) localStorage.setItem(STORAGE_KEYS.lastImportAt, AppState.lastImportAt);
    if (AppState.lastImportFileName) localStorage.setItem(STORAGE_KEYS.lastImportFileName, AppState.lastImportFileName);
    if (AppState.lastImportFileSize) localStorage.setItem(STORAGE_KEYS.lastImportFileSize, AppState.lastImportFileSize);
    if (AppState.lastRegisterImportAt) localStorage.setItem(STORAGE_KEYS.lastRegisterImportAt, AppState.lastRegisterImportAt);
    if (AppState.lastRegisterImportFileName) localStorage.setItem(STORAGE_KEYS.lastRegisterImportFileName, AppState.lastRegisterImportFileName);
    if (AppState.lastRegisterImportFileSize) localStorage.setItem(STORAGE_KEYS.lastRegisterImportFileSize, AppState.lastRegisterImportFileSize);
  },

  _onSaveOk: function () {
    if (window.__storageQuotaExceeded) {
      window.__storageQuotaExceeded = false;
      var okBanner = document.getElementById('save-banner');
      if (okBanner) okBanner.classList.remove('show');
      if (typeof showToast === 'function') showToast('✅ Storage recovered — data is saving normally again');
    }
  },
  _onSaveFail: function (e) {
    var isQuota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    console.error('Storage.save error' + (isQuota ? ' (storage full)' : '') + ':', e);
    window.__storageQuotaExceeded = true;
    var banner = document.getElementById('save-banner');
    if (banner) {
      var textEl = document.getElementById('save-banner-text');
      if (textEl) textEl.textContent = 'Storage full — your latest changes (possibly including DCR) were NOT saved. Export a backup now, then clear old/unused data.';
      banner.classList.add('show');
    }
    if (typeof showToast === 'function') showToast('❌ Storage full — latest changes may not be saved');
  },
  backup: function () {
    var data = {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      cases: AppState.cases,
      notices: AppState.notices,
      bankAtts: AppState.bankAtts,
      thirdPartyNotices: AppState.thirdPartyNotices,
      propertyAttachments: AppState.propertyAttachments,
      followups: AppState.followups,
      paymentRecords: AppState.paymentRecords,
      arrearRegister: AppState.arrearRegister,
      arrearActions: AppState.arrearActions,
      reconciliationLog: AppState.reconciliationLog,
      addressCache: AppState.addressCache,
      dcrFiles: AppState.dcrFiles,
      taxpayerRegisterFiles: AppState.taxpayerRegisterFiles,
      lastReconciliation: AppState.lastReconciliation,
      settings: getSettings()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'GST_Recovery_Backup_' + todayISO() + '.json';
    a.click();
    showToast('💾 Backup exported');
  },
  restoreFromObject: function (data) {
    if (!data || typeof data !== 'object') { showToast('❌ Invalid backup file'); return false; }
    AppState.cases = data.cases || [];
    AppState.notices = data.notices || [];
    AppState.bankAtts = data.bankAtts || [];
    AppState.thirdPartyNotices = data.thirdPartyNotices || [];
    AppState.propertyAttachments = data.propertyAttachments || [];
    AppState.followups = data.followups || [];
    AppState.paymentRecords = data.paymentRecords || [];
    AppState.arrearRegister = data.arrearRegister || [];
    AppState.arrearActions = data.arrearActions || [];
    AppState.reconciliationLog = data.reconciliationLog || [];
    AppState.addressCache = data.addressCache || {};
    AppState.dcrFiles = data.dcrFiles || [];
    AppState.taxpayerRegisterFiles = data.taxpayerRegisterFiles || [];
    AppState.lastReconciliation = data.lastReconciliation || null;
    if (data.settings) saveSettingsObject(data.settings);
    Storage.save();
    showToast('✅ Backup restored');
    return true;
  },
  clear: function () {
    if (!confirm('⚠️ Delete ALL DCR data (cases, notices, attachments, register)? This cannot be undone.')) return;
    Object.keys(STORAGE_KEYS).forEach(function (k) {
      if (k === 'settings' || k === 'version') return; // keep office settings
      localStorage.removeItem(STORAGE_KEYS[k]);
    });
    idbAvailable().then(function (available) {
      if (!available) return;
      return idbClearAll().then(function () { return idbPut('meta', 'v', { migrated: true }); });
    }).catch(function (e) { console.error('Storage.clear (IndexedDB) error:', e); });

    AppState.cases = []; AppState.notices = []; AppState.bankAtts = [];
    AppState.thirdPartyNotices = []; AppState.propertyAttachments = [];
    AppState.followups = []; AppState.paymentRecords = []; AppState.reconciliationLog = [];
    AppState.arrearRegister = []; AppState.arrearActions = [];
    AppState.addressCache = {}; AppState.lastImportAt = null; AppState.lastImportFileName = null; AppState.lastImportFileSize = null;
    AppState.lastRegisterImportAt = null; AppState.lastRegisterImportFileName = null; AppState.lastRegisterImportFileSize = null;
    AppState.dcrFiles = []; AppState.taxpayerRegisterFiles = []; AppState.lastReconciliation = null;
    showToast('🗑 All data cleared');
    nav('dashboard');
  }
};

function persist() { Storage.save(); }
