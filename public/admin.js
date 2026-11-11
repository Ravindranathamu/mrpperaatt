(() => {
  'use strict';

  const state = {
    me: null,
    companyName: 'Office Attendance',
    copyrightName: '',
    contactPhone: '',
    contactEmail: '',
    timezone: 'UTC',
    rules: null,
    tab: 'today',
    today: null,
    report: null,
    employees: [],
    departments: [],
    defaultSchedule: null,
    holidays: [],
    loaded: { today: false, reports: false, employees: false, departments: false },
    refreshTimer: null,
    toastTimer: null,
    editEmployeeId: null,
    editDepartmentId: null,
    fixRecord: null,
  };

  const el = {};

  function cacheElements() {
    const ids = [
      'login-screen',
      'admin-app',
      'login-form',
      'login-password',
      'login-btn',
      'login-error',
      'login-company-name',
      'admin-company-name',
      'login-footer-copy',
      'admin-footer-copy',
      'admin-date-label',
      'admin-title',
      'refresh-btn',
      'admin-logout',
      'today-stats',
      'today-table-body',
      'today-subtitle',
      'today-holiday',
      'today-empty',
      'today-legend',
      'report-form',
      'report-from',
      'report-to',
      'report-department',
      'report-employee',
      'report-stats',
      'report-subtitle',
      'report-table-body',
      'report-empty',
      'download-matrix',
      'download-excel',
      'download-raw',
      'holiday-form',
      'holiday-date',
      'holiday-name',
      'holiday-list',
      'employee-form',
      'employee-name',
      'employee-email',
      'employee-department',
      'employee-table-body',
      'employee-count',
      'department-form',
      'department-name',
      'department-start',
      'department-end',
      'department-grace',
      'department-night',
      'department-count',
      'department-table-body',
      'default-schedule',
      'edit-department-dialog',
      'edit-department-form',
      'edit-department-name',
      'edit-department-start',
      'edit-department-end',
      'edit-department-grace',
      'edit-department-night',
      'edit-department-error',
      'edit-department-save',
      'edit-employee-dialog',
      'edit-employee-form',
      'edit-employee-email',
      'edit-employee-name',
      'edit-employee-department',
      'edit-employee-active',
      'edit-employee-error',
      'edit-employee-save',
      'fix-dialog',
      'fix-form',
      'fix-description',
      'fix-time',
      'fix-error',
      'fix-save',
      'admin-toast',
    ];
    for (const id of ids) el[id] = document.getElementById(id);
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
      if (response.status === 401 && redirectOn401) showLogin();
      throw error;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type = 'success', timeout = 5000) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    el['admin-toast'].textContent = message;
    el['admin-toast'].className = `toast${type === 'success' ? ' toast--success' : ' toast--error'}`;
    el['admin-toast'].hidden = false;
    state.toastTimer = setTimeout(() => {
      el['admin-toast'].hidden = true;
    }, timeout);
  }

  function copyrightHtml() {
    const owner = state.copyrightName || state.companyName;
    const copy = `© ${new Date().getFullYear()} ${owner}. All rights reserved.`;
    const contacts = [];

    if (state.contactPhone) {
      const label = escapeHtml(state.contactPhone);
      const href = escapeHtml(state.contactPhone.replace(/[^+\d]/g, ''));
      contacts.push(`<a href="tel:${href}">${label}</a>`);
    }
    if (state.contactEmail) {
      const email = escapeHtml(state.contactEmail);
      contacts.push(`<a href="mailto:${email}">${email}</a>`);
    }

    return `${escapeHtml(copy)}${
      contacts.length ? `<br><span class="copyright-contact">${contacts.join(' · ')}</span>` : ''
    }`;
  }

  function setCopyright() {
    const html = copyrightHtml();
    if (el['login-footer-copy']) el['login-footer-copy'].innerHTML = html;
    if (el['admin-footer-copy']) el['admin-footer-copy'].innerHTML = html;
  }

  function dateInZone(timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const lookup = {};
    for (const part of parts) {
      if (part.type !== 'literal') lookup[part.type] = part.value;
    }
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
  }

  function timeInZone(timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const lookup = {};
    for (const part of parts) {
      if (part.type !== 'literal') lookup[part.type] = part.value;
    }
    return `${lookup.hour}:${lookup.minute}`;
  }

  function formatDateLabel(dateString, withYear = false) {
    if (!dateString) return '';
    const date = new Date(`${dateString}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(date);
  }

  function currentDateLabel(timezone) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
  }

  function setHeader() {
    const titles = {
      today: 'Today',
      reports: 'Reports',
      employees: 'Employees',
      departments: 'Departments',
    };
    el['admin-title'].textContent = titles[state.tab] || 'Dashboard';
    el['admin-date-label'].textContent =
      state.tab === 'today'
        ? `Today · ${currentDateLabel(state.timezone)}`
        : currentDateLabel(state.timezone);
    document.title = `${titles[state.tab] || 'Admin'} · ${state.companyName}`;
  }

  function showLogin() {
    state.me = null;
    state.loaded = { today: false, reports: false, employees: false, departments: false };
    state.report = null;
    stopAutoRefresh();
    el['admin-app'].hidden = true;
    el['login-screen'].hidden = false;
    el['login-error'].hidden = true;
    el['login-company-name'].textContent = state.companyName;
    setCopyright();
    el['login-password'].value = '';
    setTimeout(() => el['login-password'].focus(), 50);
  }

  function showApp(me) {
    state.me = me;
    if (me.companyName) state.companyName = me.companyName;
    if (me.timezone) state.timezone = me.timezone;
    el['login-screen'].hidden = true;
    el['admin-app'].hidden = false;
    el['login-company-name'].textContent = state.companyName;
    el['admin-company-name'].textContent = state.companyName;
    el['login-error'].hidden = true;
    setCopyright();
    setTab('today');
    startAutoRefresh();
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.nav-item').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.tab === tab);
    });
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
    setHeader();

    if (tab === 'today') {
      loadToday();
    } else if (tab === 'reports') {
      if (!el['report-from'].value) {
        const today = dateInZone(state.timezone);
        el['report-from'].value = `${today.slice(0, 7)}-01`;
        el['report-to'].value = today;
      }
      if (!el['holiday-date'].value) el['holiday-date'].value = dateInZone(state.timezone);
      loadReportTab();
    } else if (tab === 'employees') {
      loadDepartments();
      loadEmployees();
    } else if (tab === 'departments') {
      loadDepartments();
    }
  }

  function renderStats(container, items) {
    container.replaceChildren();
    for (const item of items) {
      const card = document.createElement('article');
      card.className = `stat-card${item.tone ? ` stat-card--${item.tone}` : ''}`;
      const label = document.createElement('p');
      label.className = 'stat-label';
      label.textContent = item.label;
      const value = document.createElement('p');
      value.className = 'stat-value';
      value.textContent = item.value;
      card.append(label, value);
      if (item.note) {
        const note = document.createElement('p');
        note.className = 'stat-note';
        note.textContent = item.note;
        card.append(note);
      }
      container.append(card);
    }
  }

  function badge(label, tone) {
    return `<span class="badge badge--${tone}">${escapeHtml(label)}</span>`;
  }

  function statusBadges(status, late) {
    let html = '';
    if (status === 'WORKING') html += badge('Working', 'working');
    else if (status === 'COMPLETE') html += badge('Completed', 'complete');
    else if (status === 'NOT_IN') html += badge('Not checked in', 'not-in');
    else html += badge('Day off', 'off');
    if (late) html += ` ${badge('Late', 'late')}`;
    return html;
  }

  async function loadToday(silent = false) {
    try {
      const data = await api('/api/admin/overview');
      state.today = data;
      state.loaded.today = true;

      const stats = data.stats;
      renderStats(el['today-stats'], [
        {
          label: 'Present',
          value: stats.present,
          note: stats.late ? `${stats.late} late` : 'On time so far',
          tone: 'accent',
        },
        { label: 'Working now', value: stats.working, note: 'Open shifts' },
        { label: 'Completed', value: stats.completed, note: 'Checked out' },
        {
          label: data.workday ? 'Not checked in' : 'Day off',
          value: stats.notIn,
          note: data.workday ? 'Awaiting arrival' : 'Non-working day',
          tone: data.workday && stats.notIn > 0 ? 'warning' : '',
        },
      ]);

      el['today-subtitle'].textContent = `${data.dateLabel} · ${
        data.workday ? 'Working day' : 'Non-working day'
      }${data.holiday ? ` · Holiday: ${data.holiday}` : ''}`;
      el['today-holiday'].hidden = !data.holiday;
      if (data.holiday) el['today-holiday'].textContent = data.holiday;

      const rules = state.rules;
      el['today-legend'].textContent = rules
        ? `Late is based on each employee's department shift + grace · Times shown in ${state.timezone}`
        : `Times shown in ${state.timezone}`;

      const tbody = el['today-table-body'];
      tbody.innerHTML = '';
      for (const row of data.rows) {
        const employee = row.employee;
        const record = row.record;
        const tr = document.createElement('tr');

        const employeeCell = document.createElement('td');
        employeeCell.innerHTML =
          `<div class="employee-cell"><strong>${escapeHtml(employee.name)}</strong>` +
          `<span>${escapeHtml(employee.email)}${
            employee.department ? ` · ${escapeHtml(employee.department)}` : ''
          }${employee.active ? '' : ' · inactive'}</span></div>`;

        const shiftCell = document.createElement('td');
        shiftCell.className = 'time-cell time-cell--muted';
        shiftCell.textContent =
          (row.record && row.record.shift) ||
          (row.schedule ? `${row.schedule.workStart}–${row.schedule.workEnd}` : '—');

        const statusCell = document.createElement('td');
        statusCell.innerHTML = statusBadges(row.status, row.late);

        const inCell = document.createElement('td');
        inCell.className = `time-cell${record ? '' : ' time-cell--muted'}`;
        inCell.textContent = record ? record.checkIn : '—';

        const outCell = document.createElement('td');
        outCell.className = `time-cell${record && record.checkOut ? '' : ' time-cell--muted'}`;
        outCell.textContent = record ? record.checkOut || '—' : '—';

        const hoursCell = document.createElement('td');
        hoursCell.className = 'time-cell';
        hoursCell.textContent = record ? (record.open ? 'In progress' : record.hours) : '—';

        const distanceCell = document.createElement('td');
        distanceCell.className = 'time-cell time-cell--muted';
        distanceCell.textContent =
          record && record.checkInDistance !== null ? `${record.checkInDistance} m` : '—';

        tr.append(employeeCell, shiftCell, statusCell, inCell, outCell, hoursCell, distanceCell);
        tbody.append(tr);
      }

      el['today-empty'].hidden = data.rows.length > 0;
      if (!data.rows.length) {
        el['today-empty'].querySelector('p').textContent =
          'No team members yet. Add employees to start tracking attendance.';
      }
    } catch (error) {
      if (error.status === 401) return;
      if (!silent) showToast(error.message, 'error', 8000);
    }
  }

  function populateReportFilters() {
    const departmentSelect = el['report-department'];
    const employeeSelect = el['report-employee'];
    if (!departmentSelect || !employeeSelect) return;

    const previousDepartment = departmentSelect.value;
    const previousEmployee = employeeSelect.value;

    const departments = [...state.departments];
    const known = new Set(departments.map((department) => department.name.toLowerCase()));
    for (const employee of state.employees) {
      const name = String(employee.department || '').trim();
      if (name && !known.has(name.toLowerCase())) {
        departments.push({ name });
        known.add(name.toLowerCase());
      }
    }
    departments.sort((a, b) => a.name.localeCompare(b.name));

    departmentSelect.replaceChildren();
    const allDepartments = document.createElement('option');
    allDepartments.value = '';
    allDepartments.textContent = 'All departments';
    departmentSelect.append(allDepartments);

    const noDepartment = document.createElement('option');
    noDepartment.value = '__none__';
    noDepartment.textContent = 'No department';
    departmentSelect.append(noDepartment);

    for (const department of departments) {
      const option = document.createElement('option');
      option.value = department.name;
      option.textContent = department.name;
      departmentSelect.append(option);
    }

    const departmentStillExists = Array.from(departmentSelect.options).some(
      (option) => option.value === previousDepartment,
    );
    departmentSelect.value = departmentStillExists ? previousDepartment : '';

    employeeSelect.replaceChildren();
    const allEmployees = document.createElement('option');
    allEmployees.value = '';
    allEmployees.textContent = 'All employees';
    employeeSelect.append(allEmployees);

    const departmentFilter = departmentSelect.value;
    for (const employee of state.employees) {
      const employeeDepartment = String(employee.department || '').trim();
      if (departmentFilter === '__none__' && employeeDepartment) continue;
      if (
        departmentFilter &&
        departmentFilter !== '__none__' &&
        employeeDepartment.toLowerCase() !== departmentFilter.toLowerCase()
      ) {
        continue;
      }

      const option = document.createElement('option');
      option.value = String(employee.id);
      option.textContent = employee.department
        ? `${employee.name} · ${employee.department}`
        : employee.name;
      employeeSelect.append(option);
    }

    const employeeStillExists = Array.from(employeeSelect.options).some(
      (option) => option.value === previousEmployee,
    );
    employeeSelect.value = employeeStillExists ? previousEmployee : '';
  }

  function reportQueryParams() {
    const params = new URLSearchParams({
      from: el['report-from'].value,
      to: el['report-to'].value,
    });
    const department = el['report-department'] ? el['report-department'].value : '';
    const employeeId = el['report-employee'] ? el['report-employee'].value : '';
    if (department) params.set('department', department);
    if (employeeId) params.set('employeeId', employeeId);
    return params;
  }

  async function loadReportTab() {
    await Promise.all([loadDepartments(), loadEmployees()]);
    populateReportFilters();
    loadReport();
    loadHolidays();
  }

  async function loadReport() {
    const from = el['report-from'].value;
    const to = el['report-to'].value;
    if (!from || !to) {
      showToast('Choose both a start and end date.', 'error');
      return;
    }
    if (from > to) {
      showToast('The start date must be before the end date.', 'error');
      return;
    }

    try {
      const params = reportQueryParams();
      const data = await api(`/api/admin/range?${params.toString()}`);
      state.report = data;
      state.loaded.reports = true;

      renderStats(el['report-stats'], [
        { label: 'Records', value: data.summary.records },
        { label: 'Employees', value: data.summary.employees },
        { label: 'Total hours', value: data.summary.totalHours },
        {
          label: 'Night Body Wash',
          value: data.summary.nightHours,
          tone: Number(data.summary.nightHours) > 0 ? 'accent' : '',
        },
        {
          label: 'Overtime',
          value: data.summary.overtimeHours,
          tone: Number(data.summary.overtimeHours) > 0 ? 'warning' : '',
        },
        { label: 'Late', value: data.summary.late, tone: data.summary.late ? 'warning' : '' },
        { label: 'Open shifts', value: data.summary.open, tone: data.summary.open ? 'warning' : '' },
      ]);

      const filterLabels = [];
      if (params.get('department') === '__none__') filterLabels.push('No department');
      else if (params.get('department')) filterLabels.push(params.get('department'));
      if (params.get('employeeId')) {
        const employee = state.employees.find(
          (item) => String(item.id) === params.get('employeeId'),
        );
        if (employee) filterLabels.push(employee.name);
      }
      el['report-subtitle'].textContent =
        `${data.fromLabel} – ${data.toLabel} · ${data.rows.length} ${
          data.rows.length === 1 ? 'record' : 'records'
        }` + (filterLabels.length ? ` · ${filterLabels.join(' · ')}` : '');

      const tbody = el['report-table-body'];
      tbody.innerHTML = '';
      for (const row of data.rows) {
        const tr = document.createElement('tr');
        const date = document.createElement('td');
        date.className = 'time-cell';
        date.textContent = formatDateLabel(row.date);

        const employee = document.createElement('td');
        employee.innerHTML =
          `<div class="employee-cell"><strong>${escapeHtml(row.employee)}</strong>` +
          `<span>${escapeHtml(row.email)}${row.department ? ` · ${escapeHtml(row.department)}` : ''}</span></div>`;

        const shiftCell = document.createElement('td');
        shiftCell.className = 'time-cell time-cell--muted';
        shiftCell.textContent = row.shift || '—';

        const inCell = document.createElement('td');
        inCell.className = 'time-cell';
        inCell.textContent = row.checkIn;

        const outCell = document.createElement('td');
        outCell.className = `time-cell${row.checkOut ? '' : ' time-cell--muted'}`;
        outCell.textContent = row.checkOut || '—';

        const hoursCell = document.createElement('td');
        hoursCell.className = 'time-cell';
        hoursCell.textContent = row.open ? 'In progress' : row.hours;

        const nightCell = document.createElement('td');
        nightCell.className = `time-cell${row.nightMinutes ? '' : ' time-cell--muted'}`;
        nightCell.textContent = row.open || !row.nightMinutes ? '—' : row.nightHours;
        nightCell.title = 'Night Body Wash hours (eligible departments only)';

        const overtimeCell = document.createElement('td');
        overtimeCell.className = `time-cell${row.overtimeMinutes ? '' : ' time-cell--muted'}`;
        overtimeCell.textContent = row.open || !row.overtimeMinutes ? '—' : row.overtimeHours;
        overtimeCell.title = 'Overtime after the employee’s scheduled finish';

        const statusCell = document.createElement('td');
        statusCell.innerHTML = row.open
          ? badge('Open', 'open')
          : row.late
            ? badge('Late', 'late')
            : badge('Present', 'complete');

        const actionCell = document.createElement('td');
        if (row.open) {
          actionCell.innerHTML = `<button type="button" class="btn btn--ghost btn--small" data-fix-id="${row.id}">Fix checkout</button>`;
        }

        tr.append(
          date,
          employee,
          shiftCell,
          inCell,
          outCell,
          hoursCell,
          nightCell,
          overtimeCell,
          statusCell,
          actionCell,
        );
        tbody.append(tr);
      }

      el['report-empty'].hidden = data.rows.length > 0;
    } catch (error) {
      if (error.status === 401) return;
      showToast(error.message, 'error', 8000);
    }
  }

  function currentRange() {
    const from = el['report-from'].value;
    const to = el['report-to'].value;
    if (!from || !to || from > to) {
      showToast('Choose a valid date range first.', 'error');
      return null;
    }
    return { from, to };
  }

  async function downloadReport(endpoint, extension) {
    const range = currentRange();
    if (!range) return;

    const accept =
      extension === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv';

    try {
      const params = reportQueryParams();
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: accept },
      });

      if (!response.ok) {
        if (response.status === 401) {
          showLogin();
          throw new Error('Admin sign-in required.');
        }
        let message = 'Could not download the report.';
        try {
          const data = await response.json();
          if (data && data.error) message = data.error;
        } catch {
          // Keep the generic message when the response is not JSON.
        }
        throw new Error(message);
      }

      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch
        ? filenameMatch[1]
        : `attendance_${range.from}_to_${range.to}.${extension}`;
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showToast('Download ready.');
    } catch (error) {
      showToast(error.message, 'error', 8000);
    }
  }

  function downloadCsv(kind) {
    return downloadReport(`/api/admin/${kind}.csv`, 'csv');
  }

  function downloadExcel() {
    return downloadReport('/api/admin/report.xlsx', 'xlsx');
  }

  async function loadHolidays() {
    try {
      const data = await api('/api/admin/holidays');
      state.holidays = data.holidays || [];
      const list = el['holiday-list'];
      list.replaceChildren();
      if (!state.holidays.length) {
        const empty = document.createElement('p');
        empty.className = 'muted small';
        empty.textContent = 'No holidays added yet.';
        list.append(empty);
        return;
      }
      const today = dateInZone(state.timezone);
      for (const holiday of state.holidays) {
        const row = document.createElement('div');
        row.className = 'holiday-row';
        const date = document.createElement('span');
        date.className = 'holiday-date';
        date.textContent = formatDateLabel(holiday.date, true);
        const name = document.createElement('span');
        name.className = 'holiday-name';
        name.textContent = holiday.name;
        if (holiday.date < today) name.classList.add('muted');
        const actions = document.createElement('span');
        actions.className = 'row-actions';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn--ghost btn--small';
        remove.dataset.holidayDelete = holiday.id;
        remove.textContent = 'Remove';
        actions.append(remove);
        row.append(date, name, actions);
        list.append(row);
      }
    } catch (error) {
      if (error.status === 401) return;
      showToast(error.message, 'error');
    }
  }

  function populateDepartmentSelect(select, selected) {
    if (!select) return;
    const value = selected || '';
    select.replaceChildren();

    const fallback = document.createElement('option');
    fallback.value = '';
    fallback.textContent = 'No department (default shift)';
    select.append(fallback);

    for (const department of state.departments) {
      const option = document.createElement('option');
      option.value = department.name;
      option.textContent = `${department.name} · ${department.workStart}–${department.workEnd}`;
      select.append(option);
    }

    if (value && !state.departments.some((department) => department.name === value)) {
      const legacy = document.createElement('option');
      legacy.value = value;
      legacy.textContent = value;
      select.append(legacy);
    }
    select.value = value;
  }

  function resetDepartmentDefaults() {
    const defaults = state.defaultSchedule ||
      state.rules || { workStart: '07:00', workEnd: '16:00', graceMinutes: 10 };
    el['department-start'].value = defaults.workStart || '07:00';
    el['department-end'].value = defaults.workEnd || '17:00';
    el['department-grace'].value = defaults.graceMinutes ?? 10;
    el['department-night'].checked = false;
  }

  function renderDepartmentTable() {
    const tbody = el['department-table-body'];
    tbody.innerHTML = '';
    if (!state.departments.length) {
      tbody.innerHTML =
        '<tr><td colspan="6"><div class="empty-state"><p>No departments yet. Add one above to give that team its own shift.</p></div></td></tr>';
      return;
    }

    for (const department of state.departments) {
      const tr = document.createElement('tr');

      const name = document.createElement('td');
      name.innerHTML = `<div class="employee-cell"><strong>${escapeHtml(department.name)}</strong></div>`;

      const shift = document.createElement('td');
      shift.className = 'time-cell';
      shift.textContent = `${department.workStart}–${department.workEnd}`;

      const grace = document.createElement('td');
      grace.className = 'time-cell';
      grace.textContent = `${department.graceMinutes} min`;

      const rule = document.createElement('td');
      rule.innerHTML = department.nightBodyWash
        ? badge('Night Body Wash', 'complete')
        : badge('Overtime', 'late');

      const employees = document.createElement('td');
      employees.className = 'time-cell';
      employees.textContent = department.employeeCount;

      const actions = document.createElement('td');
      actions.className = 'row-actions';
      actions.innerHTML =
        `<button type="button" class="btn btn--ghost btn--small" data-department-edit="${department.id}">Edit</button>` +
        `<button type="button" class="btn btn--ghost btn--small" data-department-delete="${department.id}">Delete</button>`;

      tr.append(name, shift, grace, rule, employees, actions);
      tbody.append(tr);
    }
  }

  async function loadDepartments() {
    try {
      const data = await api('/api/admin/departments');
      state.departments = data.departments || [];
      state.defaultSchedule = data.defaultSchedule || null;
      state.loaded.departments = true;

      const count = state.departments.length;
      el['department-count'].textContent = `${count} department${count === 1 ? '' : 's'}`;
      if (state.defaultSchedule) {
        el['default-schedule'].textContent =
          `${state.defaultSchedule.workStart}–${state.defaultSchedule.workEnd} ` +
          `(grace ${state.defaultSchedule.graceMinutes} min)`;
      }
      if (!el['department-start'].value) resetDepartmentDefaults();

      populateDepartmentSelect(el['employee-department'], el['employee-department'].value);
      populateDepartmentSelect(
        el['edit-employee-department'],
        el['edit-employee-department'].value,
      );
      renderDepartmentTable();
    } catch (error) {
      if (error.status === 401) return;
      showToast(error.message, 'error');
    }
  }

  async function loadEmployees() {
    try {
      const data = await api('/api/admin/employees');
      state.employees = data.employees || [];
      state.loaded.employees = true;
      const activeCount = state.employees.filter((employee) => employee.active).length;
      el['employee-count'].textContent = `${activeCount} active · ${state.employees.length} total`;

      const tbody = el['employee-table-body'];
      tbody.innerHTML = '';
      if (!state.employees.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No employees yet. Add your first team member above.</p></div></td></tr>`;
        return;
      }

      for (const employee of state.employees) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.innerHTML = `<div class="employee-cell"><strong>${escapeHtml(employee.name)}</strong>${
          employee.department ? `<span>${escapeHtml(employee.department)}</span>` : ''
        }</div>`;

        const email = document.createElement('td');
        email.className = 'mono';
        email.textContent = employee.email;

        const department = document.createElement('td');
        department.textContent = employee.department || '—';

        const status = document.createElement('td');
        status.innerHTML = employee.active
          ? badge('Active', 'active')
          : badge('Inactive', 'inactive');

        const actions = document.createElement('td');
        actions.className = 'row-actions';
        actions.innerHTML =
          `<button type="button" class="btn btn--ghost btn--small" data-edit-id="${employee.id}">Edit</button>` +
          `<button type="button" class="btn btn--ghost btn--small" data-toggle-id="${employee.id}">${
            employee.active ? 'Deactivate' : 'Activate'
          }</button>`;

        tr.append(name, email, department, status, actions);
        tbody.append(tr);
      }
    } catch (error) {
      if (error.status === 401) return;
      showToast(error.message, 'error');
    }
  }

  function openEditEmployee(employee) {
    state.editEmployeeId = employee.id;
    el['edit-employee-email'].textContent = employee.email;
    el['edit-employee-name'].value = employee.name;
    populateDepartmentSelect(el['edit-employee-department'], employee.department || '');
    el['edit-employee-active'].checked = Boolean(employee.active);
    el['edit-employee-error'].hidden = true;
    el['edit-employee-dialog'].showModal();
    setTimeout(() => el['edit-employee-name'].focus(), 50);
  }

  function openFixDialog(record) {
    state.fixRecord = record;
    el['fix-description'].textContent =
      `${record.employee} · ${formatDateLabel(record.date, true)} · checked in at ${record.checkIn}`;
    const today = dateInZone(state.timezone);
    el['fix-time'].value = record.date === today ? timeInZone(state.timezone) : '17:00';
    el['fix-error'].hidden = true;
    el['fix-dialog'].showModal();
    setTimeout(() => el['fix-time'].focus(), 50);
  }

  function openEditDepartment(department) {
    state.editDepartmentId = department.id;
    el['edit-department-name'].value = department.name;
    el['edit-department-start'].value = department.workStart;
    el['edit-department-end'].value = department.workEnd;
    el['edit-department-grace'].value = department.graceMinutes;
    el['edit-department-night'].checked = Boolean(department.nightBodyWash);
    el['edit-department-error'].hidden = true;
    el['edit-department-dialog'].showModal();
    setTimeout(() => el['edit-department-name'].focus(), 50);
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.tab !== 'today') return;
      loadToday(true);
    }, 60000);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  async function boot() {
    cacheElements();
    bindEvents();

    const [meResult, configResult] = await Promise.allSettled([
      api('/api/admin/me', { redirectOn401: false }),
      api('/api/config', { redirectOn401: false }),
    ]);

    if (configResult.status === 'fulfilled') {
      state.rules = configResult.value;
      state.timezone = configResult.value.timezone || state.timezone;
      state.companyName = configResult.value.companyName || state.companyName;
      state.copyrightName = configResult.value.copyrightName || state.companyName;
      state.contactPhone = configResult.value.contactPhone || '';
      state.contactEmail = configResult.value.contactEmail || '';
    }

    if (meResult.status === 'fulfilled' && meResult.value.authenticated) {
      showApp(meResult.value);
      return;
    }

    const bootError = meResult.status === 'rejected' ? meResult.reason : null;
    el['login-company-name'].textContent = state.companyName;
    showLogin();

    if (bootError && bootError.status !== 401) {
      el['login-error'].textContent =
        bootError.status >= 500
          ? 'The attendance server is having trouble. Please try again.'
          : bootError.message || 'Cannot reach the attendance server.';
      el['login-error'].hidden = false;
    }
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab));
    });

    document.addEventListener('click', (event) => {
      const goTab = event.target.closest('[data-go-tab]');
      if (goTab) setTab(goTab.dataset.goTab);
    });

    el['refresh-btn'].addEventListener('click', () => {
      if (state.tab === 'today') loadToday();
      else if (state.tab === 'reports') {
        loadReportTab();
      } else if (state.tab === 'employees') {
        loadDepartments();
        loadEmployees();
      } else loadDepartments();
    });

    el['admin-logout'].addEventListener('click', async () => {
      try {
        await api('/api/admin/logout', { method: 'POST' });
      } finally {
        showLogin();
      }
    });

    el['login-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = el['login-password'].value;
      if (!password) return;

      el['login-btn'].disabled = true;
      el['login-btn'].textContent = 'Signing in…';
      el['login-error'].hidden = true;

      try {
        const data = await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ password }),
          redirectOn401: false,
        });
        showApp({ ...data, authenticated: true });
      } catch (error) {
        el['login-error'].textContent = error.message;
        el['login-error'].hidden = false;
      } finally {
        el['login-btn'].disabled = false;
        el['login-btn'].textContent = 'Sign in';
      }
    });

    el['report-form'].addEventListener('submit', (event) => {
      event.preventDefault();
      loadReport();
    });

    el['report-department'].addEventListener('change', () => {
      populateReportFilters();
      loadReport();
    });

    el['report-employee'].addEventListener('change', () => {
      loadReport();
    });

    el['download-matrix'].addEventListener('click', () => downloadCsv('report'));
    el['download-excel'].addEventListener('click', downloadExcel);
    el['download-raw'].addEventListener('click', () => downloadCsv('raw'));

    el['holiday-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      const date = el['holiday-date'].value;
      if (!date) return;
      try {
        const data = await api('/api/admin/holidays', {
          method: 'POST',
          body: JSON.stringify({ date, name: el['holiday-name'].value || 'Holiday' }),
        });
        state.holidays = data.holidays || [];
        el['holiday-name'].value = '';
        showToast('Holiday saved.');
        loadHolidays();
        if (state.loaded.reports) loadReport();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    el['holiday-list'].addEventListener('click', async (event) => {
      const button = event.target.closest('[data-holiday-delete]');
      if (!button) return;
      if (!window.confirm('Remove this holiday?')) return;
      try {
        await api(`/api/admin/holidays/${button.dataset.holidayDelete}`, { method: 'DELETE' });
        showToast('Holiday removed.');
        loadHolidays();
        if (state.loaded.reports) loadReport();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    el['department-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = el['department-name'].value.trim();
      const workStart = el['department-start'].value;
      const workEnd = el['department-end'].value;
      const graceMinutes = Number(el['department-grace'].value);
      const nightBodyWash = el['department-night'].checked;
      if (!name || !workStart || !workEnd) return;

      const button = el['department-form'].querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api('/api/admin/departments', {
          method: 'POST',
          body: JSON.stringify({ name, workStart, workEnd, graceMinutes, nightBodyWash }),
        });
        el['department-name'].value = '';
        resetDepartmentDefaults();
        showToast('Department added.');
        await loadDepartments();
        if (state.loaded.employees) loadEmployees();
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    el['department-table-body'].addEventListener('click', async (event) => {
      const editButton = event.target.closest('[data-department-edit]');
      if (editButton) {
        const department = state.departments.find(
          (item) => String(item.id) === String(editButton.dataset.departmentEdit),
        );
        if (department) openEditDepartment(department);
        return;
      }

      const deleteButton = event.target.closest('[data-department-delete]');
      if (!deleteButton) return;
      const department = state.departments.find(
        (item) => String(item.id) === String(deleteButton.dataset.departmentDelete),
      );
      if (!department) return;
      if (!window.confirm(`Delete the ${department.name} department?`)) return;

      deleteButton.disabled = true;
      try {
        await api(`/api/admin/departments/${department.id}`, { method: 'DELETE' });
        showToast('Department deleted.');
        await loadDepartments();
        if (state.loaded.employees) loadEmployees();
        if (state.loaded.today) loadToday(true);
        if (state.loaded.reports) loadReport();
      } catch (error) {
        showToast(error.message, 'error');
        deleteButton.disabled = false;
      }
    });

    el['edit-department-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.editDepartmentId) return;
      const name = el['edit-department-name'].value.trim();
      const workStart = el['edit-department-start'].value;
      const workEnd = el['edit-department-end'].value;
      const graceMinutes = Number(el['edit-department-grace'].value);
      const nightBodyWash = el['edit-department-night'].checked;
      if (!name || !workStart || !workEnd) return;

      el['edit-department-save'].disabled = true;
      el['edit-department-error'].hidden = true;
      try {
        await api(`/api/admin/departments/${state.editDepartmentId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, workStart, workEnd, graceMinutes, nightBodyWash }),
        });
        el['edit-department-dialog'].close();
        showToast('Department updated.');
        await loadDepartments();
        if (state.loaded.employees) loadEmployees();
        if (state.loaded.today) loadToday(true);
        if (state.loaded.reports) loadReport();
      } catch (error) {
        el['edit-department-error'].textContent = error.message;
        el['edit-department-error'].hidden = false;
      } finally {
        el['edit-department-save'].disabled = false;
      }
    });

    el['employee-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = el['employee-name'].value.trim();
      const email = el['employee-email'].value.trim();
      const department = el['employee-department'].value.trim();
      if (!name || !email) return;

      const button = el['employee-form'].querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api('/api/admin/employees', {
          method: 'POST',
          body: JSON.stringify({ name, email, department }),
        });
        el['employee-name'].value = '';
        el['employee-email'].value = '';
        el['employee-department'].value = '';
        showToast('Employee added.');
        loadEmployees();
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    el['employee-table-body'].addEventListener('click', async (event) => {
      const editButton = event.target.closest('[data-edit-id]');
      if (editButton) {
        const employee = state.employees.find(
          (item) => String(item.id) === String(editButton.dataset.editId),
        );
        if (employee) openEditEmployee(employee);
        return;
      }

      const toggleButton = event.target.closest('[data-toggle-id]');
      if (toggleButton) {
        const employee = state.employees.find(
          (item) => String(item.id) === String(toggleButton.dataset.toggleId),
        );
        if (!employee) return;
        if (employee.active && !window.confirm(`Deactivate ${employee.name}? They will not be able to check in.`)) {
          return;
        }
        toggleButton.disabled = true;
        try {
          await api(`/api/admin/employees/${employee.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: !employee.active }),
          });
          showToast(employee.active ? 'Employee deactivated.' : 'Employee activated.');
          loadEmployees();
          if (state.loaded.today) loadToday(true);
        } catch (error) {
          showToast(error.message, 'error');
          toggleButton.disabled = false;
        }
      }
    });

    el['edit-employee-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.editEmployeeId) return;
      const name = el['edit-employee-name'].value.trim();
      if (!name) return;
      el['edit-employee-save'].disabled = true;
      el['edit-employee-error'].hidden = true;
      try {
        await api(`/api/admin/employees/${state.editEmployeeId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            department: el['edit-employee-department'].value.trim(),
            active: el['edit-employee-active'].checked,
          }),
        });
        el['edit-employee-dialog'].close();
        showToast('Employee updated.');
        loadEmployees();
        if (state.loaded.today) loadToday(true);
      } catch (error) {
        el['edit-employee-error'].textContent = error.message;
        el['edit-employee-error'].hidden = false;
      } finally {
        el['edit-employee-save'].disabled = false;
      }
    });

    el['report-table-body'].addEventListener('click', (event) => {
      const button = event.target.closest('[data-fix-id]');
      if (!button || !state.report) return;
      const record = state.report.rows.find(
        (row) => String(row.id) === String(button.dataset.fixId),
      );
      if (record) openFixDialog(record);
    });

    el['fix-form'].addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.fixRecord) return;
      const time = el['fix-time'].value;
      if (!time) return;
      el['fix-save'].disabled = true;
      el['fix-error'].hidden = true;
      try {
        await api(`/api/admin/attendance/${state.fixRecord.id}/checkout`, {
          method: 'POST',
          body: JSON.stringify({ time }),
        });
        el['fix-dialog'].close();
        showToast('Check-out saved.');
        loadReport();
        if (state.loaded.today) loadToday(true);
      } catch (error) {
        el['fix-error'].textContent = error.message;
        el['fix-error'].hidden = false;
      } finally {
        el['fix-save'].disabled = false;
      }
    });

    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = document.getElementById(button.dataset.closeDialog);
        if (dialog) dialog.close();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
