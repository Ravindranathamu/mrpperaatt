'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dateISOInZone,
  timeInZone,
  todayISO,
  dayOfWeek,
  addDays,
  datesBetween,
  localDateTimeToUtc,
  formatDuration,
  decimalHours,
  minutesBetween,
  isValidDateString,
  isValidTime,
} = require('../src/time');

test('timezone date and time are calculated from the instant, not the server clock', () => {
  const instant = new Date('2026-11-10T18:30:00.000Z');
  assert.equal(dateISOInZone(instant, 'Asia/Colombo'), '2026-11-11');
  assert.equal(timeInZone(instant, 'Asia/Colombo'), '00:00');
  assert.equal(todayISO('Asia/Colombo', instant), '2026-11-11');
});

test('local office time converts to the correct UTC instant', () => {
  assert.equal(
    localDateTimeToUtc('2026-11-10', '09:00', 'Asia/Colombo').toISOString(),
    '2026-11-10T03:30:00.000Z',
  );
  assert.equal(
    localDateTimeToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(),
    '2026-07-01T13:00:00.000Z',
  );
  assert.equal(
    localDateTimeToUtc('2026-12-01', '09:00', 'America/New_York').toISOString(),
    '2026-12-01T14:00:00.000Z',
  );
});

test('date helpers use UTC calendar dates', () => {
  assert.equal(dayOfWeek('2026-11-09'), 1); // Monday
  assert.equal(dayOfWeek('2026-11-10'), 2);
  assert.equal(dayOfWeek('2026-11-15'), 7); // Sunday
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.deepEqual(datesBetween('2026-11-01', '2026-11-03'), [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
  ]);
  assert.equal(isValidDateString('2026-02-29'), false);
  assert.equal(isValidDateString('2028-02-29'), true);
  assert.equal(isValidDateString('2026-11-10'), true);
});

test('duration and decimal hours are payroll friendly', () => {
  assert.equal(formatDuration(480), '8h 00m');
  assert.equal(formatDuration(65), '1h 05m');
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(null), '—');
  assert.equal(decimalHours(480), '8.00');
  assert.equal(decimalHours(490), '8.17');
  assert.equal(minutesBetween('2026-11-10T03:30:00Z', '2026-11-10T12:00:00Z'), 510);
  assert.equal(isValidTime('09:05'), true);
  assert.equal(isValidTime('9:05'), false);
  assert.equal(isValidTime('24:00'), false);
});
