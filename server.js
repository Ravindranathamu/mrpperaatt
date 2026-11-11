'use strict';

require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { loadConfig } = require('./src/config');
const { createDatabase, migrate, seedDefaultDepartments, healthCheck } = require('./src/db');
const { distanceMeters } = require('./src/geo');
const {
  todayISO,
  dayOfWeek,
  assertDateString,
  isValidTime,
  localDateTimeToUtc,
  formatDateLabel,
  formatDuration,
  minutesBetween,
  minutesOfDay,
  addDays,
  timeInZone,
} = require('./src/time');
const {
  formatRecord,
  buildRawRows,
  summarizeRows,
  buildMatrix,
  matrixToCsv,
  matrixToXlsx,
  rawRowsToCsv,
  reportFilename,
  csvFilename,
} = require('./src/reports');
const {
  createDepartmentMap,
  scheduleForEmployee,
  scheduleForRecord,
  scheduledEndFor,
} = require('./src/schedule');
const {
  httpError,
  safeCompare,
  verifyGoogleCredential,
  createLoadEmployee,
  requireEmployee,
  adminIsAuthenticated,
  requireAdmin,
} = require('./src/auth');

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

const db = createDatabase(config);
const isPostgres = Boolean(config.databaseUrl);
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security headers and middleware
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' https://accounts.google.com https://www.gstatic.com https://www.google.com",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com",
      "frame-src https://accounts.google.com https://www.google.com",
      "connect-src 'self' https://accounts.google.com",
      "img-src 'self' data: https://*.googleusercontent.com",
      "font-src 'self'",
    ].join('; '),
  );
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.json({ limit: '32kb' }));

app.use(
  cookieSession({
    name: 'attendance_session',
    keys: [config.sessionSecret],
    maxAge: config.employeeSessionMs,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  }),
);

// SameSite=Lax plus this origin check blocks cross-site state-changing requests.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
});

app.use(createLoadEmployee(db));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes.' }),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes.' }),
});

const punchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.session && req.session.employeeId
      ? `employee:${req.session.employeeId}`
      : ipKeyGenerator(req.ip),
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many check-in attempts. Please wait a few minutes.' }),
});

const adminWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many requests. Please wait a moment.' }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function publicEmployee(employee) {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    department: employee.department || '',
  };
}

function publicDepartment(department, employeeCount = 0) {
  return {
    id: department.id,
    name: department.name,
    workStart: department.work_start,
    workEnd: department.work_end,
    graceMinutes: department.grace_minutes,
    nightBodyWash: Boolean(department.night_body_wash),
    employeeCount,
  };
}

function publicSchedule(schedule) {
  return {
    department: schedule.department,
    workStart: schedule.workStart,
    workEnd: schedule.workEnd,
    graceMinutes: schedule.graceMinutes,
    nightBodyWash: Boolean(schedule.nightBodyWash),
    label: schedule.label,
  };
}

async function canonicalDepartmentName(value) {
  const name = String(value || '').trim().slice(0, 120);
  if (!name) return '';
  const department = await db('departments')
    .whereRaw('lower(name) = ?', [name.toLowerCase()])
    .first();
  if (!department) {
    throw httpError(400, 'That department does not exist. Add it under Departments first.');
  }
  return department.name;
}

async function departmentNamesForEmployees() {
  const departments = await db('departments').orderBy('name');
  return createDepartmentMap(departments);
}

function clientIp(req) {
  return String(req.ip || '').slice(0, 64);
}

function firstName(name) {
  return String(name || 'there').trim().split(/\s+/)[0] || 'there';
}

function uniqueViolation(error) {
  return (
    error &&
    (error.code === '23505' ||
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      /unique constraint/i.test(String(error.message)))
  );
}

function parseCoordinates(body) {
  const latitude = Number(body && body.latitude);
  const longitude = Number(body && body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw httpError(400, 'Your GPS coordinates were missing. Enable location and try again.');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw httpError(400, 'Your GPS coordinates were invalid. Try again.');
  }

  let accuracy = null;
  if (body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== '') {
    accuracy = Number(body.accuracy);
    if (!Number.isFinite(accuracy) || accuracy < 0) {
      throw httpError(400, 'Your GPS accuracy reading was invalid. Try again.');
    }
  }
  if (accuracy !== null && accuracy > config.maxGpsAccuracyMeters) {
    throw httpError(
      422,
      `Your phone's location accuracy is too low (${Math.round(accuracy)}m). Move near a window and try again.`,
    );
  }

  return { latitude, longitude, accuracy };
}

async function getOpenShift(employeeId, now, executor = db, lock = false) {
  const cutoff = new Date(now.getTime() - config.openShiftHours * 60 * 60 * 1000).toISOString();
  let query = executor('attendance')
    .where({ employee_id: employeeId })
    .whereNull('check_out')
    .andWhere('check_in', '>=', cutoff)
    .orderBy('check_in', 'desc');
  if (isPostgres && lock) query = query.forUpdate();
  return query.first();
}

