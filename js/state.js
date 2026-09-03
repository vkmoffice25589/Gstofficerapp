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
  reconciliationLog: [],        // auto-detected collection/elimination events from re-imports
  addressCache: {},              // GSTIN -> { legalName, tradeName, address, regStatus }
  lastImportAt: null,
  lastImportFileName: null,
  lastRegisterImportAt: null,
  lastRegisterImportFileName: null
};

var STORAGE_KEYS = {
  cases: 'dcr_cases',
  notices: 'dcr_notices',
  bankAtts: 'dcr_banks',
  thirdPartyNotices: 'dcr_third_party',
  propertyAttachments: 'dcr_property',
  followups: 'dcr_fu',
  paymentRecords: 'dcr_payments',
  reconciliationLog: 'dcr_recon',
  addressCache: 'dcr_addr',
  settings: 'office_settings',
  version: 'app_version',
  lastImportAt: 'dcr_last_import',
  lastImportFileName: 'dcr_last_import_name',
  lastRegisterImportAt: 'dcr_last_register_import',
  lastRegisterImportFileName: 'dcr_last_register_import_name'
};

var defaultSettings = {
  division: 'Chennai North Division',
  circle: 'Villivakkam Assessment Circle',
  addr1: 'No.1 PAPJM Annex Building, 2nd Floor, Room No. 204,',
  addr2: 'Greams Road, Chennai 600 006.',
  desig: 'Assistant Commissioner (ST),(FAC)',
  city: 'Chennai-6'
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

var Storage = {
  load: function () {
    try {
      AppState.cases = JSON.parse(localStorage.getItem(STORAGE_KEYS.cases) || '[]');
      AppState.notices = JSON.parse(localStorage.getItem(STORAGE_KEYS.notices) || '[]');
      AppState.bankAtts = JSON.parse(localStorage.getItem(STORAGE_KEYS.bankAtts) || '[]');
      AppState.thirdPartyNotices = JSON.parse(localStorage.getItem(STORAGE_KEYS.thirdPartyNotices) || '[]');
      AppState.propertyAttachments = JSON.parse(localStorage.getItem(STORAGE_KEYS.propertyAttachments) || '[]');
      AppState.followups = JSON.parse(localStorage.getItem(STORAGE_KEYS.followups) || '[]');
      AppState.paymentRecords = JSON.parse(localStorage.getItem(STORAGE_KEYS.paymentRecords) || '[]');
      AppState.reconciliationLog = JSON.parse(localStorage.getItem(STORAGE_KEYS.reconciliationLog) || '[]');
      AppState.addressCache = JSON.parse(localStorage.getItem(STORAGE_KEYS.addressCache) || '{}');
      AppState.lastImportAt = localStorage.getItem(STORAGE_KEYS.lastImportAt) || null;
      AppState.lastImportFileName = localStorage.getItem(STORAGE_KEYS.lastImportFileName) || null;
      AppState.lastRegisterImportAt = localStorage.getItem(STORAGE_KEYS.lastRegisterImportAt) || null;
      AppState.lastRegisterImportFileName = localStorage.getItem(STORAGE_KEYS.lastRegisterImportFileName) || null;
    } catch (e) {
      console.error('Storage.load error:', e);
    }
  },
  save: function () {
    try {
      localStorage.setItem(STORAGE_KEYS.cases, JSON.stringify(AppState.cases));
      localStorage.setItem(STORAGE_KEYS.notices, JSON.stringify(AppState.notices));
      localStorage.setItem(STORAGE_KEYS.bankAtts, JSON.stringify(AppState.bankAtts));
      localStorage.setItem(STORAGE_KEYS.thirdPartyNotices, JSON.stringify(AppState.thirdPartyNotices));
      localStorage.setItem(STORAGE_KEYS.propertyAttachments, JSON.stringify(AppState.propertyAttachments));
      localStorage.setItem(STORAGE_KEYS.followups, JSON.stringify(AppState.followups));
      localStorage.setItem(STORAGE_KEYS.paymentRecords, JSON.stringify(AppState.paymentRecords));
      localStorage.setItem(STORAGE_KEYS.reconciliationLog, JSON.stringify(AppState.reconciliationLog));
      localStorage.setItem(STORAGE_KEYS.addressCache, JSON.stringify(AppState.addressCache));
      localStorage.setItem(STORAGE_KEYS.version, APP_VERSION);
      if (AppState.lastImportAt) localStorage.setItem(STORAGE_KEYS.lastImportAt, AppState.lastImportAt);
      if (AppState.lastImportFileName) localStorage.setItem(STORAGE_KEYS.lastImportFileName, AppState.lastImportFileName);
      if (AppState.lastRegisterImportAt) localStorage.setItem(STORAGE_KEYS.lastRegisterImportAt, AppState.lastRegisterImportAt);
      if (AppState.lastRegisterImportFileName) localStorage.setItem(STORAGE_KEYS.lastRegisterImportFileName, AppState.lastRegisterImportFileName);
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded — saving cases only');
        try { localStorage.setItem(STORAGE_KEYS.cases, JSON.stringify(AppState.cases)); } catch (e2) { console.error('Cannot save:', e2); }
      } else {
        console.error('Storage.save error:', e);
      }
    }
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
      reconciliationLog: AppState.reconciliationLog,
      addressCache: AppState.addressCache,
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
    AppState.reconciliationLog = data.reconciliationLog || [];
    AppState.addressCache = data.addressCache || {};
    if (data.settings) saveSettingsObject(data.settings);
    Storage.save();
    showToast('✅ Backup restored');
    return true;
  },
  clear: function () {
    if (!confirm('⚠️ Delete ALL DCR data (cases, notices, attachments, register)? This cannot be undone.')) return;
    Object.keys(STORAGE_KEYS).forEach(function (k) {
      if (k === 'settings') return; // keep office settings
      localStorage.removeItem(STORAGE_KEYS[k]);
    });
    AppState.cases = []; AppState.notices = []; AppState.bankAtts = [];
    AppState.thirdPartyNotices = []; AppState.propertyAttachments = [];
    AppState.followups = []; AppState.paymentRecords = []; AppState.reconciliationLog = [];
    AppState.addressCache = {}; AppState.lastImportAt = null; AppState.lastImportFileName = null;
    AppState.lastRegisterImportAt = null; AppState.lastRegisterImportFileName = null;
    showToast('🗑 All data cleared');
    nav('dashboard');
  }
};

function persist() { Storage.save(); }
