// Classic (non-module) script loaded in <head>: applies the saved theme before
// first paint to avoid a flash. Kept out of index.html so the CSP needs no inline scripts.
try {
  var saved = JSON.parse(localStorage.getItem('arrowGarden.v1') || '{}').theme;
  var dark = saved === 'dark' || (saved !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}
