'use strict';

const { isValidTime } = require('./time');

function timeOr(value, fallback) {
  return isValidTime(value) ? String(value) : fallback;
}

function graceOr(value, fallback) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 240 ? minutes : fallback;
}

/**
 * Builds a complete shift schedule from a department row, falling back to the
 * global defaults for anything the department has not overridden.
 */
function scheduleFromDepartment(department, config) {
  const workStart = timeOr(department && department.work_start, config.workStart);
  const workEnd = timeOr(department && department.work_end, config.workEnd || '17:00');
  const graceMinutes = graceOr(department && department.grace_minutes, config.graceMinutes);
  return {
    department: department && department.name ? String(department.name) : '',
    workStart,
    workEnd,
    graceMinutes,
    nightBodyWash: Boolean(department && department.night_body_wash),
    label: `${workStart}–${workEnd}`,
  };
}

function createDepartmentMap(departments) {
  const map = new Map();
  for (const department of departments || []) {
    const key = String(department.name || '').trim().toLowerCase();
    if (key) map.set(key, department);
  }
  return map;
}

/**
 * Night Body Wash hours start when the Night Body Wash department starts.
 * If that department has not been created or renamed, the configured
 * NIGHT_SHIFT_START is used instead.
 */
function nightStartForDepartments(departments, config) {
  const fallback =
    config && isValidTime(config.nightShiftStart) ? String(config.nightShiftStart) : '16:00';
  const department = (departments || []).find(
    (item) => String(item.name || '').trim().toLowerCase() === 'night body wash',
  );
  if (department && isValidTime(department.work_start)) return String(department.work_start);
  return fallback;
}

function scheduleForEmployee(employee, departmentsByName, config) {
  const name = String((employee && employee.department) || '').trim();
  const department =
    name && departmentsByName ? departmentsByName.get(name.toLowerCase()) : null;
  return scheduleFromDepartment(department, config);
}

/**
 * Uses the shift snapshot saved with the attendance record, so changing a
 * department's schedule later does not rewrite history. Older records without
 * a snapshot fall back to the employee's current department schedule.
 */
function scheduleForRecord(record, fallbackSchedule, config) {
  const base = fallbackSchedule || scheduleFromDepartment(null, config);
  if (!record || !isValidTime(record.shift_start)) return base;

  const workStart = String(record.shift_start);
  const workEnd = timeOr(record.shift_end, base.workEnd);
  const graceMinutes = graceOr(record.grace_minutes, base.graceMinutes);
  const nightBodyWash =
    record.night_body_wash === null || record.night_body_wash === undefined
      ? Boolean(base.nightBodyWash)
      : Boolean(record.night_body_wash);
  return {
    ...base,
    workStart,
    workEnd,
    graceMinutes,
    nightBodyWash,
    label: `${workStart}–${workEnd}`,
  };
}

module.exports = {
  scheduleFromDepartment,
  createDepartmentMap,
  nightStartForDepartments,
  scheduleForEmployee,
  scheduleForRecord,
};