async function getPendingApproval(employeeId, executor = db, lock = false) {
  let query = executor('attendance')
    .where({ employee_id: employeeId, approval_status: 'pending' })
    .orderBy('work_date', 'desc');
  if (isPostgres && lock) query = query.forUpdate();
  return query.first();
}

async function attendanceState(employee, now = new Date()) {
  const today = todayISO(config.timezone, now);
  const [open, pending] = await Promise.all([
    getOpenShift(employee.id, now),
    getPendingApproval(employee.id),
  ]);
  let record = open;
  let action;

  if (open) {
    action = 'OUT';
  } else {
    record = await db('attendance')
      .where({ employee_id: employee.id, work_date: today })
      .first();
    if (!record) action = 'IN';
    else if (!record.check_out) action = 'OUT';
    else action = 'DONE';
  }

  const [holiday, workday, departmentMap] = await Promise.all([
    db('holidays').where({ date: today }).first(),
    Promise.resolve(config.workDays.includes(dayOfWeek(today))),
    departmentNamesForEmployees(),
  ]);
  const schedule = scheduleForEmployee(employee, departmentMap, config);
  const pendingRecord = pending ? formatRecord(pending, config, { schedule }) : null;

  return {
    action,
    today,
    record: record ? formatRecord(record, config, { schedule }) : null,
    openShift: Boolean(open) && open.work_date !== today,
    pendingApproval: pendingRecord
      ? {
          id: pendingRecord.id,
          workDate: pendingRecord.workDate,
          checkIn: pendingRecord.checkIn,
          checkOut: pendingRecord.checkOut,
          hours: pendingRecord.hours,
          pending: true,
          autoClosed: pendingRecord.autoClosed,
        }
      : null,
    workday,
    holiday: holiday ? holiday.name : null,
    schedule: publicSchedule(schedule),
    now: now.toISOString(),
    timezone: config.timezone,
  };
}

function parseRange(req) {
  const today = todayISO(config.timezone);
  const from = String(req.query.from || `${today.slice(0, 7)}-01`);
  const to = String(req.query.to || today);
  try {
    assertDateString(from, 'from date');
    assertDateString(to, 'to date');
  } catch (error) {
    throw httpError(400, error.message);
  }
  if (from > to) throw httpError(400, 'The start date must be on or before the end date.');

  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const dayCount =
    Math.round(
      (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) /
        86400000,
    ) + 1;
  if (dayCount > config.reportMaxDays) {
    throw httpError(400, `Reports can cover at most ${config.reportMaxDays} days.`);
  }
  return { from, to, today, dayCount };
}

async function attendanceRecordsBetween(from, to, filters = {}) {
  const query = db('attendance as a')
    .join('employees as e', 'a.employee_id', 'e.id')
    .whereBetween('a.work_date', [from, to]);

  if (filters.employeeId) {
    query.where('e.id', filters.employeeId);
  }
  if (filters.department === '__none__') {
    query.whereRaw("coalesce(e.department, '') = ''");
  } else if (filters.department) {
    query.whereRaw('lower(e.department) = ?', [filters.department.toLowerCase()]);
  }

  return query
    .orderBy([
      { column: 'a.work_date', order: 'desc' },
      { column: 'a.check_in', order: 'asc' },
    ])
    .select(
      'a.*',
      'e.name as employee_name',
      'e.email as employee_email',
      'e.department as employee_department',
      'e.active as employee_active',
    );
}

function parseReportFilters(req) {
  const department = String(req.query.department || '').trim();
  const rawEmployeeId = req.query.employeeId;
  let employeeId = null;

  if (rawEmployeeId !== undefined && String(rawEmployeeId).trim() !== '') {
    employeeId = Number(rawEmployeeId);
    if (!Number.isInteger(employeeId) || employeeId < 1) {
      throw httpError(400, 'Invalid employee filter.');
    }
  }

  return { department, employeeId };
}

function employeeMatchesFilters(employee, filters) {
  if (filters.employeeId && employee.id !== filters.employeeId) return false;
  const department = String(employee.department || '').trim();
  if (!filters.department) return true;
  if (filters.department === '__none__') return department === '';
  return department.toLowerCase() === filters.department.toLowerCase();
}

function setDownloadHeaders(res, contentType, filename) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
}

function setCsvHeaders(res, filename) {
  setDownloadHeaders(res, 'text/csv; charset=utf-8', filename);
}

// ---------------------------------------------------------------------------
// Public configuration and session
// ---------------------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({
    companyName: config.companyName,
    branchName: config.branchName,
    copyrightName: config.copyrightName,
    contactPhone: config.contactPhone,
    contactEmail: config.contactEmail,
    timezone: config.timezone,
    workStart: config.workStart,
    workEnd: config.workEnd,
    nightShiftStart: config.nightShiftStart,
    graceMinutes: config.graceMinutes,
    workDays: config.workDays,
    googleClientId: config.googleClientId || null,
    googleConfigured: config.googleConfigured,
    geofenceConfigured: config.geofenceConfigured,
    serverToday: todayISO(config.timezone),
  });
});

