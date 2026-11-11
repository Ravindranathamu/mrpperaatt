'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scheduleFromDepartment,
  createDepartmentMap,
  scheduleForEmployee,
  scheduleForRecord,
  scheduledEndFor,
} = require('../src/schedule');

const config = {
  workStart: '09:00',
  workEnd: '17:00',
  graceMinutes: 10,
  timezone: 'Asia/Colombo',
};

test('department schedules override the default shift', () => {
  const department = {
    name: 'Production',
    work_start: '07:30',
    work_end: '16:00',
    grace_minutes: 5,
  };
  const schedule = scheduleFromDepartment(department, config);
  assert.deepEqual(schedule, {
    department: 'Production',
    workStart: '07:30',
    workEnd: '16:00',
    graceMinutes: 5,
    nightBodyWash: false,
    label: '07:30–16:00',
  });
});

test('employees without a department use the default shift', () => {
  const map = createDepartmentMap([
    { name: 'Finance', work_start: '08:00', work_end: '17:00', grace_minutes: 10 },
  ]);

  assert.equal(scheduleForEmployee({ department: '' }, map, config).label, '09:00–17:00');
  assert.equal(scheduleForEmployee({ department: 'Missing' }, map, config).label, '09:00–17:00');
  assert.equal(scheduleForEmployee({ department: 'finance' }, map, config).label, '08:00–17:00');
});

test('attendance snapshots win over the current department schedule', () => {
  const fallback = {
    department: 'Finance',
    workStart: '08:00',
    workEnd: '17:00',
    graceMinutes: 10,
    nightBodyWash: false,
    label: '08:00–17:00',
  };

  const snapshot = scheduleForRecord(
    { shift_start: '07:30', shift_end: '16:00', grace_minutes: 0, night_body_wash: 1 },
    fallback,
    config,
  );
  assert.deepEqual(snapshot, {
    department: 'Finance',
    workStart: '07:30',
    workEnd: '16:00',
    graceMinutes: 0,
    nightBodyWash: true,
    label: '07:30–16:00',
  });

  assert.equal(scheduleForRecord({}, fallback, config).label, '08:00–17:00');
});

test('scheduled shift end uses the saved snapshot and handles overnight work', () => {
  const day = scheduledEndFor(
    { work_date: '2026-11-10', shift_start: '07:00', shift_end: '16:00' },
    null,
    config,
  );
  assert.equal(day.date, '2026-11-10');
  assert.equal(day.schedule.label, '07:00–16:00');
  assert.equal(day.at.toISOString(), '2026-11-10T10:30:00.000Z'); // 16:00 Colombo

  const overnight = scheduledEndFor(
    { work_date: '2026-11-10', shift_start: '16:00', shift_end: '01:00' },
    null,
    config,
  );
  assert.equal(overnight.date, '2026-11-11');
  assert.equal(overnight.at.toISOString(), '2026-11-10T19:30:00.000Z'); // 01:00 Colombo next day
});
