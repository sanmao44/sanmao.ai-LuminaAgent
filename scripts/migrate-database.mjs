#!/usr/bin/env node
import { createTsRequire } from '../tests/ts-require.mjs';

const migration = createTsRequire(process.cwd())('./lib/database/migration');
const command = process.argv[2] || 'migrate';
if (command === 'rollback') {
  console.log(JSON.stringify(await migration.rollbackSqliteMigration(), null, 2));
} else {
  const failAfter = process.argv.find((value) => value.startsWith('--fail-after='))?.split('=', 2)[1];
  console.log(JSON.stringify(await migration.migrateLegacyStorageToSqlite(failAfter ? { failAfter } : {}), null, 2));
}
