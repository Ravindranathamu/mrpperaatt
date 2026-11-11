'use strict';

const {
  timeInZone,
  minutesOfDay,
  minutesBetween,
  localDateTimeToUtc,
  formatDuration,
  decimalHours,
  dayOfWeek,
  datesBetween,
  addDays,
  weekdayShort,
} = require('./time');
const {
  createDepartmentMap,
  nightStartForDepartments,
  scheduleForEmployee,
  scheduleForRecord,
} = require('./schedule');

const STATUS = {
  PRESENT: 'PRESENT',
  LATE: 'LATE',
  OPEN: 'OPEN',
};

function isLate(checkInTime, schedule) {
  return (
    minutesOfDay(checkInTime) >
    minutesOfDay(schedule.workStart) + Number(schedule.graceMinutes || 0)
  );
}

/**
 * Minutes worked after Night Body Wash starts. Only departments marked as
 * Night Body Wash eligible earn these hours; everyone else gets overtime for
 * time after their own scheduled finish instead. A day worker who stays on
 * continuously has one record; the evening portion is labelled here instead
 * of being treated as a second shift. Open shifts return null because their
 * finish time is not known yet.
 */
function nightMinutesFor(record, config, nightStart, schedule) {
  if (!record || !record.check_out || !record.work_date) return null;
  if (!schedule || !schedule.nightBodyWash) return null;

  const nightStartTime = nightStart || '16:00';
  const checkIn = new Date(record.check_in);
  const checkOut = new Date(record.check_out);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return null;

  let from = checkIn;
  try {
    const nightWorker =
      schedule && minutesOfDay(schedule.workStart) >= minutesOfDay(nightStartTime);

    if (!nightWorker) {
      // Day workers only start earning Night Body Wash hours after BOTH their
      // own shift has finished and the night shift has started. This keeps a
      // normal 09:00–17:30 shift from being labelled as night work.
      let boundaryTime = nightStartTime;
      if (schedule && minutesOfDay(schedule.workEnd) > minutesOfDay(boundaryTime)) {
        boundaryTime = schedule.workEnd;
      }
      const boundary = localDateTimeToUtc(record.work_date, boundaryTime, config.timezone);
      if (boundary.getTime() > from.getTime()) from = boundary;
    }
  } catch {
    return null;
  }

  if (from.getTime() >= checkOut.getTime()) return 0;
  return Math.round((checkOut.getTime() - from.getTime()) / 60000);
}

/**
 * Minutes worked after the employee's scheduled finish. This applies to
 * departments that are not Night Body Wash eligible (Workshop and Paint
 * teams). Night Body Wash eligible departments report their evening time as
 * Night Body Wash hours instead. Open shifts return null because their finish
 * time is not known yet.
 */
function overtimeMinutesFor(record, config, schedule) {
  if (!record || !record.check_out || !record.work_date) return null;
  if (!schedule || schedule.nightBodyWash) return null;
  if (!schedule.workStart || !schedule.workEnd) return null;

  const checkOut = new Date(record.check_out);
  if (Number.isNaN(checkOut.getTime())) return null;

  try {
    const endDate =
      minutesOfDay(schedule.workEnd) <= minutesOfDay(schedule.workStart)
        ? addDays(record.work_date, 1)
        : record.work_date;
    const scheduledEnd = localDateTimeToUtc(endDate, schedule.workEnd, config.timezone);
    if (checkOut.getTime() <= scheduledEnd.getTime()) return 0;
    return Math.round((checkOut.getTime() - scheduledEnd.getTime()) / 60000);
  } catch {
    return null;
  }
}

/**
 * Converts a database attendance row into safe, display-ready fields.
 */
