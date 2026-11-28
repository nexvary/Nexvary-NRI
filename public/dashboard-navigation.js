document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[data-dashboard-nav]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (link.target && link.target !== '_self')) return;
  const status = document.getElementById('dashboard-navigation-status');
  const main = document.getElementById('main');
  if (status) status.hidden = false;
  main?.setAttribute('aria-busy', 'true');
});
