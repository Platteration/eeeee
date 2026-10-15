const notice = document.getElementById('startup');
const retry = document.getElementById('startup-retry');
retry.addEventListener('click', () => location.reload());
try {
  await import('./app.js');
  for (const region of document.querySelectorAll('[data-editor-region]')) region.inert = false;
  notice.hidden = true;
  // Offline copies of the editor's own files (never of plots); see sw.js for the strategy.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
} catch {
  document.getElementById('startup-message').textContent = 'ABPlot could not start. Check your connection and use an up-to-date browser, then reload. Saved plots and recovery copies have not been cleared.';
  retry.hidden = false;
}