function formatRecord(record, config, options = {}) {
  const schedule = scheduleForRecord(record, options.schedule, config);
  const checkIn = timeInZone(new Date(record.check_in), config.timezone);
  const checkOut = record.check_out ? timeInZone(new Date(record.check_out), config.timezone) : null;
  const minutes = minutesBetween(record.check_in, record.check_out);
  const nightMinutes = nightMinutesFor(
    record,
    config,
    options.nightStart || config.nightShiftStart,
    schedule,
  );
  const overtimeMinutes = overtimeMinutesFor(record, config, schedule);
  const late = isLate(checkIn, schedule);
  const open = !record.check_out;
  const status = open ? STATUS.OPEN : late ? STATUS.LATE : STATUS.PRESENT;

  const formatted = {
    id: record.id,
    employeeId: record.employee_id,
    workDate: record.work_date,
    checkIn,
    checkOut,
    minutes,
    hours: formatDuration(minutes),
    nightMinutes,
    nightHours: formatDuration(nightMinutes),
    overtimeMinutes,
    overtimeHours: formatDuration(overtimeMinutes),
    status,
    late,
    open,
    shift: schedule.label,
    shiftStart: schedule.workStart,
    shiftEnd: schedule.workEnd,
    graceMinutes: schedule.graceMinutes,
  };

  if (options.includeAudit) {
    formatted.checkInDistance =
      record.check_in_distance === null || record.check_in_distance === undefined
        ? null
        : Math.round(record.check_in_distance);
    formatted.checkOutDistance =
      record.check_out_distance === null || record.check_out_distance === undefined
        ? null
        : Math.round(record.check_out_distance);
    formatted.checkInAccuracy =
      record.check_in_accuracy === null || record.check_in_accuracy === undefined
        ? null
        : Math.round(record.check_in_accuracy);
    formatted.checkOutAccuracy =
      record.check_out_accuracy === null || record.check_out_accuracy === undefined
        ? null
        : Math.round(record.check_out_accuracy);
  }

  return formatted;
}

function statusLabel(record) {
  if (record.open) return 'Open (no check-out)';
  if (record.late) return 'Late';
  return 'Present';
}

function buildRawRows(records, config, departments = []) {
  const departmentMap = createDepartmentMap(departments);
  const nightStart = nightStartForDepartments(departments, config);
  return records.map((record) => {
    const schedule = scheduleForEmployee(
      { department: record.employee_department || record.department || '' },
      departmentMap,
      config,
    );
    const formatted = formatRecord(record, config, {
      includeAudit: true,
      schedule,
      nightStart,
    });
    return {
      id: formatted.id,
      date: formatted.workDate,
      employee: record.employee_name || record.name || '',
      email: record.employee_email || record.email || '',
      department: record.employee_department || record.department || '',
      shift: formatted.shift,
      checkIn: formatted.checkIn,
      checkOut: formatted.checkOut,
      minutes: formatted.minutes,
      hours: formatted.hours,
      hoursDecimal: decimalHours(formatted.minutes),
      nightMinutes: formatted.nightMinutes,
      nightHours: formatted.nightHours,
      nightHoursDecimal: decimalHours(formatted.nightMinutes),
      overtimeMinutes: formatted.overtimeMinutes,
      overtimeHours: formatted.overtimeHours,
      overtimeHoursDecimal: decimalHours(formatted.overtimeMinutes),
      status: statusLabel(formatted),
      statusCode: formatted.status,
      late: formatted.late,
      open: formatted.open,
      checkInDistance: formatted.checkInDistance,
      checkOutDistance: formatted.checkOutDistance,
    };
  });
}

function summarizeRows(rows) {
  const employeeEmails = new Set(rows.map((row) => row.email).filter(Boolean));
  const totalMinutes = rows.reduce((sum, row) => sum + (row.minutes || 0), 0);
  const nightMinutes = rows.reduce((sum, row) => sum + (row.nightMinutes || 0), 0);
  const overtimeMinutes = rows.reduce((sum, row) => sum + (row.overtimeMinutes || 0), 0);
  return {
    records: rows.length,
    employees: employeeEmails.size,
    totalMinutes,
    totalHours: decimalHours(totalMinutes),
    nightMinutes,
    nightHours: decimalHours(nightMinutes),
    overtimeMinutes,
    overtimeHours: decimalHours(overtimeMinutes),
    late: rows.filter((row) => row.late).length,
    open: rows.filter((row) => row.open).length,
  };
}

