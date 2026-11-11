'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMatrix,
  matrixToCsv,
  matrixToXlsx,
  buildRawRows,
  rawRowsToCsv,
  reportFilename,
  csvFilename,
  csvEscape,
} = require('../src/reports');

const config = {
  timezone: 'Asia/Colombo',
  workStart: '09:00',
  workEnd: '17:00',
  nightShiftStart: '16:00',
  graceMinutes: 10,
  workDays: [1, 2, 3, 4, 5],
};

function record(overrides) {
  return {
    id: overrides.id || 1,
    employee_id: overrides.employee_id,
    work_date: overrides.work_date,
    check_in: overrides.check_in,
    check_out: overrides.check_out || null,
    check_in_distance: 20,
    check_out_distance: 25,
    check_in_accuracy: 12,
    check_out_accuracy: 15,
    ...overrides,
  };
}

test('monthly matrix marks present, late, absent, holiday, weekend, and open shifts', () => {
  const employees = [
    { id: 1, name: 'Alice Perera', email: 'alice@example.com', department: 'Ops', active: true },
    { id: 2, name: 'Bob Silva', email: 'bob@example.com', department: 'Sales', active: true },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      work_date: '2026-11-02',
      check_in: '2026-11-02T03:30:00.000Z',
      check_out: '2026-11-02T12:00:00.000Z',
    }),
    record({
      id: 2,
      employee_id: 1,
      work_date: '2026-11-03',
      check_in: '2026-11-03T03:50:00.000Z',
      check_out: '2026-11-03T12:00:00.000Z',
    }),
    record({
      id: 3,
      employee_id: 2,
      work_date: '2026-11-04',
      check_in: '2026-11-04T03:35:00.000Z',
    }),
  ];
  const holidays = [{ date: '2026-11-05', name: 'Poya Day' }];

  const matrix = buildMatrix({
    employees,
    records,
    holidays,
    from: '2026-11-02',
    to: '2026-11-08',
    today: '2026-11-10',
    config,
  });

  assert.equal(matrix.dayColumns.length, 7);
  assert.equal(matrix.dayColumns[0].label, '02 Mon');
  assert.equal(matrix.dayColumns[3].holiday, 'Poya Day');
  assert.equal(matrix.dayColumns[5].weekend, true);

  const alice = matrix.rows.find((row) => row.employee === 'Alice Perera');
  assert.equal(alice.cells[0], 'P 09:00–17:30 (8h 30m) · OT 30m');
  assert.equal(alice.cells[1], 'L 09:20–17:30 (8h 10m) · OT 30m');
  assert.equal(alice.cells[2], 'A');
  assert.equal(alice.cells[3], 'H');
  assert.equal(alice.cells[4], 'A');
  assert.equal(alice.cells[5], '');
  assert.equal(alice.presentDays, 2);
  assert.equal(alice.lateDays, 1);
  assert.equal(alice.absentDays, 2);
  assert.equal(alice.totalHours, '16.67');
  assert.equal(alice.nightHours, '0.00');
  assert.equal(alice.overtimeHours, '1.00');

  const bob = matrix.rows.find((row) => row.employee === 'Bob Silva');
  assert.equal(bob.cells[2], 'P 09:05–OPEN');
  assert.equal(bob.openShifts, 1);
  assert.equal(bob.absentDays, 3);
});

test('current day and future dates are not marked absent', () => {
  const matrix = buildMatrix({
    employees: [{ id: 1, name: 'Alice', email: 'a@example.com', department: '', active: true }],
    records: [],
    holidays: [],
    from: '2026-11-09',
    to: '2026-11-12',
    today: '2026-11-10',
    config,
  });
  assert.equal(matrix.rows[0].cells[0], 'A'); // past Monday
  assert.equal(matrix.rows[0].cells[1], ''); // today
  assert.equal(matrix.rows[0].cells[2], ''); // future
  assert.equal(matrix.rows[0].absentDays, 1);
});

test('CSV output has a BOM, full headers without Email, and spreadsheet formula protection', () => {
  const matrix = buildMatrix({
    employees: [
      { id: 1, name: '=SUM(A1:A2)', email: 'alice@example.com', department: 'Ops', active: true },
    ],
    records: [],
    holidays: [],
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });
  const csv = matrixToCsv(matrix);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(
    csv,
    /Employee,Present days,Late days,Absent days,Open shifts,Total hours,Night Body Wash hours,Overtime hours,Department,Shift,02 Mon/,
  );
  assert.doesNotMatch(csv, /Email/);
  assert.doesNotMatch(csv, /alice@example\.com/);
  assert.match(csv, /'=SUM\(A1:A2\)/);
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('a"b'), '"a""b"');
});

