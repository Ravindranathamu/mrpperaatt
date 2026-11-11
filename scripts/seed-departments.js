'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { createDatabase, migrate } = require('../src/db');
const { DEFAULT_DEPARTMENTS } = require('../src/default-departments');

async function main() {
  const config = loadConfig();
  const db = createDatabase(config);

  try {
    await migrate(db);
    for (const department of DEFAULT_DEPARTMENTS) {
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