function holidayMapFromList(holidays) {
  const map = new Map();
  for (const holiday of holidays || []) {
    map.set(holiday.date, holiday.name || 'Holiday');
  }
  return map;
}

/**
 * Builds the month-end attendance matrix:
 * employees as rows, one column per day, plus payroll-friendly totals.
 */
function buildMatrix({ employees, records, holidays, from, to, today, config, departments = [] }) {
  const dates = datesBetween(from, to);
  if (dates.length > 366) throw new Error('Report range cannot exceed 366 days.');

  const recordMap = new Map();
  for (const record of records || []) {
    recordMap.set(`${record.employee_id}|${record.work_date}`, record);
  }
  const holidayMap = holidayMapFromList(holidays);
  const departmentMap = createDepartmentMap(departments);
  const nightStart = nightStartForDepartments(departments, config);

  const dayColumns = dates.map((date) => ({
    date,
    label: `${date.slice(8, 10)} ${weekdayShort(date)}`,
    weekend: !config.workDays.includes(dayOfWeek(date)),
    holiday: holidayMap.get(date) || null,
  }));

  const rows = (employees || []).map((employee) => {
    const schedule = scheduleForEmployee(employee, departmentMap, config);
    const cells = [];
    const nightFlags = [];
    let presentDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    let openShifts = 0;
    let totalMinutes = 0;
    let nightMinutes = 0;
    let overtimeMinutes = 0;

    for (const date of dates) {
      const record = recordMap.get(`${employee.id}|${date}`);
      const column = dayColumns.find((item) => item.date === date);

      if (record) {
        const formatted = formatRecord(record, config, { schedule, nightStart });
        const prefix = formatted.open ? (formatted.late ? 'L' : 'P') : formatted.status === STATUS.LATE ? 'L' : 'P';
        if (formatted.open) {
          cells.push(`${prefix} ${formatted.checkIn}–OPEN`);
          openShifts += 1;
        } else {
          const extras = [];
          if (formatted.nightMinutes > 0) extras.push(`NB ${formatted.nightHours}`);
          if (formatted.overtimeMinutes > 0) extras.push(`OT ${formatted.overtimeHours}`);
          const suffix = extras.length ? ` · ${extras.join(' · ')}` : '';
          cells.push(
            `${prefix} ${formatted.checkIn}–${formatted.checkOut} (${formatted.hours})${suffix}`,
          );
        }
        nightFlags.push(Boolean(formatted.nightMinutes > 0));
        presentDays += 1;
        if (formatted.late) lateDays += 1;
        totalMinutes += formatted.minutes || 0;
        nightMinutes += formatted.nightMinutes || 0;
        overtimeMinutes += formatted.overtimeMinutes || 0;
      } else if (column.holiday) {
        cells.push('H');
        nightFlags.push(false);
      } else if (column.weekend) {
        cells.push('');
        nightFlags.push(false);
      } else if (employee.active && date < today) {
        cells.push('A');
        nightFlags.push(false);
        absentDays += 1;
      } else {
        cells.push('');
        nightFlags.push(false);
      }
    }

    return {
      employeeId: employee.id,
      employee: employee.name,
      email: employee.email,
      department: employee.department || '',
      shift: schedule.label,
      active: Boolean(employee.active),
      cells,
      nightFlags,
      presentDays,
      lateDays,
      absentDays,
      openShifts,
      totalMinutes,
      totalHours: decimalHours(totalMinutes),
      nightMinutes,
      nightHours: decimalHours(nightMinutes),
      overtimeMinutes,
      overtimeHours: decimalHours(overtimeMinutes),
    };
  });

  rows.sort((a, b) => a.employee.localeCompare(b.employee, undefined, { sensitivity: 'base' }));

  return {
    from,
    to,
    today,
    dayColumns,
    headers: [
      'Employee',
      'Present days',
      'Late days',
      'Absent days',
      'Open shifts',
      'Total hours',
      'Night Body Wash hours',
      'Overtime hours',
      'Department',
      'Shift',
      ...dayColumns.map((column) => column.label),
    ],
    rows,
  };
}