test('download filenames start with the configured branch name', () => {
  assert.equal(
    csvFilename({ branchName: 'Peradeniya' }, 'attendance', '2026-11-01', '2026-11-11'),
    'Peradeniya_attendance_2026-11-01_to_2026-11-11.csv',
  );
  assert.equal(
    csvFilename({ branchName: 'Peradeniya' }, 'attendance_raw', '2026-11-01', '2026-11-11'),
    'Peradeniya_attendance_raw_2026-11-01_to_2026-11-11.csv',
  );
  assert.equal(
    csvFilename({ branchName: 'Main Branch' }, 'attendance', '2026-11-01', '2026-11-11'),
    'Main_Branch_attendance_2026-11-01_to_2026-11-11.csv',
  );
  assert.equal(
    csvFilename({ branchName: '' }, 'attendance', '2026-11-01', '2026-11-11'),
    'attendance_2026-11-01_to_2026-11-11.csv',
  );
  assert.equal(
    reportFilename({ branchName: 'Peradeniya' }, 'attendance', '2026-11-01', '2026-11-11', 'xlsx'),
    'Peradeniya_attendance_2026-11-01_to_2026-11-11.xlsx',
  );
});

test('raw rows and CSV expose check-in/out details', () => {
  const rows = buildRawRows([
    {
      id: 7,
      employee_id: 1,
      employee_name: 'Alice Perera',
      employee_email: 'alice@example.com',
      employee_department: 'Ops',
      work_date: '2026-11-10',
      check_in: '2026-11-10T03:30:00.000Z',
      check_out: '2026-11-10T12:00:00.000Z',
      check_in_distance: 22.4,
      check_out_distance: 30.1,
    },
  ], config);

  assert.equal(rows[0].checkIn, '09:00');
  assert.equal(rows[0].checkOut, '17:30');
  assert.equal(rows[0].hoursDecimal, '8.50');
  assert.equal(rows[0].overtimeHoursDecimal, '0.50');
  assert.equal(rows[0].status, 'Present');
  const csv = rawRowsToCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /Alice Perera/);
  assert.match(csv, /Hours,Night Body Wash hours,Overtime hours,Status/);
  assert.match(csv, /8.50,,0.50,Present,Approved/);
  assert.doesNotMatch(csv, /Email/);
  assert.doesNotMatch(csv, /alice@example\.com/);
});

test('department shifts drive lateness and appear in reports', () => {
  const employees = [
    {
      id: 1,
      name: 'Alice Perera',
      email: 'alice@example.com',
      department: 'Production',
      active: true,
    },
  ];
  const departments = [
    {
      id: 1,
      name: 'Production',
      work_start: '08:00',
      work_end: '16:30',
      grace_minutes: 5,
    },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      employee_department: 'Production',
      work_date: '2026-11-02',
      check_in: '2026-11-02T02:36:00.000Z', // 08:06 in Colombo
      check_out: '2026-11-02T11:00:00.000Z', // 16:30 in Colombo
    }),
  ];

  const rows = buildRawRows(records, config, departments);
  assert.equal(rows[0].shift, '08:00–16:30');
  assert.equal(rows[0].late, true);
  assert.equal(rows[0].status, 'Late');
  assert.match(rawRowsToCsv(rows), /Production,08:00–16:30/);

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });
  assert.equal(matrix.rows[0].shift, '08:00–16:30');
  assert.equal(matrix.rows[0].cells[0], 'L 08:06–16:30 (8h 24m)');
  assert.equal(matrix.rows[0].lateDays, 1);
});

