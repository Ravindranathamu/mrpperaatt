'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');

const strongProductionEnv = {
  NODE_ENV: 'production',
  ADMIN_PASSWORD: 'A-strong-unique-admin-password-42',
  SESSION_SECRET: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: '1234567890-demo.apps.googleusercontent.com',
  ALLOWED_EMAIL_DOMAINS: 'example.com',
};

test('production refuses a weak or placeholder admin password', () => {
  for (const password of ['admin12345', 'password123', 'CHANGE_ME_Admin_Password_123!', 'short']) {
    assert.throws(
      () => loadConfig({ ...strongProductionEnv, ADMIN_PASSWORD: password }),
      /ADMIN_PASSWORD is too weak/,
      `expected password ${JSON.stringify(password)} to be rejected`,
    );
  }
});

test('production refuses a missing or short session secret', () => {
  for (const secret of ['', 'too-short', 'local-development-session-secret-do-not-deploy-this-value']) {
    assert.throws(
      () => loadConfig({ ...strongProductionEnv, SESSION_SECRET: secret }),
      /SESSION_SECRET is too weak|SESSION_SECRET is required/,
    );
  }
});

test('production refuses an invalid timezone', () => {
  assert.throws(
    () => loadConfig({ ...strongProductionEnv, TIMEZONE: 'Colombo' }),
    /Invalid TIMEZONE/,
  );
});

test('work shift times must use 24-hour HH:MM', () => {
  assert.throws(
    () => loadConfig({ ...strongProductionEnv, WORK_END: '5pm' }),
    /Invalid WORK_END/,
  );
  assert.throws(
    () => loadConfig({ ...strongProductionEnv, WORK_START: '25:00' }),
    /Invalid WORK_START/,
  );
  assert.throws(
    () => loadConfig({ ...strongProductionEnv, NIGHT_SHIFT_START: '4pm' }),
    /Invalid NIGHT_SHIFT_START/,
  );
});

test('a fully configured production environment loads safely', () => {
  const config = loadConfig(strongProductionEnv);
  assert.equal(config.isProduction, true);
  assert.equal(config.googleConfigured, true);
  assert.equal(config.timezone, 'Asia/Colombo');
  assert.equal(config.workStart, '07:00');
  assert.equal(config.workEnd, '16:00');
  assert.equal(config.nightShiftStart, '16:00');
  assert.equal(config.geofenceConfigured, false);
  assert.ok(config.warnings.some((warning) => warning.includes('OFFICE_LAT')));
  assert.equal(config.adminSessionMs, 12 * 60 * 60 * 1000);
  assert.equal(config.employeeSessionMs, 30 * 24 * 60 * 60 * 1000);
});

test('development defaults still allow a quick local start with warnings', () => {
  const config = loadConfig({ NODE_ENV: 'development' });
  assert.equal(config.isProduction, false);
  assert.equal(config.adminPassword, 'admin12345');
  assert.ok(config.warnings.some((warning) => warning.includes('ADMIN_PASSWORD')));
  assert.ok(config.warnings.some((warning) => warning.includes('SESSION_SECRET')));
});

test('copyright name and contact details are configurable', () => {
  const config = loadConfig({
    ...strongProductionEnv,
    COMPANY_NAME: 'Mr Paint Srilanka',
    BRANCH_NAME: 'Peradeniya',
    COPYRIGHT_NAME: 'RavSOFT',
    CONTACT_PHONE: '+94755756803',
    CONTACT_EMAIL: 'ravindranath@hotmail.co.uk',
  });
  assert.equal(config.companyName, 'Mr Paint Srilanka');
  assert.equal(config.branchName, 'Peradeniya');
  assert.equal(config.copyrightName, 'RavSOFT');
  assert.equal(config.contactPhone, '+94755756803');
  assert.equal(config.contactEmail, 'ravindranath@hotmail.co.uk');

  const fallback = loadConfig({ ...strongProductionEnv, COMPANY_NAME: 'Acme' });
  assert.equal(fallback.branchName, '');
  assert.equal(fallback.copyrightName, 'Acme');
  assert.equal(fallback.contactPhone, '');
  assert.equal(fallback.contactEmail, '');
});
