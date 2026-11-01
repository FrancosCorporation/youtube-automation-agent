'use strict';

const path = require('node:path');
const { applyVisualStandardMigration } = require('../utils/visual-standard-migration');

async function main() {
  const databasePath = process.env.YOUTUBE_AUTOMATION_DB_PATH
    ? path.resolve(process.env.YOUTUBE_AUTOMATION_DB_PATH)
    : path.join(__dirname, '..', 'data', 'youtube_automation.db');
  const result = await applyVisualStandardMigration(databasePath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`Visual standard migration failed: ${error.message}\n`);
  process.exitCode = 1;
});
