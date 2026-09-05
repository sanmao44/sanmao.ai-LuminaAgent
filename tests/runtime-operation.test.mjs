import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('browser lifecycle never stops the launcher when a page disappears', () => {
  const source = read('components/LocalLifecycle.tsx');
  assert.doesNotMatch(source, /addEventListener\(["']pagehide|sendBeacon|event:\s*["'](?:close|stop)["']/);
  assert.match(source, /heartbeat lease expires naturally/);
});

test('launchers only clear dead operation locks after the safety age', () => {
  const windowsCommon = read('scripts/launcher-common.ps1');
  const unixCommon = read('scripts/launcher-common.sh');
  assert.match(windowsCommon, /Test-SanmaoOperationLockStale/);
  assert.match(windowsCommon, /MaxAgeMs = 600000/);
  assert.match(unixCommon, /sanmao_operation_lock_stale/);
  assert.match(unixCommon, /-gt 600/);
});

test('runtime operations use a shared token-protected lock and drain marker', () => {
  const route = read('app/api/runtime/route.ts');
  const start = read('scripts/start.ps1');
  const stop = read('scripts/stop.ps1');
  const restart = read('scripts/restart.ps1');
  assert.match(route, /acquireRuntimeOperationLock/);
  assert.match(route, /removeOwnedRuntimeOperationLock/);
  assert.match(route, /OperationToken|operationToken/);
  assert.match(route, /networkMode\(\) !== 'local'/);
  assert.match(route, /requiresConfirmation/);
  assert.match(start, /OperationToken/);
  assert.match(stop, /OperationToken/);
  assert.match(restart, /Assert-RestartLock/);
  assert.match(restart, /Claim-RestartLock/);
});

test('production launchers detect source identity, not only file timestamps', () => {
  const windowsStart = read('scripts/start.ps1');
  const macStart = read('scripts/start-macos.sh');
  const service = read('lib/runtime-service.ts');
  assert.match(windowsStart, /\.sanmao-source-fingerprint/);
  assert.match(macStart, /source_fingerprint/);
  assert.match(service, /calculateSourceFingerprint/);
  assert.match(service, /dependenciesChanged/);
});

test('long-running API entry points register with runtime draining', () => {
  for (const relative of [
    'app/api/generate/route.ts',
    'app/api/edit/route.ts',
    'app/api/upscale/route.ts',
    'app/api/video/generate/route.ts',
    'app/api/agent/route.ts',
    'app/api/providers/test/route.ts',
    'app/api/providers/[id]/sync/route.ts',
    'app/api/providers/jimeng/route.ts',
    'app/api/video/jimeng/login/route.ts',
    'app/api/web-search/test/route.ts',
    'app/api/upscale/connections/route.ts',
    'app/api/backup/archive/route.ts',
    'app/api/canvas/assets/route.ts',
    'app/api/relay/media/route.ts',
  ]) {
    const source = read(relative);
    assert.match(source, /beginRuntimeRequest/);
    assert.match(source, /releaseRuntimeRequest/);
  }
});

test('request registration and drain creation share a short coordination gate', () => {
  const runtime = read('lib/runtime-operation.ts');
  const updater = read('scripts/apply-update.sh');
  assert.match(runtime, /withRuntimeCoordination/);
  assert.match(runtime, /coordinationLockPath/);
  assert.match(updater, /开始应用 SANMAO\.AI/);
});

test('restart and update helpers preserve rollback and release locks only after readiness', () => {
  const restart = read('scripts/restart.ps1');
  const restartSh = read('scripts/restart.sh');
  const updater = read('scripts/apply-update-core.ps1');
  const updaterSh = read('scripts/apply-update.sh');
  assert.match(restart, /previous-/);
  assert.match(restart, /failed-rolled-back/);
  assert.match(restartSh, /previous-/);
  assert.match(restartSh, /lock_matches/);
  assert.match(updater, /Claim-UpdateLock/);
  assert.match(updater, /programBackupComplete/);
  assert.match(updaterSh, /BACKUP_COMPLETE/);
  assert.match(updater, /更新流程完成/);
});

test('Windows restart status is written in a Node-readable UTF-8 format', () => {
  const restart = read('scripts/restart.ps1');
  const service = read('lib/runtime-service.ts');
  const statusWriter = restart.slice(restart.indexOf('function Write-RestartStatus'), restart.indexOf('function Assert-RestartLock'));
  assert.match(restart, /UTF8Encoding\(\$false\)/);
  assert.match(restart, /File\]::WriteAllText\(\$temporary, \$json, \$utf8NoBom\)/);
  assert.doesNotMatch(statusWriter, /Set-Content/);
  assert.match(service, /content\.replace\(\/\^\\uFEFF\//);
});
