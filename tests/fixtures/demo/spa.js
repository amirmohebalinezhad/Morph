// Naive "framework": blows away and rebuilds #spa-root, destroying any
// in-memory edits inside it. Triggered manually (deterministic for tests).
(function () {
  var renders = 0;
  function render() {
    renders += 1;
    var root = document.getElementById('spa-root');
    root.innerHTML =
      '<h2>Rendered view (pass ' + renders + ')</h2>' +
      '<p class="subtitle" id="spa-note">This subtree is replaced wholesale on every render.</p>' +
      '<button class="btn btn-primary" id="spa-action" data-testid="spa-action">Action</button>';
  }
  document.getElementById('rerender-btn').addEventListener('click', render);
  render();
})();
