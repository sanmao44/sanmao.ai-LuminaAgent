#!/usr/bin/env node
import { createTsRequire } from '../tests/ts-require.mjs';
import { randomUUID } from 'node:crypto';

const migration = createTsRequire(process.cwd())('./lib/database/migration');
const runtime = createTsRequire(process.cwd())('./lib/runtime-operation');
const observability = createTsRequire(process.cwd())('./packages/contracts/observability');
const runtimeObserver = new observability.BufferedRuntimeObserver(64);
const command = process.argv[2] || 'migrate';
const guarded = !process.argv.includes('--no-runtime-guard');
if (command === 'rollback') {
  const operationId = `database-rollback-${randomUUID()}`;
  if (guarded) {
    const drain = await runtime.beginRuntimeDrain(operationId);
    if (!drain) throw new Error('无法开始运行时 drain；请先停止应用后再执行数据库 rollback');
    const idle = await runtime.waitForRuntimeIdle();
    if (idle.activeRequests > 0) {
      await runtime.cancelRuntimeDrain(operationId);
      throw new Error('应用仍有进行中的请求，数据库 rollback 已取消');
    }
  }
  try {
    console.log(JSON.stringify(await migration.rollbackSqliteMigration(undefined, runtimeObserver), null, 2));
    if (guarded) console.error('Database rollback completed. Restart the application before reopening writes.');
  } catch (error) {
    if (guarded) await runtime.cancelRuntimeDrain(operationId);
    throw error;
  }
} else {
  const failAfter = process.argv.find((value) => value.startsWith('--fail-after='))?.split('=', 2)[1];
  const operationId = `database-migration-${randomUUID()}`;
  if (guarded) {
    const drain = await runtime.beginRuntimeDrain(operationId);
    if (!drain) throw new Error('无法开始运行时 drain；请先停止应用后再执行数据库迁移');
    const idle = await runtime.waitForRuntimeIdle();
    if (idle.activeRequests > 0) {
      await runtime.cancelRuntimeDrain(operationId);
      throw new Error('应用仍有进行中的请求，数据库迁移已取消');
    }
  }
  try {
    console.log(JSON.stringify(await migration.migrateLegacyStorageToSqlite({ ...(failAfter ? { failAfter } : {}), observer: runtimeObserver }), null, 2));
    if (guarded) console.error('Database cutover activated. Restart the application before reopening writes.');
  } catch (error) {
    if (guarded) await runtime.cancelRuntimeDrain(operationId);
    throw error;
  }
}
