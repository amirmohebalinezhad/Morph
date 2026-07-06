// External script (allowed by script-src 'self') so the page has some life.
document.getElementById('csp-btn').addEventListener('click', function () {
  document.getElementById('csp-text').textContent = 'Button clicked at ' + new Date().toISOString();
});
