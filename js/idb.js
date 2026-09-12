/* ===== Minimal IndexedDB key-value wrapper =====
   One object store per AppState category, each holding a single record
   (keyed by the constant 'v'). This is deliberately simple — not a full
   relational schema — because the goal is just to swap out localStorage's
   ~5-10MB hard cap and blocking, all-or-nothing writes for IndexedDB's much
   larger (typically hundreds of MB+) and non-blocking storage, without
   having to rewrite how the rest of the app reads/writes AppState (it
   stays a plain in-memory object exactly as before). */

var IDB_NAME = 'gst_recovery_db';
/* Bumped 1 -> 2 to add the 'taxpayerRegisterFiles' store — IndexedDB only
   runs onupgradeneeded (where new stores get created) when the version
   number increases, so a database already created at version 1 on a
   user's machine would never gain the new store without this bump. */
var IDB_VERSION = 2;
var IDB_STORES = [
  'cases', 'notices', 'bankAtts', 'thirdPartyNotices', 'propertyAttachments',
  'followups', 'paymentRecords', 'arrearRegister', 'arrearActions',
  'reconciliationLog', 'addressCache', 'dcrFiles', 'taxpayerRegisterFiles', 'lastReconciliation', 'meta'
];

var _idbPromise = null;
var _idbAvailable = null; // null = not yet checked, true/false once known

function idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB not supported in this browser')); return; }
    var req;
    try {
      req = indexedDB.open(IDB_NAME, IDB_VERSION);
    } catch (e) { reject(e); return; }
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      IDB_STORES.forEach(function (name) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      });
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    req.onblocked = function () { reject(new Error('IndexedDB open blocked')); };
  });
  return _idbPromise;
}

/* Cached after the first real check so every save doesn't re-probe. */
function idbAvailable() {
  if (_idbAvailable !== null) return Promise.resolve(_idbAvailable);
  return idbOpen().then(function () { _idbAvailable = true; return true; })
    .catch(function () { _idbAvailable = false; return false; });
}

function idbGet(store, key) {
  return idbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(store, 'readonly'); } catch (e) { reject(e); return; }
      var req = tx.objectStore(store).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function idbPut(store, key, value) {
  return idbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(store, 'readwrite'); } catch (e) { reject(e); return; }
      tx.objectStore(store).put(value, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  });
}

function idbClearAll() {
  return idbOpen().then(function (db) {
    return Promise.all(IDB_STORES.map(function (store) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(store, 'readwrite'); } catch (e) { reject(e); return; }
        tx.objectStore(store).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    }));
  });
}
