// Fixture page behavior. The counter proves page-owned event handlers keep
// working (interact mode, undo-after-remove); the stats fetch exercises
// network mocking.
(function () {
  var count = 0;
  var counterBtn = document.getElementById('counter-btn');
  if (counterBtn) {
    counterBtn.addEventListener('click', function () {
      count += 1;
      counterBtn.textContent = 'Clicked ' + count + ' times';
    });
  }

  function loadStats() {
    return fetch('/api/stats')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        document.getElementById('stat-users').textContent = String(data.users);
        document.getElementById('stat-revenue').textContent = String(data.revenue);
        document.getElementById('stat-uptime').textContent = String(data.uptime);
      })
      .catch(function () {
        document.getElementById('stat-users').textContent = 'error';
      });
  }

  var refresh = document.getElementById('refresh-stats');
  if (refresh) refresh.addEventListener('click', loadStats);
  loadStats();

  var form = document.getElementById('feedback-form');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = form.querySelector('[name=email]');
      var status = document.getElementById('form-status');
      if (!email.value || email.value.indexOf('@') === -1) {
        status.textContent = 'Please enter a valid email.';
        status.className = 'form-status error';
        return;
      }
      status.textContent = 'Thanks for the feedback!';
      status.className = 'form-status ok';
      form.reset();
    });
  }
})();