app.get('/api/session', (req, res) => {
  res.json({
    employee: req.employee ? publicEmployee(req.employee) : null,
    admin: adminIsAuthenticated(req, config),
    companyName: config.companyName,
    timezone: config.timezone,
  });
});

// Lightweight liveness probe for external keep-awake monitors. It deliberately
// does not touch the database: pinging /api/health every few minutes would keep
// Neon awake around the clock and can exhaust the free compute hours. Render's
// own deploy health check still uses /api/health below.
app.get('/api/ping', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/health', async (req, res) => {
  try {
    await healthCheck(db);
    res.json({ ok: true });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ ok: false });
  }
});

// ---------------------------------------------------------------------------
// Employee authentication
// ---------------------------------------------------------------------------

app.post('/api/auth/google', authLimiter, async (req, res) => {
  if (!config.googleConfigured) {
    return res.status(503).json({
      error: 'Google sign-in is not configured. Add GOOGLE_CLIENT_ID to the server environment.',
    });
  }

  const profile = await verifyGoogleCredential(req.body && req.body.credential, config.googleClientId);

  if (config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(profile.emailDomain)) {
    return res.status(403).json({
      error: 'Use your company Google account to sign in.',
    });
  }

  let employee = await db('employees').where({ email: profile.email }).first();

  if (!employee) {
    if (!config.allowSelfRegistration) {
      return res.status(403).json({
        error: 'Your email is not on the employee list. Ask your administrator to add you.',
      });
    }

    const now = new Date().toISOString();
    try {
      await db('employees').insert({
        email: profile.email,
        name: profile.name || profile.email.split('@')[0],
        department: '',
        active: true,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
    }
    employee = await db('employees').where({ email: profile.email }).first();
  }

  if (!employee) {
    throw httpError(500, 'Could not create your employee record. Please try again.');
  }
  if (!employee.active) {
    return res.status(403).json({
      error: 'Your employee record is inactive. Ask your administrator to reactivate it.',
    });
  }

  req.session.employeeId = employee.id;
  res.json({ ok: true, employee: publicEmployee(employee) });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) delete req.session.employeeId;
  res.json({ ok: true });
});

app.get('/api/attendance/status', requireEmployee, async (req, res) => {
  const state = await attendanceState(req.employee);
  res.json({
    ...state,
    employee: publicEmployee(req.employee),
  });
});

app.post('/api/attendance/punch', punchLimiter, requireEmployee, async (req, res) => {
  if (!config.geofenceConfigured) {
    return res.status(503).json({
      error: 'The office location is not configured. Ask your administrator to set OFFICE_LAT and OFFICE_LNG.',
    });
  }

  const { latitude, longitude, accuracy } = parseCoordinates(req.body);
  const distance = distanceMeters(latitude, longitude, config.officeLat, config.officeLng);

  if (!Number.isFinite(distance)) {
    return res.status(400).json({ error: 'Could not read your location. Try again.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const ip = clientIp(req);
  const schedule = scheduleForEmployee(
    req.employee,
    await departmentNamesForEmployees(),
    config,
  );

  // Outside the fence: a check-out attempt is refused, but an open shift is
  // closed at its saved department finish time and flagged for admin approval.
  // This keeps the shift from staying open while still blocking payroll until
  // an administrator accepts or corrects the saved check-out.
  if (distance > config.allowedRadiusMeters) {
    const autoClosed = await db.transaction(async (trx) => {
      const open = await getOpenShift(req.employee.id, now, trx, true);
      if (!open) return null;

      const checkInDate = new Date(open.check_in);
      if (Number.isNaN(checkInDate.getTime())) {
        throw httpError(409, 'This open shift has an invalid check-in time. Ask an administrator to fix it.');
      }

      const scheduled = scheduledEndFor(open, schedule, config);
      let checkOutDate = scheduled ? scheduled.at : now;
      if (checkOutDate.getTime() <= checkInDate.getTime()) checkOutDate = now;
      const latestAllowed = checkInDate.getTime() + 24 * 60 * 60 * 1000;
      if (checkOutDate.getTime() > latestAllowed) checkOutDate = new Date(latestAllowed);

      const updated = {
        check_out: checkOutDate.toISOString(),
        check_out_distance: distance,
        check_out_accuracy: accuracy,
        check_out_ip: ip,
        approval_status: 'pending',
        approved_at: null,
        auto_closed: true,
        updated_at: nowIso,
      };
      const affected = await trx('attendance')
        .where({ id: open.id })
        .whereNull('check_out')
        .update(updated);
      if (!affected) throw httpError(409, 'This shift was already closed. Refresh and try again.');

      return {
        record: { ...open, ...updated },
        checkOut: timeInZone(checkOutDate, config.timezone),
      };
    });

    if (autoClosed) {
      return res.status(403).json({
        error:
          `You are ${Math.round(distance)}m from the office, so this check-out was rejected. ` +
          `Your shift was closed at ${autoClosed.checkOut} and is waiting for admin approval. ` +
          'You cannot check in again until an administrator approves it.',
        distance: Math.round(distance),
        autoClosed: true,
        checkOut: autoClosed.checkOut,
        pendingApproval: true,
      });
    }

    return res.status(403).json({
      error: `You must be at the office to check in or out. You are ${Math.round(distance)}m away.`,
      distance: Math.round(distance),
    });
  }

  const today = todayISO(config.timezone, now);
  let outcome;

  try {
    outcome = await db.transaction(async (trx) => {
      const open = await getOpenShift(req.employee.id, now, trx, true);

      if (open) {
        const elapsedSeconds = (now.getTime() - new Date(open.check_in).getTime()) / 1000;
        if (elapsedSeconds < config.punchCooldownSeconds) {
          throw httpError(
            429,
            `You just checked in. Please wait ${Math.max(
              1,
              Math.ceil(config.punchCooldownSeconds - elapsedSeconds),
            )} seconds before checking out.`,
          );
        }

        const updated = {
          check_out: nowIso,
          check_out_distance: distance,
          check_out_accuracy: accuracy,
          check_out_ip: ip,
          updated_at: nowIso,
        };
        const affected = await trx('attendance')
          .where({ id: open.id })
          .whereNull('check_out')
          .update(updated);
        if (!affected) throw httpError(409, 'This shift was already closed. Refresh and try again.');

        return {
          action: 'OUT',
          record: { ...open, ...updated },
        };
      }

      // A rejected out-of-office check-out becomes a pending record. The
      // employee may not start another shift until an admin approves it.
      const pending = await getPendingApproval(req.employee.id, trx, true);
      if (pending) {
        throw httpError(
          403,
          'Your previous shift is waiting for admin approval. Contact the administrator before checking in again.',
        );
      }

      let existingQuery = trx('attendance').where({
        employee_id: req.employee.id,
        work_date: today,
      });
      if (isPostgres) existingQuery = existingQuery.forUpdate();
      const existing = await existingQuery.first();

      if (existing) {
        if (existing.check_out) {
          throw httpError(409, 'Your attendance is already complete for today.');
        }
        // A same-day open shift should normally have been found above.
        throw httpError(409, 'You already have an open shift today. Refresh and try again.');
      }

      const inserted = {
        employee_id: req.employee.id,
        work_date: today,
        check_in: nowIso,
        check_out: null,
        check_in_distance: distance,
        check_in_accuracy: accuracy,
        check_in_ip: ip,
        shift_start: schedule.workStart,
        shift_end: schedule.workEnd,
        grace_minutes: schedule.graceMinutes,
        night_body_wash: Boolean(schedule.nightBodyWash),
        approval_status: 'approved',
        approved_at: null,
        auto_closed: false,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await trx('attendance').insert(inserted);

      return {
        action: 'IN',
        record: inserted,
      };
    });
  } catch (error) {
    if (uniqueViolation(error)) {
      throw httpError(409, 'Attendance was just recorded for today. Refresh the page.');
    }
    throw error;
  }

  const record = formatRecord(outcome.record, config, { schedule });
  const name = firstName(req.employee.name);
  const message =
    outcome.action === 'IN'
      ? `Welcome, ${name}! Checked in at ${record.checkIn}.`
      : `Goodbye, ${name}! Checked out at ${record.checkOut}.`;

  res.json({
    success: true,
    action: outcome.action,
    message,
    record,
    schedule: publicSchedule(schedule),
    distance: Math.round(distance),
  });
});

app.get('/api/me/history', requireEmployee, async (req, res) => {
  const [records, departmentMap] = await Promise.all([
    db('attendance')
      .where({ employee_id: req.employee.id })
      .orderBy('work_date', 'desc')
      .limit(14),
    departmentNamesForEmployees(),
  ]);
  const schedule = scheduleForEmployee(req.employee, departmentMap, config);
  res.json({
    records: records.map((record) => formatRecord(record, config, { schedule })),
  });
});

// ---------------------------------------------------------------------------
// Admin authentication
// ---------------------------------------------------------------------------

app.get('/api/admin/me', (req, res) => {
  const authenticated = adminIsAuthenticated(req, config);
  res.json({
    authenticated,
    companyName: config.companyName,
    timezone: config.timezone,
  });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !safeCompare(password, config.adminPassword)) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  req.session.adminAt = Date.now();
  res.json({ ok: true, companyName: config.companyName, timezone: config.timezone });
});

app.post('/api/admin/logout', (req, res) => {
  if (req.session) delete req.session.adminAt;
  res.json({ ok: true });
});

const adminOnly = requireAdmin(config);

// ---------------------------------------------------------------------------
// Admin dashboard data
// ---------------------------------------------------------------------------

app.get('/api/admin/overview', adminOnly, async (req, res) => {
  const today = todayISO(config.timezone);
  const date = String(req.query.date || today);
  try {
    assertDateString(date, 'date');
  } catch (error) {
    throw httpError(400, error.message);
  }

  const [employees, records, holiday, departments, pendingCountRow] = await Promise.all([
    db('employees').orderBy('name'),
    db('attendance as a')
      .join('employees as e', 'a.employee_id', 'e.id')
      .where('a.work_date', date)
      .select(
        'a.*',
        'e.name as employee_name',
        'e.email as employee_email',
        'e.department as employee_department',
        'e.active as employee_active',
      ),
    db('holidays').where({ date }).first(),
    db('departments').orderBy('name'),
    db('attendance').where({ approval_status: 'pending' }).count({ count: '*' }).first(),
  ]);

  const departmentMap = createDepartmentMap(departments);
  const workday = !holiday && config.workDays.includes(dayOfWeek(date));
  const recordByEmployee = new Map(records.map((record) => [record.employee_id, record]));

  const rows = [];
  for (const employee of employees) {
    const record = recordByEmployee.get(employee.id);
    if (!employee.active && !record) continue;

    const schedule = scheduleForEmployee(employee, departmentMap, config);
    const formatted = record
      ? formatRecord(record, config, { includeAudit: true, schedule })
      : null;
    let status;
    if (formatted) status = formatted.open ? 'WORKING' : 'COMPLETE';
    else status = workday ? 'NOT_IN' : 'OFF';

    rows.push({
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        department: employee.department || '',
        active: Boolean(employee.active),
      },
      schedule: publicSchedule(schedule),
      record: formatted,
      status,
      late: Boolean(formatted && formatted.late),
    });
  }

  rows.sort((a, b) =>
    a.employee.name.localeCompare(b.employee.name, undefined, { sensitivity: 'base' }),
  );

  const activeRows = rows.filter((row) => row.employee.active);
  const stats = {
    totalEmployees: employees.filter((employee) => employee.active).length,
    present: activeRows.filter((row) => row.record).length,
    late: activeRows.filter((row) => row.record && row.late).length,
    working: activeRows.filter((row) => row.status === 'WORKING').length,
    completed: activeRows.filter((row) => row.status === 'COMPLETE').length,
    notIn: workday ? activeRows.filter((row) => !row.record).length : 0,
  };

  res.json({
    date,
    dateLabel: formatDateLabel(date, 'long'),
    isToday: date === today,
    today,
    holiday: holiday ? holiday.name : null,
    workday,
    stats,
    pendingApprovals: Number(pendingCountRow && pendingCountRow.count) || 0,
    rows,
    timezone: config.timezone,
  });
});

app.get('/api/admin/range', adminOnly, async (req, res) => {
  const { from, to, today } = parseRange(req);
  const filters = parseReportFilters(req);
  const [records, departments] = await Promise.all([
    attendanceRecordsBetween(from, to, filters),
    db('departments').orderBy('name'),
  ]);
  const rows = buildRawRows(records, config, departments);
  res.json({
    from,
    to,
    fromLabel: formatDateLabel(from),
    toLabel: formatDateLabel(to),
    today,
    timezone: config.timezone,
    filters,
    rows,
    summary: summarizeRows(rows),
  });
});

async function reportMatrixFor(req) {
  const { from, to, today } = parseRange(req);
  const filters = parseReportFilters(req);
  const [records, departments, holidays] = await Promise.all([
    attendanceRecordsBetween(from, to, filters),
    db('departments').orderBy('name'),
    db('holidays').whereBetween('date', [from, to]),
  ]);
  const employeeIdsWithRecords = new Set(records.map((record) => record.employee_id));
  const employees = (await db('employees').orderBy('name'))
    .filter((employee) => employeeMatchesFilters(employee, filters))
    .filter((employee) => employee.active || employeeIdsWithRecords.has(employee.id));

  const matrix = buildMatrix({
    employees,
    records,
    holidays,
    departments,
    from,
    to,
    today,
    config,
  });

  return { matrix, from, to };
}

app.get('/api/admin/report.csv', adminOnly, async (req, res) => {
  const { matrix, from, to } = await reportMatrixFor(req);
  setCsvHeaders(res, csvFilename(config, 'attendance', from, to));
  res.send(matrixToCsv(matrix));
});

app.get('/api/admin/report.xlsx', adminOnly, async (req, res) => {
  const { matrix, from, to } = await reportMatrixFor(req);
  const buffer = await matrixToXlsx(matrix);
  setDownloadHeaders(
    res,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    reportFilename(config, 'attendance', from, to, 'xlsx'),
  );
  res.setHeader('Content-Length', buffer.length);
  res.send(Buffer.from(buffer));
});

app.get('/api/admin/raw.csv', adminOnly, async (req, res) => {
  const { from, to } = parseRange(req);
  const filters = parseReportFilters(req);
  const [records, departments] = await Promise.all([
    attendanceRecordsBetween(from, to, filters),
    db('departments').orderBy('name'),
  ]);
  const rows = buildRawRows(records, config, departments);
  setCsvHeaders(res, csvFilename(config, 'attendance_raw', from, to));
  res.send(rawRowsToCsv(rows));
});

app.post('/api/admin/attendance/:id/checkout', adminOnly, adminWriteLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid attendance record.');

  const time = String((req.body && req.body.time) || '');
  if (!isValidTime(time)) throw httpError(400, 'Enter a check-out time in HH:MM format.');

  const record = await db('attendance').where({ id }).first();
  if (!record) throw httpError(404, 'Attendance record not found.');
  if (record.check_out) throw httpError(409, 'This record already has a check-out time.');

  const [employee, departments] = await Promise.all([
    db('employees').where({ id: record.employee_id }).first(),
    db('departments').orderBy('name'),
  ]);
  const schedule = scheduleForEmployee(
    employee || {},
    createDepartmentMap(departments),
    config,
  );

  let checkOut;
  try {
    checkOut = localDateTimeToUtc(record.work_date, time, config.timezone);
  } catch (error) {
    throw httpError(400, error.message);
  }

  if (checkOut <= new Date(record.check_in)) {
    throw httpError(400, 'Check-out must be after the check-in time.');
  }
  if (checkOut.getTime() > Date.now() + 5 * 60 * 1000) {
    throw httpError(400, 'Check-out cannot be in the future.');
  }
  const minutes = minutesBetween(record.check_in, checkOut.toISOString());
  if (minutes !== null && minutes > 24 * 60) {
    throw httpError(400, 'A single shift cannot be longer than 24 hours.');
  }

  const nowIso = new Date().toISOString();
  await db('attendance').where({ id }).update({
    check_out: checkOut.toISOString(),
    check_out_distance: null,
    check_out_accuracy: null,
    check_out_ip: null,
    approval_status: 'approved',
    approved_at: nowIso,
    updated_at: nowIso,
  });

  const updated = await db('attendance').where({ id }).first();
  res.json({ ok: true, record: formatRecord(updated, config, { schedule }), minutes, hours: formatDuration(minutes) });
});

app.post('/api/admin/attendance/:id/approve', adminOnly, adminWriteLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid attendance record.');

  const record = await db('attendance').where({ id }).first();
  if (!record) throw httpError(404, 'Attendance record not found.');
  if (record.approval_status !== 'pending') {
    throw httpError(409, 'This record is not waiting for approval.');
  }

  const [employee, departments] = await Promise.all([
    db('employees').where({ id: record.employee_id }).first(),
    db('departments').orderBy('name'),
  ]);
  const fallbackSchedule = scheduleForEmployee(
    employee || {},
    createDepartmentMap(departments),
    config,
  );
  const schedule = scheduleForRecord(record, fallbackSchedule, config);
  const checkInDate = new Date(record.check_in);
  if (Number.isNaN(checkInDate.getTime())) {
    throw httpError(409, 'This record has an invalid check-in time.');
  }

  const requestedTime = String((req.body && req.body.time) || '').trim();
  let checkOutIso = record.check_out;

  if (requestedTime) {
    if (!isValidTime(requestedTime)) {
      throw httpError(400, 'Enter a check-out time in HH:MM format.');
    }

    let checkOutDate;
    try {
      checkOutDate = localDateTimeToUtc(record.work_date, requestedTime, config.timezone);
      const overnight =
        minutesOfDay(schedule.workEnd) <= minutesOfDay(schedule.workStart);
      if (overnight && checkOutDate.getTime() <= checkInDate.getTime()) {
        checkOutDate = localDateTimeToUtc(
          addDays(record.work_date, 1),
          requestedTime,
          config.timezone,
        );
      }
    } catch (error) {
      throw httpError(400, error.message);
    }

    if (checkOutDate.getTime() <= checkInDate.getTime()) {
      throw httpError(400, 'Check-out must be after the check-in time.');
    }
    const editedMinutes = minutesBetween(record.check_in, checkOutDate.toISOString());
    if (editedMinutes !== null && editedMinutes > 24 * 60) {
      throw httpError(400, 'A single shift cannot be longer than 24 hours.');
    }
    checkOutIso = checkOutDate.toISOString();
  }

  if (!checkOutIso) throw httpError(400, 'Add a check-out time before approving.');

  const nowIso = new Date().toISOString();
  const affected = await db('attendance')
    .where({ id, approval_status: 'pending' })
    .update({
      check_out: checkOutIso,
      approval_status: 'approved',
      approved_at: nowIso,
      updated_at: nowIso,
    });
  if (!affected) throw httpError(409, 'This record was already approved. Refresh the report.');

  const updated = await db('attendance').where({ id }).first();
  const minutes = minutesBetween(updated.check_in, updated.check_out);
  res.json({
    ok: true,
    record: formatRecord(updated, config, { includeAudit: true, schedule }),
    minutes,
    hours: formatDuration(minutes),
  });
});

// ---------------------------------------------------------------------------
// Employee management
// ---------------------------------------------------------------------------

app.get('/api/admin/employees', adminOnly, async (req, res) => {
  const employees = await db('employees').orderBy('name');
  res.json({
    employees: employees.map((employee) => ({
      ...publicEmployee(employee),
      active: Boolean(employee.active),
      createdAt: employee.created_at,
    })),
  });
});

app.post('/api/admin/employees', adminOnly, adminWriteLimiter, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const department = await canonicalDepartmentName(req.body && req.body.department);

  if (!name || name.length > 255) throw httpError(400, 'Enter the employee name (1–255 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw httpError(400, 'Enter a valid email address.');
  }

  const existing = await db('employees').where({ email }).first();
  if (existing) throw httpError(409, 'An employee with that email already exists.');

  const now = new Date().toISOString();
  try {
    await db('employees').insert({
      email,
      name,
      department,
      active: true,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (uniqueViolation(error)) throw httpError(409, 'An employee with that email already exists.');
    throw error;
  }

  const employee = await db('employees').where({ email }).first();
  res.status(201).json({
    employee: {
      ...publicEmployee(employee),
      active: Boolean(employee.active),
      createdAt: employee.created_at,
    },
  });
});

app.patch('/api/admin/employees/:id', adminOnly, adminWriteLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid employee.');

  const employee = await db('employees').where({ id }).first();
  if (!employee) throw httpError(404, 'Employee not found.');

  const updates = {};
  if (req.body && req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 255) throw httpError(400, 'Enter the employee name (1–255 characters).');
    updates.name = name;
  }
  if (req.body && req.body.department !== undefined) {
    updates.department = await canonicalDepartmentName(req.body.department);
  }
  if (req.body && req.body.active !== undefined) {
    updates.active = Boolean(req.body.active);
  }
  if (!Object.keys(updates).length) throw httpError(400, 'Nothing to update.');

  updates.updated_at = new Date().toISOString();
  await db('employees').where({ id }).update(updates);
  const updated = await db('employees').where({ id }).first();

  res.json({
    employee: {
      ...publicEmployee(updated),
      active: Boolean(updated.active),
      createdAt: updated.created_at,
    },
  });
});

