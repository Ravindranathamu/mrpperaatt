'use strict';

const FORMATTERS = new Map();

function getFormatter(timeZone) {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Returns the wall-clock parts of an instant in a specific IANA timezone.
 */
function zonedParts(date, timeZone) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const lookup = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dateISOInZone(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function timeInZone(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function todayISO(timeZone, now = new Date()) {
  return dateISOInZone(now, timeZone);
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertDateString(value, label = 'date') {
  if (!isValidDateString(value)) {
    throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
  }
  return value;
}

/** Monday = 1 ... Sunday = 7 */
function dayOfWeek(dateString) {
  assertDateString(dateString);
  const [year, month, day] = dateString.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function addDays(dateString, amount) {
  const [year, month, day] = assertDateString(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(amount)));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function datesBetween(from, to) {
  assertDateString(from, 'from date');
  assertDateString(to, 'to date');
  if (from > to) return [];
  const dates = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('Invalid month.');
  }
  return {
    from: `${y}-${pad2(m)}-01`,
    to: `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`,
  };
}

function formatDateLabel(dateString, style = 'short') {
  assertDateString(dateString);
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const options =
    style === 'long'
      ? { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat('en-GB', options).format(date);
}

function weekdayShort(dateString) {
  assertDateString(dateString);
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function monthLabel(dateString) {
  assertDateString(dateString);
  const [year, month] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
}

function minutesOfDay(timeString) {
  if (!isValidTime(timeString)) throw new Error('Invalid time. Use HH:MM.');
  const [hours, minutes] = String(timeString).split(':').map(Number);
  return hours * 60 + minutes;
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) {
    return '—';
  }
  const total = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${pad2(mins)}m`;
}

function decimalHours(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) {
    return '';
  }
  return (Math.max(0, Number(minutes)) / 60).toFixed(2);
}

function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

/**
 * Converts a wall-clock date/time in a timezone to the correct UTC instant.
 * Runs the offset calculation twice so daylight-saving transitions settle.
 */
function localDateTimeToUtc(dateString, timeString, timeZone) {
  assertDateString(dateString, 'date');
  if (!isValidTime(timeString)) throw new Error('Invalid time. Use HH:MM.');
  const [year, month, day] = dateString.split('-').map(Number);
  const [hour, minute] = timeString.split(':').map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  let guess = targetAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const wallAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const offset = targetAsUtc - wallAsUtc;
    guess += offset;
  }

  const result = new Date(guess);
  const check = zonedParts(result, timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    throw new Error('That local time does not exist in the configured timezone (daylight-saving gap).');
  }
  return result;
}

function nowInZoneLabel(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

function formatDateForFile(dateString) {
  assertDateString(dateString);
  return dateString;
}

module.exports = {
  zonedParts,
  dateISOInZone,
  timeInZone,
  todayISO,
  isValidDateString,
  assertDateString,
  dayOfWeek,
  addDays,
  datesBetween,
  daysInMonth,
  monthBounds,
  formatDateLabel,
  weekdayShort,
  monthLabel,
  isValidTime,
  minutesOfDay,
  formatDuration,
  decimalHours,
  minutesBetween,
  localDateTimeToUtc,
  nowInZoneLabel,
  formatDateForFile,
  pad2,
};
