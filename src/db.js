'use strict';

const fs = require('fs');
const path = require('path');
const knex = require('knex');
const { DEFAULT_DEPARTMENTS } = require('./default-departments');

function postgresConnection(config) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL.');
  const url = new URL(config.databaseUrl);
  // node-postgres does not understand libpq's sslmode/channel_binding query
  // parameters. SSL is applied explicitly below, and channel binding is not
  // supported by the pg driver, so strip both before connecting.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('ssl');
  url.searchParams.delete('channel_binding');
  const connection = { connectionString: url.toString() };
  if (config.databaseSsl) {
    connection.ssl = { rejectUnauthorized: true };
  }
  return connection;
}

function createDatabase(config) {
  if (config.databaseUrl) {
    return knex({
      client: 'pg',
      connection: postgresConnection(config),
      pool: { min: 0, max: 5, acquireTimeoutMillis: 15000 },
    });
  }

  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  return knex({
    client: 'better-sqlite3',
    connection: { filename: config.sqlitePath },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
}

async function migrate(db) {
  const hasEmployees = await db.schema.hasTable('employees');
  if (!hasEmployees) {
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('email', 255).notNullable().unique();
      table.string('name', 255).notNullable();
      table.string('department', 120).notNullable().defaultTo('');
      table.boolean('active').notNullable().defaultTo(true);
      table.string('created_at', 40).notNullable();
      table.string('updated_at', 40).notNullable();
    });
  }

  const hasAttendance = await db.schema.hasTable('attendance');
  if (!hasAttendance) {
    await db.schema.createTable('attendance', (table) => {
      table.increments('id').primary();
      table
        .integer('employee_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('employees')
        .onDelete('CASCADE');
      table.string('work_date', 10).notNullable();
      table.string('check_in', 40).notNullable();
      table.string('check_out', 40).nullable();
      table.double('check_in_distance').nullable();
      table.double('check_out_distance').nullable();
      table.double('check_in_accuracy').nullable();
      table.double('check_out_accuracy').nullable();
      table.string('check_in_ip', 64).nullable();
      table.string('check_out_ip', 64).nullable();
      // Shift snapshot taken when the employee checks in.
      table.string('shift_start', 5).nullable();
      table.string('shift_end', 5).nullable();
      table.integer('grace_minutes').nullable();
      table.boolean('night_body_wash').nullable();
      // Autofix workflow for a rejected out-of-geofence checkout.
      table.string('approval_status', 20).notNullable().defaultTo('approved');
      table.string('approved_at', 40).nullable();
      table.boolean('auto_closed').notNullable().defaultTo(false);
      table.string('created_at', 40).notNullable();
      table.string('updated_at', 40).notNullable();
      table.unique(['employee_id', 'work_date']);
      table.index(['work_date'], 'attendance_work_date_index');
    });
  } else {
    // Existing databases predate department shifts. Nullable snapshots keep
    // those older records readable while new check-ins capture their schedule.
    const attendanceColumns = [
      ['shift_start', (table) => table.string('shift_start', 5).nullable()],
      ['shift_end', (table) => table.string('shift_end', 5).nullable()],
      ['grace_minutes', (table) => table.integer('grace_minutes').nullable()],
      ['night_body_wash', (table) => table.boolean('night_body_wash').nullable()],
      [
        'approval_status',
        (table) => table.string('approval_status', 20).notNullable().defaultTo('approved'),
      ],
      ['approved_at', (table) => table.string('approved_at', 40).nullable()],
      ['auto_closed', (table) => table.boolean('auto_closed').notNullable().defaultTo(false)],
    ];
    for (const [column, define] of attendanceColumns) {
      if (!(await db.schema.hasColumn('attendance', column))) {
        await db.schema.alterTable('attendance', define);
      }
    }
  }

  const hasDepartments = await db.schema.hasTable('departments');
  if (!hasDepartments) {
    await db.schema.createTable('departments', (table) => {
      table.increments('id').primary();
      table.string('name', 120).notNullable().unique();
      table.string('work_start', 5).notNullable();
      table.string('work_end', 5).notNullable();
      table.integer('grace_minutes').notNullable().defaultTo(10);
      // Eligible departments label evening time as Night Body Wash. Other
      // departments label time after their scheduled finish as overtime.
      table.boolean('night_body_wash').notNullable().defaultTo(false);
      table.string('created_at', 40).notNullable();
      table.string('updated_at', 40).notNullable();
    });
  } else if (!(await db.schema.hasColumn('departments', 'night_body_wash'))) {
    await db.schema.alterTable('departments', (table) => {
      table.boolean('night_body_wash').notNullable().defaultTo(false);
    });
  }

  const hasHolidays = await db.schema.hasTable('holidays');
  if (!hasHolidays) {
    await db.schema.createTable('holidays', (table) => {
      table.increments('id').primary();
      table.string('date', 10).notNullable().unique();
      table.string('name', 120).notNullable();
      table.string('created_at', 40).notNullable();
    });
  }
}

/**
 * A brand-new database has no departments. Seed the nine standard ones once so
 * the first admin visit already has the right shifts and evening rules. An
 * existing department list is never modified; the admin can edit every time.
 */
async function seedDefaultDepartments(db) {
  const row = await db('departments').count({ count: '*' }).first();
  if (Number(row && row.count) > 0) return 0;

  const now = new Date().toISOString();
  await db('departments')
    .insert(
      DEFAULT_DEPARTMENTS.map((department) => ({
        ...department,
        created_at: now,
        updated_at: now,
      })),
    )
    .onConflict('name')
    .ignore();

  return DEFAULT_DEPARTMENTS.length;
}

async function healthCheck(db) {
  await db.raw('select 1 as ok');
  return true;
}

module.exports = {
  createDatabase,
  migrate,
  seedDefaultDepartments,
  healthCheck,
};