// ---------------------------------------------------------------------------
// Departments and shifts
// ---------------------------------------------------------------------------

function readFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  throw httpError(400, 'Night Body Wash setting must be true or false.');
}

function readDepartmentFields(body, { partial = false } = {}) {
  const input = body || {};
  const fields = {};

  if (!partial || input.name !== undefined) {
    const name = String(input.name || '').trim().slice(0, 120);
    if (!name) throw httpError(400, 'Enter a department name (1–120 characters).');
    fields.name = name;
  }
  if (!partial || input.workStart !== undefined) {
    const workStart = String(input.workStart || config.workStart).trim();
    if (!isValidTime(workStart)) {
      throw httpError(400, 'Enter a shift start time in HH:MM format.');
    }
    fields.work_start = workStart;
  }
  if (!partial || input.workEnd !== undefined) {
    const workEnd = String(input.workEnd || config.workEnd).trim();
    if (!isValidTime(workEnd)) {
      throw httpError(400, 'Enter a shift end time in HH:MM format.');
    }
    fields.work_end = workEnd;
  }
  if (!partial || input.graceMinutes !== undefined) {
    const rawGrace =
      input.graceMinutes === undefined ||
      input.graceMinutes === null ||
      input.graceMinutes === ''
        ? config.graceMinutes
        : input.graceMinutes;
    const graceMinutes = Number(rawGrace);
    if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 240) {
      throw httpError(400, 'Grace minutes must be a whole number between 0 and 240.');
    }
    fields.grace_minutes = graceMinutes;
  }
  if (!partial || input.nightBodyWash !== undefined) {
    fields.night_body_wash = readFlag(input.nightBodyWash, false);
  }

  if (!Object.keys(fields).length) throw httpError(400, 'Nothing to update.');
  return fields;
}

