'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { createDatabase, migrate } = require('../src/db');

// Times other than Night Body Wash are editable defaults. Only Service,
// Day Body Wash, Clean Park, and Night Body Wash earn Night Body Wash hours;
// the Workshop and Paint departments earn overtime after their shift finish.
const DEPARTMENTS = [
  { name: 'Service', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: true },
  { name: 'Day Body Wash', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: true },
  { name: 'Clean Park', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: true },
  { name: 'Night Body Wash', work_start: '16:00', work_end: '21:00', grace_minutes: 10, night_body_wash: true },
  { name: 'Workshop 1', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  { name: 'Workshop 2', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  { name: 'Paint A', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  { name: 'Paint B', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
  { name: 'Paint C', work_start: '07:00', work_end: '16:00', grace_minutes: 10, night_body_wash: false },
];

async function main() {
  const config = loadConfig();
  const db = createDatabase(config);

  try {
    await migrate(db);
    for (const department of DEPARTMENTS) {
      const existing = await db('departments')
        .whereRaw('lower(name) = ?', [department.name.toLowerCase()])
        .first();

      const now = new Date().toISOString();

      if (existing) {
        if (Boolean(existing.night_body_wash) !== department.night_body_wash) {
          await db('departments')
            .where({ id: existing.id })
            .update({ night_body_wash: department.night_body_wash, updated_at: now });
          console.log(
            `Updated: ${existing.name} evening rule is now ` +
              `${department.night_body_wash ? 'Night Body Wash' : 'Overtime'}.`,
          );
        } else {
          console.log(
            `Exists:  ${existing.name} (${existing.work_start}–${existing.work_end}). ` +
              'Times were not changed.',
          );
        }
        continue;
      }

      await db('departments').insert({
        ...department,
        created_at: now,
        updated_at: now,
      });
      console.log(
        `Created: ${department.name} (${department.work_start}–${department.work_end}, ` +
          `${department.night_body_wash ? 'Night Body Wash' : 'Overtime'}).`,
      );
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(`Could not set up departments: ${error.message}`);
  process.exit(1);
});
