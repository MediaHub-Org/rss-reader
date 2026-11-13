// Run before the app bundle and first paint, including under script-src 'self'.
(function () {
  var pref = {};
  try {
    pref = JSON.parse(localStorage.getItem('rss-reader:prefs') || '{}') || {};
  } catch (_) {
    // Blocked storage or damaged preferences should follow the system theme.
  }
  var theme = pref.theme;
  var dark = theme === 'dark' ||
    (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  if (pref.density) root.dataset.density = pref.density;
  if (pref.fontSize) root.dataset.fontSize = pref.fontSize;
})();