async function employeeCountsByDepartment() {
  const rows = await db('employees')
    .whereNot('department', '')
    .select('department')
    .count('* as count')
    .groupBy('department');
  const counts = new Map();
  for (const row of rows) {
    counts.set(String(row.department).trim().toLowerCase(), Number(row.count));
  }
  return counts;
}

async function departmentsPayload() {
  const [departments, counts] = await Promise.all([
    db('departments').orderBy('name'),
    employeeCountsByDepartment(),
  ]);
  return {
    departments: departments.map((department) =>
      publicDepartment(department, counts.get(department.name.toLowerCase()) || 0),
    ),
    defaultSchedule: {
      workStart: config.workStart,
      workEnd: config.workEnd,
      graceMinutes: config.graceMinutes,
    },
  };
}

app.get('/api/admin/departments', adminOnly, async (req, res) => {
  res.json(await departmentsPayload());
});

app.post('/api/admin/departments', adminOnly, adminWriteLimiter, async (req, res) => {
  const fields = readDepartmentFields(req.body);

  const duplicate = await db('departments')
    .whereRaw('lower(name) = ?', [fields.name.toLowerCase()])
    .first();
  if (duplicate) throw httpError(409, 'A department with that name already exists.');

  const now = new Date().toISOString();
  try {
    await db('departments').insert({
      ...fields,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (uniqueViolation(error)) {
      throw httpError(409, 'A department with that name already exists.');
    }
    throw error;
  }

  const department = await db('departments').where({ name: fields.name }).first();
  res.status(201).json({ department: publicDepartment(department) });
});

app.patch('/api/admin/departments/:id', adminOnly, adminWriteLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid department.');

  const existing = await db('departments').where({ id }).first();
  if (!existing) throw httpError(404, 'Department not found.');

  const fields = readDepartmentFields(req.body, { partial: true });

  if (fields.name) {
    const duplicate = await db('departments')
      .whereRaw('lower(name) = ?', [fields.name.toLowerCase()])
      .whereNot('id', id)
      .first();
    if (duplicate) throw httpError(409, 'A department with that name already exists.');
  }

  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    await trx('departments').where({ id }).update({ ...fields, updated_at: now });
    if (fields.name && fields.name !== existing.name) {
      await trx('employees')
        .whereRaw('lower(department) = ?', [existing.name.toLowerCase()])
        .update({ department: fields.name, updated_at: now });
    }
  });

  const updated = await db('departments').where({ id }).first();
  res.json({ department: publicDepartment(updated) });
});