test('a day worker who stays into Night Body Wash gets NB hours on the same record', () => {
  const employees = [
    { id: 1, name: 'Day Worker', email: 'day@example.com', department: 'Service', active: true },
    {
      id: 2,
      name: 'Night Worker',
      email: 'night@example.com',
      department: 'Night Body Wash',
      active: true,
    },
  ];
  const departments = [
    {
      id: 1,
      name: 'Service',
      work_start: '07:00',
      work_end: '16:00',
      grace_minutes: 10,
      night_body_wash: true,
    },
    {
      id: 2,
      name: 'Night Body Wash',
      work_start: '16:00',
      work_end: '21:00',
      grace_minutes: 10,
      night_body_wash: true,
    },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      employee_department: 'Service',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T15:30:00.000Z', // 21:00 Colombo
    }),
    record({
      id: 2,
      employee_id: 2,
      employee_department: 'Night Body Wash',
      work_date: '2026-11-02',
      check_in: '2026-11-02T10:30:00.000Z', // 16:00 Colombo
      check_out: '2026-11-02T15:30:00.000Z', // 21:00 Colombo
    }),
  ];

  const rows = buildRawRows(records, config, departments);
  assert.equal(rows[0].hoursDecimal, '14.00');
  assert.equal(rows[0].nightHoursDecimal, '5.00');
  assert.equal(rows[0].shift, '07:00–16:00');
  assert.equal(rows[0].overtimeMinutes, null);
  assert.equal(rows[1].hoursDecimal, '5.00');
  assert.equal(rows[1].nightHoursDecimal, '5.00');

  const rawCsv = rawRowsToCsv(rows);
  assert.match(rawCsv, /Hours,Night Body Wash hours,Overtime hours,Status/);
  assert.match(rawCsv, /14\.00,5\.00/);

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });
  const day = matrix.rows.find((row) => row.employee === 'Day Worker');
  const night = matrix.rows.find((row) => row.employee === 'Night Worker');
  assert.equal(day.totalHours, '14.00');
  assert.equal(day.nightHours, '5.00');
  assert.equal(day.cells[0], 'P 07:00–21:00 (14h 00m) · NB 5h 00m');
  assert.deepEqual(day.nightFlags, [true]);
  assert.equal(night.totalHours, '5.00');
  assert.equal(night.nightHours, '5.00');
  assert.equal(night.cells[0], 'P 16:00–21:00 (5h 00m) · NB 5h 00m');
  assert.deepEqual(night.nightFlags, [true]);
});

test('Clean Park earns Night Body Wash hours while Workshop and Paint earn overtime', () => {
  const departments = [
    { id: 1, name: 'Clean Park', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: true },
    { id: 2, name: 'Night Body Wash', work_start: '16:00', work_end: '21:00', grace_minutes: 10, night_body_wash: true },
    { id: 3, name: 'Workshop 1', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
    { id: 4, name: 'Paint A', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  ];
  const employees = [
    { id: 1, name: 'Clean Park Worker', email: 'clean@example.com', department: 'Clean Park', active: true },
    { id: 2, name: 'Workshop Worker', email: 'workshop@example.com', department: 'Workshop 1', active: true },
    { id: 3, name: 'Paint Worker', email: 'paint@example.com', department: 'Paint A', active: true },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      employee_department: 'Clean Park',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T11:30:00.000Z', // 17:00 Colombo
    }),
    record({
      id: 2,
      employee_id: 2,
      employee_department: 'Workshop 1',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T12:30:00.000Z', // 18:00 Colombo
    }),
    record({
      id: 3,
      employee_id: 3,
      employee_department: 'Paint A',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T11:00:00.000Z', // 16:30 Colombo
    }),
  ];

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });

  const clean = matrix.rows.find((row) => row.employee === 'Clean Park Worker');
  const workshop = matrix.rows.find((row) => row.employee === 'Workshop Worker');
  const paint = matrix.rows.find((row) => row.employee === 'Paint Worker');

  assert.equal(clean.cells[0], 'P 07:00–17:00 (10h 00m) · NB 1h 00m');
  assert.equal(clean.nightHours, '1.00');
  assert.equal(clean.overtimeHours, '0.00');
  assert.deepEqual(clean.nightFlags, [true]);

  assert.equal(workshop.cells[0], 'P 07:00–18:00 (11h 00m) · OT 2h 00m');
  assert.equal(workshop.nightHours, '0.00');
  assert.equal(workshop.overtimeHours, '2.00');
  assert.deepEqual(workshop.nightFlags, [false]);

  assert.equal(paint.cells[0], 'P 07:00–16:30 (9h 30m) · OT 30m');
  assert.equal(paint.nightHours, '0.00');
  assert.equal(paint.overtimeHours, '0.50');
  assert.deepEqual(paint.nightFlags, [false]);

  const rows = buildRawRows(records, config, departments);
  const workshopRow = rows[1]; // Workshop 1 record
  assert.equal(workshopRow.nightHoursDecimal, '');
  assert.equal(workshopRow.overtimeHoursDecimal, '2.00');
});

test('editing the Night Body Wash start moves the NB boundary', () => {
  const departments = [
    { id: 1, name: 'Service', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: true },
    {
      id: 2,
      name: 'Night Body Wash',
      work_start: '17:00',
      work_end: '22:00',
      grace_minutes: 10,
      night_body_wash: true,
    },
  ];
  const rows = buildRawRows(
    [
      record({
        id: 1,
        employee_id: 1,
        employee_department: 'Service',
        work_date: '2026-11-02',
        check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
        check_out: '2026-11-02T16:30:00.000Z', // 22:00 Colombo
      }),
    ],
    config,
    departments,
  );

  assert.equal(rows[0].hoursDecimal, '15.00');
  assert.equal(rows[0].nightHoursDecimal, '5.00'); // 17:00–22:00
});