function csvEscape(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet formula injection from employee-supplied names.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  const body = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  return `\uFEFF${body}\r\n`;
}

function matrixToCsv(matrix) {
  const rows = [matrix.headers];
  for (const row of matrix.rows) {
    rows.push([
      row.employee,
      row.presentDays,
      row.lateDays,
      row.absentDays,
      row.openShifts,
      row.totalHours,
      row.nightHours,
      row.overtimeHours,
      row.department,
      row.shift,
      ...row.cells,
    ]);
  }
  return toCsv(rows);
}

/**
 * Builds a real Excel workbook for payroll. CSV cannot store cell colours, so
 * this version highlights every day cell that contains Night Body Wash hours.
 */
async function matrixToXlsx(matrix) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RavSOFT Attendance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Attendance', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const fixedColumns = matrix.headers.length - matrix.dayColumns.length;
  const header = sheet.addRow(matrix.headers);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 32;

  for (const row of matrix.rows) {
    const excelRow = sheet.addRow([
      row.employee,
      row.presentDays,
      row.lateDays,
      row.absentDays,
      row.openShifts,
      Number(row.totalHours),
      Number(row.nightHours),
      Number(row.overtimeHours),
      row.department,
      row.shift,
      ...row.cells,
    ]);

    for (let index = 0; index < row.cells.length; index += 1) {
      const cell = excelRow.getCell(fixedColumns + index + 1);
      cell.alignment = { vertical: 'top', wrapText: true };
      if (row.nightFlags && row.nightFlags[index]) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        cell.font = { bold: true, color: { argb: 'FF92400E' } };
      }
    }

    for (let index = 1; index <= fixedColumns; index += 1) {
      const cell = excelRow.getCell(index);
      if (index > 1 && index < fixedColumns) {
        cell.alignment = { horizontal: 'center', vertical: 'top' };
      } else {
        cell.alignment = { vertical: 'top', wrapText: true };
      }
    }
  }

  const fixedWidths = [26, 11, 10, 11, 11, 12, 15, 13, 20, 14];
  for (let index = 0; index < fixedColumns; index += 1) {
    sheet.getColumn(index + 1).width = fixedWidths[index] || 14;
  }
  for (let index = fixedColumns; index < matrix.headers.length; index += 1) {
    sheet.getColumn(index + 1).width = 24;
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: matrix.headers.length },
  };

  return workbook.xlsx.writeBuffer();
}

function rawRowsToCsv(rows) {
  const headers = [
    'Date',
    'Employee',
    'Department',
    'Shift',
    'Check in',
    'Check out',
    'Hours',
    'Night Body Wash hours',
    'Overtime hours',
    'Status',
    'Check-in distance (m)',
    'Check-out distance (m)',
  ];
  return toCsv([
    headers,
    ...rows.map((row) => [
      row.date,
      row.employee,
      row.department,
      row.shift,
      row.checkIn,
      row.checkOut || '',
      row.hoursDecimal,
      row.nightHoursDecimal,
      row.overtimeHoursDecimal,
      row.status,
      row.checkInDistance ?? '',
      row.checkOutDistance ?? '',
    ]),
  ]);
}

/**
 * Builds a download filename such as
 * Peradeniya_attendance_2026-11-01_to_2026-11-11.csv. When BRANCH_NAME is
 * empty the branch prefix is omitted.
 */
function reportFilename(config, kind, from, to, extension = 'csv') {
  const branch = String((config && config.branchName) || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefix = branch ? `${branch}_` : '';
  return `${prefix}${kind}_${from}_to_${to}.${extension}`;
}

function csvFilename(config, kind, from, to) {
  return reportFilename(config, kind, from, to, 'csv');
}

module.exports = {
  STATUS,
  isLate,
  formatRecord,
  buildRawRows,
  summarizeRows,
  buildMatrix,
  matrixToCsv,
  matrixToXlsx,
  rawRowsToCsv,
  reportFilename,
  csvFilename,
  toCsv,
  csvEscape,
};