app.delete('/api/admin/departments/:id', adminOnly, adminWriteLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid department.');

  const department = await db('departments').where({ id }).first();
  if (!department) throw httpError(404, 'Department not found.');

  const employeeCount = await db('employees')
    .whereRaw('lower(department) = ?', [department.name.toLowerCase()])
    .count('* as count')
    .first();
  if (Number(employeeCount.count) > 0) {
    throw httpError(409, 'Reassign the employees in this department before deleting it.');
  }

  await db('departments').where({ id }).del();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

app.get('/api/admin/holidays', adminOnly, async (req, res) => {
  const holidays = await db('holidays').orderBy('date', 'asc');
  res.json({ holidays });
});

app.post('/api/admin/holidays', adminOnly, adminWriteLimiter, async (req, res) => {
  const date = String((req.body && req.body.date) || '');
  const name = String((req.body && req.body.name) || '').trim().slice(0, 120) || 'Holiday';
  try {
    assertDateString(date, 'holiday date');
  } catch (error) {
    throw httpError(400, error.message);
  }

  await db('holidays')
    .insert({ date, name, created_at: new Date().toISOString() })
    .onConflict('date')
    .merge({ name });

  const holidays = await db('holidays').orderBy('date', 'asc');
  res.json({ ok: true, holidays });
});

app.delete('/api/admin/holidays/:id', adminOnly, adminWriteLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid holiday.');
  const deleted = await db('holidays').where({ id }).del();
  if (!deleted) throw httpError(404, 'Holiday not found.');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Pages and static assets
// ---------------------------------------------------------------------------

const publicDir = path.join(__dirname, 'public');

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.use(
  express.static(publicDir, {
    index: false,
    etag: true,
    maxAge: config.isProduction ? '1h' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }),
);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.status(404).type('html').send(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found</title>' +
      '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
      '<h1>404</h1><p>That page does not exist.</p><p><a href="/">Employee check-in</a> · <a href="/admin">Admin</a></p></body></html>',
  );
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  let status = Number(error.statusCode || error.status) || 500;
  let message = error.message || 'Something went wrong.';

  if (error.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON request body.';
  }
  if (status >= 500) {
    console.error(`${req.method} ${req.path} failed:`, error);
    message = 'Something went wrong on the server. Please try again.';
  }

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }
  res.status(status).type('text').send(message);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function syncDepartmentsFromEmployees() {
  const rows = await db('employees').whereNot('department', '').distinct('department');
  for (const row of rows) {
    const name = String(row.department || '').trim();
    if (!name) continue;
    const existing = await db('departments')
      .whereRaw('lower(name) = ?', [name.toLowerCase()])
      .first();
    if (existing) continue;

    const now = new Date().toISOString();
    await db('departments').insert({
      name,
      work_start: config.workStart,
      work_end: config.workEnd,
      grace_minutes: config.graceMinutes,
      created_at: now,
      updated_at: now,
    });
  }
}

async function start() {
  await migrate(db);
  const seededDepartments = await seedDefaultDepartments(db);
  if (seededDepartments) {
    console.log(`[attendance] Seeded ${seededDepartments} standard departments.`);
  }
  await syncDepartmentsFromEmployees();

  const server = app.listen(config.port, () => {
    for (const warning of config.warnings) console.warn(`[attendance] WARNING: ${warning}`);
    console.log(`[attendance] ${config.companyName}`);
    console.log(`[attendance] Listening on http://localhost:${config.port}`);
    console.log(
      `[attendance] Database: ${isPostgres ? 'PostgreSQL' : `SQLite (${config.sqlitePath})`}`,
    );
    console.log(
      `[attendance] Timezone: ${config.timezone} · Default shift: ${config.workStart}–${config.workEnd}`,
    );
    if (!config.googleConfigured) {
      console.warn('[attendance] Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID.');
    }
    if (!config.geofenceConfigured) {
      console.warn('[attendance] Office coordinates are missing. Check-in is disabled.');
    }
  });

  const shutdown = (signal) => {
    console.log(`[attendance] ${signal} received, shutting down.`);
    server.close(async () => {
      try {
        await db.destroy();
      } finally {
        process.exit(0);
      }
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[attendance] Failed to start:', error);
    process.exit(1);
  });
}

module.exports = { app, start, config, db };