test('an open shift does not invent Night Body Wash hours before checkout', () => {
  const rows = buildRawRows(
    [
      record({
        id: 1,
        employee_id: 1,
        employee_department: 'Night Body Wash',
        work_date: '2026-11-02',
        check_in: '2026-11-02T10:30:00.000Z', // 16:00 Colombo
      }),
    ],
    config,
    [
      {
        id: 1,
        name: 'Night Body Wash',
        work_start: '16:00',
        work_end: '21:00',
        grace_minutes: 10,
        night_body_wash: true,
      },
    ],
  );

  assert.equal(rows[0].open, true);
  assert.equal(rows[0].nightMinutes, null);
  assert.equal(rows[0].nightHours, '—');
  assert.equal(rows[0].nightHoursDecimal, '');
});

test('a Night Body Wash shift after midnight stays on its starting date', () => {
  const departments = [
    {
      id: 1,
      name: 'Night Body Wash',
      work_start: '16:00',
      work_end: '01:00',
      grace_minutes: 10,
      night_body_wash: true,
    },
  ];
  const matrix = buildMatrix({
    employees: [
      {
        id: 1,
        name: 'Night Worker',
        email: 'night@example.com',
        department: 'Night Body Wash',
        active: true,
      },
    ],
    records: [
      record({
        id: 1,
        employee_id: 1,
        employee_department: 'Night Body Wash',
        work_date: '2026-11-10',
        check_in: '2026-11-10T10:30:00.000Z', // 16:00 Colombo on 10 Nov
        check_out: '2026-11-10T19:30:00.000Z', // 01:00 Colombo on 11 Nov
      }),
    ],
    holidays: [],
    departments,
    from: '2026-11-10',
    to: '2026-11-11',
    today: '2026-11-12',
    config,
  });

  const row = matrix.rows[0];
  assert.equal(row.cells[0], 'P 16:00–01:00 (9h 00m) · NB 9h 00m');
  assert.equal(row.cells[1], 'A'); // the shift did not move to 11 Nov
  assert.equal(row.totalHours, '9.00');
  assert.equal(row.nightHours, '9.00');
});

test('historical shift snapshots override a later department change', () => {
  const employees = [
    { id: 1, name: 'Alice', email: 'alice@example.com', department: 'Production', active: true },
  ];
  const departments = [
    { id: 1, name: 'Production', work_start: '09:00', work_end: '18:00', grace_minutes: 15 },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      work_date: '2026-11-02',
      check_in: '2026-11-02T02:06:00.000Z', // 07:36 in Colombo
      check_out: '2026-11-02T10:30:00.000Z',
      shift_start: '07:30',
      shift_end: '16:00',
      grace_minutes: 0,
    }),
  ];

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });
  assert.equal(matrix.rows[0].shift, '09:00–18:00');
  assert.match(matrix.rows[0].cells[0], /^L 07:36–16:00 /);
});

test('pending approval records are marked in the matrix and raw CSV', () => {
  const employees = [
    {
      id: 1,
      name: 'Pending Worker',
      email: 'pending@example.com',
      department: 'Workshop 1',
      active: true,
    },
  ];
  const departments = [
    { id: 1, name: 'Workshop 1', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      employee_name: 'Pending Worker',
      employee_department: 'Workshop 1',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T10:30:00.000Z', // 16:00 Colombo
      approval_status: 'pending',
      auto_closed: true,
    }),
  ];

  const rows = buildRawRows(records, config, departments);
  assert.equal(rows[0].pending, true);
  assert.equal(rows[0].autoClosed, true);
  assert.equal(rows[0].status, 'Pending approval');
  const csv = rawRowsToCsv(rows);
  assert.match(csv, /Status,Approval/);
  assert.match(csv, /Pending approval,Pending approval/);

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });
  const row = matrix.rows[0];
  assert.equal(row.cells[0], 'PENDING 07:00–16:00 (9h 00m)');
  assert.deepEqual(row.pendingFlags, [true]);
  assert.equal(row.pendingApprovals, 1);
  // Pending hours still count toward payroll totals until an admin decides.
  assert.equal(row.presentDays, 1);
  assert.equal(row.totalHours, '9.00');
});

