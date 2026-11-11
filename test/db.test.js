'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDatabase, migrate, seedDefaultDepartments } = require('../src/db');

test('a new database is seeded with the nine standard departments', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-db-'));
  const sqlitePath = path.join(directory, 'test.db');
  const db = createDatabase({ sqlitePath });

  try {
    await migrate(db);

    const inserted = await seedDefaultDepartments(db);
    assert.equal(inserted, 9);

    const departments = await db('departments').orderBy('name');
    assert.equal(departments.length, 9);

    const byName = new Map(departments.map((department) => [department.name, department]));
    assert.equal(byName.get('Night Body Wash').work_start, '16:00');
    assert.equal(byName.get('Night Body Wash').work_end, '21:00');
    assert.equal(Boolean(byName.get('Night Body Wash').night_body_wash), true);
    assert.equal(Boolean(byName.get('Service').night_body_wash), true);
    assert.equal(Boolean(byName.get('Clean Park').night_body_wash), true);
    assert.equal(Boolean(byName.get('Workshop 1').night_body_wash), false);
    assert.equal(Boolean(byName.get('Paint C').night_body_wash), false);

    // A second boot must not duplicate or overwrite the admin's departments.
    const secondRun = await seedDefaultDepartments(db);
    assert.equal(secondRun, 0);
    const count = await db('departments').count({ count: '*' }).first();
    assert.equal(Number(count.count), 9);
  } finally {
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
