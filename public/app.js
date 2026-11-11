(() => {
  'use strict';

  const ICONS = {
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="m5 12 7 7 7-7"></path></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.4 4.4L19 7.2"></path></svg>',
    spinner:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9" opacity=".9"></path></svg>',
  };

  const state = {
    config: null,
    employee: null,
    attendance: null,
    busy: false,
    clockTimer: null,
    toastTimer: null,
  };

  const el = {};

  function cacheElements() {
    const ids = [
      'loading-view',
      'setup-view',
      'login-view',
      'app-view',
      'setup-title',
      'setup-message',
      'company-name',
      'tz-pill',
      'google-button',
      'login-error',
      'employee-name',
      'signout-btn',
      'live-date',
      'live-time',
      'clock-zone',
      'status-chip',
      'status-text',
      'holiday-pill',
      'shift-pill',
      'punch-btn',
      'punch-label',
      'punch-hint',
      'today-summary',
      'history-list',
      'overlay',
      'overlay-title',
      'overlay-message',
      'overlay-close',
      'toast',
      'footer-company',
      'footer-copy',
    ];
    for (const id of ids) {
      el[id] = document.getElementById(id);
    }
    el.punchIcon = document.querySelector('.punch-btn-icon');
  }

  async function api(path, options = {}) {
    const { redirectOn401 = true, ...fetchOptions } = options;
    const headers = { Accept: 'application/json', ...(fetchOptions.headers || {}) };
    if (typeof fetchOptions.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(path, {
      credentials: 'same-origin',
      ...fetchOptions,
      headers,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text.slice(0, 200) };
      }
    }

    if (!response.ok) {
      const error = new Error((data && data.error) || `Request failed (${response.status}).`);
      error.status = response.status;
      error.data = data;
      if (response.status === 401 && redirectOn401) handleSignedOut();
      throw error;
    }
    return data;
  }

  function showView(name) {
    for (const view of ['loading', 'setup', 'login', 'app']) {
      const node = el[`${view}-view`];
      if (node) node.hidden = view !== name;
    }
  }

  function showSetup(title, message) {
    el['setup-title'].textContent = title;
    el['setup-message'].textContent = message;
    showView('setup');
  }

  function showToast(message, type = 'error', timeout = 6000) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast${type === 'success' ? ' toast--success' : ' toast--error'}`;
    el.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, timeout);
  }

  function setFooterCopy(config) {
    const owner = config.copyrightName || config.companyName || 'Office Attendance';
    const container = el['footer-copy'];
    container.replaceChildren();
    container.append(
      document.createTextNode(
        `© ${new Date().getFullYear()} ${owner}. All rights reserved.`,
      ),
    );

    const contacts = [];
    if (config.contactPhone) {
      contacts.push({
        text: config.contactPhone,
        href: `tel:${String(config.contactPhone).replace(/[^+\d]/g, '')}`,
      });
    }
    if (config.contactEmail) {
      contacts.push({
        text: config.contactEmail,
        href: `mailto:${config.contactEmail}`,
      });
    }

    for (const contact of contacts) {
      const dot = document.createElement('span');
      dot.className = 'footer-dot';
      dot.textContent = '·';
      const link = document.createElement('a');
      link.href = contact.href;
      link.textContent = contact.text;
      container.append(dot, link);
    }
  }

  function applyConfig(config) {
    state.config = config;
    document.title = `Attendance · ${config.companyName}`;
    el['company-name'].textContent = config.companyName;
    el['footer-company'].textContent = config.companyName;
    setFooterCopy(config);
    const zoneName = String(config.timezone || 'UTC')
      .split('/')
      .pop()
      .replace(/_/g, ' ');
    el['tz-pill'].textContent = `Office time · ${zoneName}`;
    el['clock-zone'].textContent = config.timezone || 'UTC';
  }

  function dateLabelShort(dateString) {
    if (!dateString) return '';
    const date = new Date(`${dateString}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date);
  }

  function startClock() {
    stopClock();
    const timezone = (state.config && state.config.timezone) || 'UTC';
    const dateFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const tick = () => {
      const now = new Date();
      el['live-date'].textContent = dateFormatter.format(now);
      el['live-time'].textContent = timeFormatter.format(now);
    };
    tick();
    state.clockTimer = setInterval(tick, 1000);
  }

  function stopClock() {
    if (state.clockTimer) {
      clearInterval(state.clockTimer);
      state.clockTimer = null;
    }
  }

  function setStatusChip(kind, text) {
    el['status-chip'].className = `status-chip status-chip--${kind}`;
    el['status-text'].textContent = text;
  }

  function renderSummary(record) {
    if (!record) {
      el['today-summary'].hidden = true;
      el['today-summary'].replaceChildren();
      return;
    }

    const items = [
      ['Check in', record.checkIn],
      ['Check out', record.checkOut || '—'],
      ['Hours', record.open ? 'In progress' : record.hours],
    ];

    const fragment = document.createDocumentFragment();
    for (const [label, value] of items) {
      const item = document.createElement('div');
      item.className = 'summary-item';
      const labelNode = document.createElement('p');
      labelNode.className = 'summary-label';
      labelNode.textContent = label;
      const valueNode = document.createElement('p');
      valueNode.className = 'summary-value';
      valueNode.textContent = value;
      item.append(labelNode, valueNode);
      fragment.append(item);
    }
    el['today-summary'].replaceChildren(fragment);
    el['today-summary'].hidden = false;
  }

  function renderStatus(data) {
    state.attendance = data;
    const action = data.action;
    const record = data.record;
    const button = el['punch-btn'];

    if (data.employee) {
      state.employee = data.employee;
      el['employee-name'].textContent = data.employee.name;
    }

    el['holiday-pill'].hidden = !data.holiday;
    if (data.holiday) el['holiday-pill'].textContent = `Holiday · ${data.holiday}`;

    const shift =
      (data.record && data.record.shiftStart ? data.record : null) || data.schedule || null;
    el['shift-pill'].hidden = !shift;
    if (shift) {
      el['shift-pill'].textContent = `Shift ${shift.workStart ?? shift.shiftStart}–${
        shift.workEnd ?? shift.shiftEnd
      }`;
      el['shift-pill'].title = `${
        (data.schedule && data.schedule.department) || 'Default schedule'
      } · grace ${shift.graceMinutes} min`;
    }

    button.classList.remove('is-busy');
    button.disabled = false;
    el.punchIcon.innerHTML = ICONS.down;

    if (data.pendingApproval && action !== 'OUT') {
      const pending = data.pendingApproval;
      setStatusChip('pending', 'Waiting for admin approval');
      button.className = 'punch-btn punch-btn--done';
      button.disabled = true;
      el.punchIcon.innerHTML = ICONS.check;
      el['punch-label'].textContent = 'Approval pending';
      el['punch-hint'].textContent =
        `Your shift on ${dateLabelShort(pending.workDate)} is waiting for the administrator to approve the check-out. You cannot check in again until it is approved.`;
      renderSummary(pending);
      return;
    }

    if (action === 'IN') {
      setStatusChip('neutral', 'Not checked in yet');
      button.className = 'punch-btn punch-btn--in';
      el['punch-label'].textContent = 'Tap to check in';
      el['punch-hint'].textContent = data.holiday
        ? 'Today is a holiday, but you can still record a shift.'
        : 'Your location is checked only when you tap.';
      renderSummary(null);
    } else if (action === 'OUT') {
      const since = data.openShift
        ? `${dateLabelShort(record.workDate)} at ${record.checkIn}`
        : record.checkIn;
      const pendingNote = data.pendingApproval
        ? ' A previous shift is still waiting for admin approval, so you cannot check in again after this shift.'
        : '';
      setStatusChip('working', `Working since ${since}`);
      button.className = 'punch-btn punch-btn--out';
      el.punchIcon.innerHTML = ICONS.up;
      el['punch-label'].textContent = 'Tap to check out';
      el['punch-hint'].textContent =
        data.schedule && data.schedule.nightBodyWash
          ? 'Take care — this records your finish time. You must be at the office to check out. If you are staying for Night Body Wash, do not check out until you leave.'
          : 'Take care — this records your finish time. You must be at the office to check out.';
      el['punch-hint'].textContent += pendingNote;
      renderSummary(record);
    } else {
      setStatusChip('done', 'Shift complete');
      button.className = 'punch-btn punch-btn--done';
      button.disabled = true;
      el.punchIcon.innerHTML = ICONS.check;
      el['punch-label'].textContent = 'Shift complete for today';
      el['punch-hint'].textContent = 'See you next time. Your hours are ready for payroll.';
      renderSummary(record);
    }
  }

  async function refreshStatus() {
    const data = await api('/api/attendance/status');
    renderStatus(data);
  }

  function historyRow(record) {
    const row = document.createElement('div');
    row.className = 'history-row';

    const left = document.createElement('div');
    const date = document.createElement('span');
    date.className = 'history-date';
    date.textContent = dateLabelShort(record.workDate);
    const status = document.createElement('span');
    status.className = 'history-status';
    status.textContent = record.pending
      ? 'Pending approval'
      : record.open
        ? 'Open shift'
        : record.late
          ? 'Late'
          : 'Present';
    left.append(date, status);

    const right = document.createElement('div');
    right.className = 'history-times';
    right.textContent = `${record.checkIn} → ${record.checkOut || '—'}`;
    const hours = document.createElement('strong');
    hours.textContent = record.open ? 'In progress' : record.hours;
    right.append(hours);

    row.append(left, right);
    return row;
  }

  async function loadHistory() {
    try {
      const data = await api('/api/me/history');
      el['history-list'].replaceChildren();
      if (!data.records || !data.records.length) {
        const empty = document.createElement('p');
        empty.className = 'muted small';
        empty.textContent = 'No attendance records yet.';
        el['history-list'].append(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      for (const record of data.records.slice(0, 10)) {
        fragment.append(historyRow(record));
      }
      el['history-list'].append(fragment);
    } catch (error) {
      if (error.status === 401) return;
      el['history-list'].replaceChildren();
      const failed = document.createElement('p');
      failed.className = 'muted small';
      failed.textContent = 'Could not load recent attendance.';
      el['history-list'].append(failed);
    }
  }

  function enterApp(employee) {
    state.employee = employee;
    el['employee-name'].textContent = employee.name;
    el['login-error'].hidden = true;
    showView('app');
    startClock();
    refreshStatus().catch((error) => {
      if (error.status !== 401) showToast(error.message);
    });
    loadHistory();
  }

  function handleSignedOut() {
    state.employee = null;
    state.attendance = null;
    stopClock();
    showView('login');
    initGoogle().catch((error) => {
      el['login-error'].textContent = error.message;
      el['login-error'].hidden = false;
    });
  }

  function waitForGoogle(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          resolve(window.google.accounts.id);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Google sign-in could not load. Check your internet connection and try again.'));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  function loadGoogleScript() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    const existing = document.querySelector('script[data-google-gsi="true"]');
    if (existing) return waitForGoogle().then(() => undefined);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleGsi = 'true';
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error('Google sign-in could not load. Check your internet connection.'));
      document.head.append(script);
    }).then(() => waitForGoogle().then(() => undefined));
  }

  async function handleCredential(response) {
    if (!response || !response.credential) return;
    el['login-error'].hidden = true;
    el['google-button'].classList.add('is-busy');
    try {
      const data = await api('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: response.credential }),
        redirectOn401: false,
      });
      enterApp(data.employee);
    } catch (error) {
      el['login-error'].textContent = error.message;
      el['login-error'].hidden = false;
    } finally {
      el['google-button'].classList.remove('is-busy');
    }
  }

  async function initGoogle() {
    if (!state.config || !state.config.googleConfigured) return;
    await loadGoogleScript();
    const googleId = window.google.accounts.id;
    googleId.initialize({
      client_id: state.config.googleClientId,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    el['google-button'].replaceChildren();
    googleId.renderButton(el['google-button'], {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: 280,
    });
  }

  function geolocationError(error) {
    if (error && error.code === 1) {
      return 'Location permission was denied. Allow location for this site, turn on Precise Location, and try again.';
    }
    if (error && error.code === 2) {
      return 'Your phone could not get a GPS fix. Move near a window or step outside and try again.';
    }
    if (error && error.code === 3) {
      return 'Location took too long. Move to an open area and try again.';
    }
    return (error && error.message) || 'Could not read your location.';
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser does not support location. Use a modern phone browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
    });
  }

  function showOverlay(action, message) {
    el['overlay-title'].textContent = action === 'IN' ? "You're checked in" : "You're checked out";
    el['overlay-message'].textContent = message;
    el.overlay.hidden = false;
    el['overlay-close'].focus();
  }

  async function punch() {
    if (state.busy || !state.attendance) return;
    if (!['IN', 'OUT'].includes(state.attendance.action)) return;

    state.busy = true;
    const button = el['punch-btn'];
    button.disabled = true;
    button.classList.add('is-busy');
    el.punchIcon.innerHTML = ICONS.spinner;
    el['punch-label'].textContent = 'Getting your location…';
    el['punch-hint'].textContent = 'If your phone asks, choose Allow and keep Precise Location on.';

    try {
      const position = await getCurrentPosition();
      el['punch-label'].textContent = "Verifying you're at the office…";
      el['punch-hint'].textContent = 'Hold on — checking your distance from the office.';

      const data = await api('/api/attendance/punch', {
        method: 'POST',
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      });

      state.busy = false;
      button.classList.remove('is-busy');
      showOverlay(data.action, data.message);
      Promise.allSettled([refreshStatus(), loadHistory()]);
    } catch (error) {
      state.busy = false;
      button.classList.remove('is-busy');
      if (error.status === 401) return;
      const message = error.status ? error.message : geolocationError(error);
      if (error.status === 403 || (error.data && error.data.autoClosed)) {
        showToast(message, 'error', 12000);
        Promise.allSettled([refreshStatus(), loadHistory()]);
        return;
      }
      showToast(message, 'error', 9000);
      if (state.attendance) renderStatus(state.attendance);
    }
  }

  function closeOverlay() {
    el.overlay.hidden = true;
    if (state.employee) {
      refreshStatus().catch(() => {});
      loadHistory();
    }
  }

  async function init() {
    cacheElements();
    setFooterCopy({ copyrightName: 'Office Attendance' });
    el['punch-btn'].addEventListener('click', punch);
    el['signout-btn'].addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.reload();
      }
    });
    el['overlay-close'].addEventListener('click', closeOverlay);
    el.overlay.addEventListener('click', (event) => {
      if (event.target === el.overlay) closeOverlay();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !el.overlay.hidden) closeOverlay();
    });

    try {
      const [config, session] = await Promise.all([api('/api/config'), api('/api/session')]);
      applyConfig(config);

      if (!config.googleConfigured) {
        showSetup(
          'Google sign-in is not configured',
          'Add GOOGLE_CLIENT_ID to the server environment and restart. See README.md, Step 2. The admin dashboard already works.',
        );
        return;
      }
      if (!config.geofenceConfigured) {
        showSetup(
          'Office location is not configured',
          'Add OFFICE_LAT and OFFICE_LNG to the server environment, then restart. Check-in stays disabled until the office location is set.',
        );
        return;
      }

      if (session.employee) {
        enterApp(session.employee);
        return;
      }

      showView('login');
      await initGoogle();
    } catch (error) {
      showSetup(
        'Cannot reach the attendance server',
        `${error.message} Check that the server is running and refresh this page.`,
      );
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