test('Excel marks pending cells red while keeping Night Body Wash yellow', async () => {
  const ExcelJS = require('exceljs');
  const departments = [
    {
      id: 1,
      name: 'Service',
      work_start: '07:00',
      work_end: '16:00',
      grace_minutes: 10,
      night_body_wash: true,
    },
    {
      id: 2,
      name: 'Night Body Wash',
      work_start: '16:00',
      work_end: '21:00',
      grace_minutes: 10,
      night_body_wash: true,
    },
    {
      id: 3,
      name: 'Workshop 1',
      work_start: '07:00',
      work_end: '16:00',
      grace_minutes: 10,
      night_body_wash: false,
    },
  ];
  const employees = [
    { id: 1, name: 'Alpha Pending', email: 'alpha@example.com', department: 'Service', active: true },
    { id: 2, name: 'Beta Pending', email: 'beta@example.com', department: 'Workshop 1', active: true },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      employee_department: 'Service',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T15:30:00.000Z', // 21:00 Colombo
      approval_status: 'pending',
      auto_closed: true,
    }),
    record({
      id: 2,
      employee_id: 2,
      employee_department: 'Workshop 1',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z',
      check_out: '2026-11-02T10:30:00.000Z', // 16:00 Colombo
      approval_status: 'pending',
      auto_closed: true,
    }),
  ];

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });
  assert.match(matrix.rows[0].cells[0], /^PENDING 07:00–21:00 .* NB 5h 00m/);
  assert.deepEqual(matrix.rows[0].pendingFlags, [true]);
  assert.deepEqual(matrix.rows[1].pendingFlags, [true]);

  const buffer = await matrixToXlsx(matrix);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Attendance');

  const nightPending = sheet.getRow(2).getCell(11);
  assert.equal(nightPending.fill.fgColor.argb, 'FFFFF2CC'); // NB yellow preserved
  assert.equal(nightPending.font.color.argb, 'FFB91C1C'); // pending red text
  assert.equal(nightPending.border.top.color.argb, 'FFDC2626');

  const plainPending = sheet.getRow(3).getCell(11);
  assert.equal(plainPending.fill.fgColor.argb, 'FFFFE4E6'); // pending red fill
  assert.equal(plainPending.font.color.argb, 'FFB91C1C');
  assert.equal(plainPending.border.left.color.argb, 'FFDC2626');
});

test('Excel workbook highlights Night Body Wash date cells and omits Email', async () => {
  const ExcelJS = require('exceljs');
  const departments = [
    { id: 1, name: 'Service', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: true },
    { id: 2, name: 'Workshop 1', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  ];
  const employees = [
    { id: 1, name: 'Day Worker', email: 'day@example.com', department: 'Service', active: true },
    { id: 2, name: 'Workshop Worker', email: 'workshop@example.com', department: 'Workshop 1', active: true },
  ];
  const records = [
    record({
      id: 1,
      employee_id: 1,
      employee_department: 'Service',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T15:30:00.000Z', // 21:00 Colombo
    }),
    record({
      id: 2,
      employee_id: 2,
      employee_department: 'Workshop 1',
      work_date: '2026-11-02',
      check_in: '2026-11-02T01:30:00.000Z', // 07:00 Colombo
      check_out: '2026-11-02T12:30:00.000Z', // 18:00 Colombo
    }),
  ];

  const matrix = buildMatrix({
    employees,
    records,
    holidays: [],
    departments,
    from: '2026-11-02',
    to: '2026-11-02',
    today: '2026-11-10',
    config,
  });

  const buffer = await matrixToXlsx(matrix);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Attendance');

  const headers = sheet.getRow(1).values.slice(1);
  assert.equal(headers[0], 'Employee');
  assert.equal(headers[8], 'Department');
  assert.equal(headers[9], 'Shift');
  assert.equal(headers[10], '02 Mon');
  assert.equal(headers.includes('Email'), false);
  assert.equal(headers.length, 11);

  const dayRow = sheet.getRow(2);
  const workshopRow = sheet.getRow(3);
  assert.equal(dayRow.getCell(1).value, 'Day Worker');
  assert.equal(workshopRow.getCell(1).value, 'Workshop Worker');

  const dayCell = dayRow.getCell(11);
  assert.equal(dayCell.fill.type, 'pattern');
  assert.equal(dayCell.fill.fgColor.argb, 'FFFFF2CC');
  assert.equal(dayCell.font.bold, true);

  const workshopCell = workshopRow.getCell(11);
  assert.notEqual(workshopCell.fill.fgColor && workshopCell.fill.fgColor.argb, 'FFFFF2CC');
});
