'use strict';

const path = require('path');

const WEAK_ADMIN_PASSWORDS = new Set([
  'admin',
  'admin123',
  'admin12345',
  'password',
  'password123',
  'change-me',
  'changeme',
  'change_me',
]);

function parseInteger(value, fallback, min, max, name, warnings) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    warnings.push(`${name} must be an integer between ${min} and ${max}; using ${fallback}.`);
    return fallback;
  }
  return number;
}

function parseNumber(value, fallback, min, max, name, warnings) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    warnings.push(`${name} must be a number between ${min} and ${max}; using ${fallback}.`);
    return fallback;
  }
  return number;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidTime(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return false;
  return true;
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function loadConfig(env = process.env) {
  const warnings = [];
  const isProduction = String(env.NODE_ENV || 'development') === 'production';

  const rawClientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const googleClientId =
    rawClientId && !rawClientId.includes('CHANGE_ME') ? rawClientId : '';

  let adminPassword = String(env.ADMIN_PASSWORD || '');
  if (!adminPassword) {
    if (isProduction) {
      throw new Error('ADMIN_PASSWORD is required in production.');
    }
    adminPassword = 'admin12345';
    warnings.push('ADMIN_PASSWORD is not set. Using the local development password "admin12345".');
  }

  let sessionSecret = String(env.SESSION_SECRET || '');
  if (!sessionSecret) {
    if (isProduction) {
      throw new Error('SESSION_SECRET is required in production.');
    }
    sessionSecret = 'local-development-session-secret-do-not-deploy-this-value';
    warnings.push('SESSION_SECRET is not set. Sessions will use an insecure development value.');
  }

  if (isProduction) {
    if (
      adminPassword.length < 10 ||
      WEAK_ADMIN_PASSWORDS.has(adminPassword.toLowerCase()) ||
      adminPassword.includes('CHANGE_ME')
    ) {
      throw new Error('ADMIN_PASSWORD is too weak. Use at least 10 characters and no placeholder text.');
    }
    if (
      sessionSecret.length < 32 ||
      sessionSecret.includes('CHANGE_ME') ||
      sessionSecret.includes('local-development')
    ) {
      throw new Error('SESSION_SECRET is too weak. Generate at least 32 random characters.');
    }
    if (!googleClientId) {
      warnings.push('GOOGLE_CLIENT_ID is not configured. Employee Google sign-in will not work.');
    }
  }

  const timezone = String(env.TIMEZONE || 'Asia/Colombo').trim();
  if (!isValidTimeZone(timezone)) {
    throw new Error(`Invalid TIMEZONE "${timezone}". Use an IANA name such as Asia/Colombo.`);
  }

  const workStart = String(env.WORK_START || '07:00').trim();
  if (!isValidTime(workStart)) {
    throw new Error(`Invalid WORK_START "${workStart}". Use HH:MM in 24-hour time.`);
  }

  const workEnd = String(env.WORK_END || '16:00').trim();
  if (!isValidTime(workEnd)) {
    throw new Error(`Invalid WORK_END "${workEnd}". Use HH:MM in 24-hour time.`);
  }

  const nightShiftStart = String(env.NIGHT_SHIFT_START || '16:00').trim();
  if (!isValidTime(nightShiftStart)) {
    throw new Error(`Invalid NIGHT_SHIFT_START "${nightShiftStart}". Use HH:MM in 24-hour time.`);
  }

  let workDays = parseList(env.WORK_DAYS).map(Number);
  if (!workDays.length) workDays = [1, 2, 3, 4, 5];
  if (workDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    warnings.push('WORK_DAYS must contain numbers 1–7 (Monday=1). Using Monday–Friday.');
    workDays = [1, 2, 3, 4, 5];
  }
  workDays = [...new Set(workDays)].sort();

  const officeLat = env.OFFICE_LAT === undefined || String(env.OFFICE_LAT).trim() === ''
    ? Number.NaN
    : Number(env.OFFICE_LAT);
  const officeLng = env.OFFICE_LNG === undefined || String(env.OFFICE_LNG).trim() === ''
    ? Number.NaN
    : Number(env.OFFICE_LNG);

  const geofenceConfigured =
    Number.isFinite(officeLat) &&
    Number.isFinite(officeLng) &&
    officeLat >= -90 &&
    officeLat <= 90 &&
    officeLng >= -180 &&
    officeLng <= 180;

  if (!geofenceConfigured) {
    warnings.push('OFFICE_LAT/OFFICE_LNG are missing or invalid. Employee check-in will be disabled.');
  }

  const allowedRadiusMeters = parseNumber(
    env.ALLOWED_RADIUS_METERS,
    75,
    10,
    50000,
    'ALLOWED_RADIUS_METERS',
    warnings,
  );
  if (allowedRadiusMeters > 300) {
    warnings.push(
      `ALLOWED_RADIUS_METERS is ${allowedRadiusMeters}m. This is very generous; use 50–150m in production.`,
    );
  }

  const maxGpsAccuracyMeters = parseNumber(
    env.MAX_GPS_ACCURACY_METERS,
    250,
    10,
    5000,
    'MAX_GPS_ACCURACY_METERS',
    warnings,
  );

  const allowedEmailDomains = parseList(env.ALLOWED_EMAIL_DOMAINS).map((domain) =>
    domain.toLowerCase().replace(/^@/, ''),
  );

  const allowSelfRegistration = parseBoolean(env.ALLOW_SELF_REGISTRATION, true);

  if (isProduction && allowSelfRegistration && !allowedEmailDomains.length) {
    warnings.push(
      'ALLOW_SELF_REGISTRATION is on and ALLOWED_EMAIL_DOMAINS is empty. Any verified Google user who scans the QR can register. Set your company domain or add employees manually.',
    );
  }

  const sqlitePath = path.resolve(
    __dirname,
    '..',
    String(env.SQLITE_PATH || path.join('data', 'attendance.db')),
  );

  const companyName = String(env.COMPANY_NAME || 'My Company').trim() || 'My Company';
  const branchName = String(env.BRANCH_NAME || '').trim().slice(0, 80);
  const copyrightName = String(env.COPYRIGHT_NAME || companyName).trim() || companyName;
  const contactPhone = String(env.CONTACT_PHONE || '').trim();
  const contactEmail = String(env.CONTACT_EMAIL || '').trim();

  return {
    nodeEnv: String(env.NODE_ENV || 'development'),
    isProduction,
    port: parseInteger(env.PORT, 3000, 1, 65535, 'PORT', warnings),
    companyName,
    branchName,
    copyrightName,
    contactPhone,
    contactEmail,
    timezone,
    googleClientId,
    googleConfigured: Boolean(googleClientId),
    adminPassword,
    sessionSecret,
    databaseUrl: String(env.DATABASE_URL || '').trim(),
    databaseSsl: parseBoolean(env.DATABASE_SSL, true),
    sqlitePath,
    officeLat,
    officeLng,
    geofenceConfigured,
    allowedRadiusMeters,
    maxGpsAccuracyMeters,
    workStart,
    workEnd,
    nightShiftStart,
    graceMinutes: parseInteger(env.GRACE_MINUTES, 10, 0, 240, 'GRACE_MINUTES', warnings),
    workDays,
    punchCooldownSeconds: parseInteger(
      env.PUNCH_COOLDOWN_SECONDS,
      45,
      0,
      3600,
      'PUNCH_COOLDOWN_SECONDS',
      warnings,
    ),
    openShiftHours: parseInteger(
      env.OPEN_SHIFT_HOURS,
      20,
      4,
      72,
      'OPEN_SHIFT_HOURS',
      warnings,
    ),
    allowSelfRegistration,
    allowedEmailDomains,
    adminSessionMs: 12 * 60 * 60 * 1000,
    employeeSessionMs: 30 * 24 * 60 * 60 * 1000,
    reportMaxDays: 366,
    warnings,
  };
}

module.exports = {
  loadConfig,
  isValidTime,
  isValidTimeZone,
  WEAK_ADMIN_PASSWORDS,
};
