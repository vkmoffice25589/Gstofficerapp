/* Loads third-party CDN libraries with a fallback chain, resolves LibsReady when done. */
(function () {
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadFallback(urls) {
    return urls.reduce(function (chain, url) {
      return chain.catch(function () { return loadScript(url); });
    }, Promise.reject());
  }

  window.LibsReady = Promise.all([
    loadFallback(['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js']),
    loadFallback(['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js']),
    loadFallback(['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js']),
    loadFallback(['https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js'])
  ]).then(function () {
    return loadFallback(['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js']);
  }).catch(function (e) { console.warn('Library load failed:', e); });
})();
