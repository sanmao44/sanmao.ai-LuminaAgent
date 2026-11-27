import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { createProjectTypecheckPort } = createTsRequire(process.cwd())('./lib/agent/project-typecheck');

function fixtureDirectory(t) {
  const parent = realpathSync.native(os.tmpdir());
  const prefix = 'sanmao-project-typecheck-';
  const directory = mkdtempSync(path.join(parent, prefix));
  t.after(() => {
    const checked = realpathSync.native(directory);
    assert.equal(path.dirname(checked), parent);
    assert.ok(path.basename(checked).startsWith(prefix));
    rmSync(checked, { recursive: true, force: true });
  });
  return directory;
}

function createProject(parent, name, source = 'const ready: boolean = true;\nvoid ready;\n', compilerOptions = {}) {
  const directory = path.join(parent, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', strict: true, noEmit: true, types: [], ...compilerOptions },
    include: ['index.ts'],
  }));
  writeFileSync(path.join(directory, 'index.ts'), source);
  return directory;
}

function selectProject(port, instruction, cwd) {
  return port.selectDirectory({ instruction, cwd, authorizedRoots: port.listAuthorizedRoots() });
}

test('quotes and Chinese punctuation select the exact project directory', (t) => {
  const root = fixtureDirectory(t);
  const withSpace = createProject(root, '项目 带空格');
  const withoutSpace = createProject(root, '项目');
  const port = createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });

  for (const quoted of [`"${withSpace}"`, `“${withSpace}”`, `「${withSpace}」`, `\`${withSpace}\``]) {
    assert.deepEqual(selectProject(port, `请在${quoted}运行 typecheck`, withoutSpace), { ok: true, directory: withSpace });
  }
  assert.deepEqual(selectProject(port, `在 ${withoutSpace}，运行 typecheck`, withSpace), { ok: true, directory: withoutSpace });
  assert.equal(selectProject(port, `在 ${withSpace} 运行 typecheck`, withoutSpace).ok, false);
  if (process.platform === 'win32') {
    assert.deepEqual(selectProject(port, `在「${withSpace.toUpperCase()}」运行 typecheck`, withoutSpace), { ok: true, directory: withSpace });
  }
});

test('missing, relative or multiple explicit directories never fall back to a valid project', (t) => {
  const root = fixtureDirectory(t);
  const current = createProject(root, 'current');
  const other = createProject(root, 'other');
  const port = createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });

  for (const request of [
    `请在「${path.join(root, 'missing')}」运行 typecheck`,
    '请在 ./packages 运行 typecheck',
    '前往 ../other 后运行 typecheck',
    '请在 app/src 运行 typecheck',
    '请在另一个项目运行 typecheck',
    `请在另一个项目运行 typecheck，目录参考「${current}」`,
    `在 ${current}?suffix 运行 typecheck`,
    '运行 typecheck，在另一个项目',
    'Please run typecheck in the other repository',
    'In the other repository, please run typecheck',
    'cd packages 然后运行 typecheck',
    '运行 typecheck --project packages',
    `在「${current}」和「${other}」各运行 typecheck`,
  ]) {
    assert.equal(selectProject(port, request, current).ok, false, request);
  }
});

test('implicit directory selection requires exactly one valid project among authorized roots and app cwd', (t) => {
  const root = fixtureDirectory(t);
  const current = createProject(root, 'current');
  const other = createProject(root, 'other');
  const port = createProjectTypecheckPort();
  const instructions = ['运行 typecheck', '请在项目目录运行一次 npm run typecheck', 'Please run typecheck in the current project'];
  for (const instruction of instructions) {
    assert.deepEqual(port.selectDirectory({ instruction, cwd: current, authorizedRoots: [root] }), { ok: true, directory: current });
    assert.deepEqual(port.selectDirectory({ instruction, cwd: root, authorizedRoots: [other] }), { ok: true, directory: other });
    assert.deepEqual(port.selectDirectory({ instruction, cwd: current, authorizedRoots: [current, current] }), { ok: true, directory: current });
    const ambiguous = port.selectDirectory({ instruction, cwd: current, authorizedRoots: [root, other] });
    assert.equal(ambiguous.ok, false);
    assert.match(ambiguous.reason, /多个/);
  }
});

test('directory authorization precedes tsconfig inspection and rejects junctions that escape', async (t) => {
  const root = fixtureDirectory(t);
  const authorized = path.join(root, 'authorized');
  const outside = path.join(root, 'outside');
  mkdirSync(authorized);
  mkdirSync(outside);
  const port = createProjectTypecheckPort({ listAuthorizedRoots: () => [authorized] });

  assert.match(port.validateDirectory(outside, [authorized]).reason, /不在当前授权/);
  assert.match(port.validateDirectory(authorized, []).reason, /还没有授权/);
  assert.match(port.validateDirectory(authorized, [authorized]).reason, /tsconfig/);

  const directoryLink = path.join(authorized, 'external');
  symlinkSync(outside, directoryLink, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(port.validateDirectory(directoryLink, [authorized]).reason, /不在当前授权/);

  const linkedConfig = path.join(authorized, 'tsconfig.json');
  symlinkSync(outside, linkedConfig, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(port.validateDirectory(authorized, [authorized]).reason, /tsconfig\.json 指向了项目目录之外/);

  const blocked = await port.run({ directory: outside });
  assert.equal(blocked.exitCode, null);
  assert.match(blocked.error, /不在当前授权/);
});

test('a previously selected project redirected inside the granted root requires new approval', async (t) => {
  const root = fixtureDirectory(t);
  const project = createProject(root, 'project');
  const replacement = createProject(root, 'replacement');
  const port = createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });
  const selected = selectProject(port, `在「${project}」运行 typecheck`, root);
  assert.equal(selected.directory, project);
  renameSync(project, path.join(root, 'moved'));
  symlinkSync(replacement, project, process.platform === 'win32' ? 'junction' : 'dir');

  const result = await port.run({ directory: selected.directory });
  assert.equal(result.exitCode, null);
  assert.match(result.error, /已指向另一个位置/);
});

test('real compiler reports pass and failure in the selected cwd and preserves read-only options', async (t) => {
  const root = fixtureDirectory(t);
  const passing = createProject(root, 'passing');
  const failing = createProject(root, 'failing', 'const count: number = "invalid";\nvoid count;\n', {
    noCheck: true,
    noEmit: false,
    incremental: true,
    composite: true,
    tsBuildInfoFile: 'unexpected.tsbuildinfo',
    generateTrace: 'unexpected-trace',
    generateCpuProfile: 'unexpected.cpuprofile',
  });
  const port = createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });
  const appCwd = process.cwd();
  const failure = await port.run({ directory: failing });
  assert.equal(failure.directory, failing);
  assert.equal(failure.exitCode, 2);
  assert.match(failure.stdout, /^index\.ts\(1,7\): error TS2322/m);
  assert.equal(failure.stderr, '');
  assert.equal(failure.outputTruncated, false);
  assert.deepEqual(readdirSync(failing).sort(), ['index.ts', 'tsconfig.json']);
  assert.equal(process.cwd(), appCwd);

  const success = await port.run({ directory: passing });
  assert.equal(success.directory, passing);
  assert.equal(success.exitCode, 0);
  assert.equal(success.stdout, '');
  assert.equal(success.stderr, '');
  assert.equal(success.timedOut, false);
  assert.equal(success.cancelled, false);
  assert.equal(success.error, undefined);
  assert.deepEqual(readdirSync(passing).sort(), ['index.ts', 'tsconfig.json']);
});

test('project typecheck does not start the compiler if already cancelled', async (t) => {
  const root = fixtureDirectory(t);
  const project = createProject(root, 'ready');
  const loadTs = createTsRequire(process.cwd(), { 'node:child_process': { spawn: () => assert.fail('spawned after cancellation') } });
  const port = loadTs('./lib/agent/project-typecheck').createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });
  const controller = new AbortController();
  controller.abort();
  const result = await port.run({ directory: project }, { signal: controller.signal });
  assert.equal(result.exitCode, null);
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

for (const mode of ['cancel', 'deadline']) {
  test(`project typecheck stops a running compiler on ${mode}`, { timeout: 20_000 }, async (t) => {
    const root = fixtureDirectory(t);
    const project = createProject(root, 'ready');
    const controller = new AbortController();
    if (mode === 'deadline') t.mock.timers.enable({ apis: ['setTimeout'] });

    let child;
    const spawned = Promise.withResolvers();
    const loadTs = createTsRequire(process.cwd(), {
      'node:child_process': {
        spawn(file, args, options) {
          child = spawn(file, args, options);
          child.once('spawn', spawned.resolve);
          child.once('error', spawned.reject);
          return child;
        },
      },
    });
    const port = loadTs('./lib/agent/project-typecheck').createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });
    const running = port.run({ directory: project }, { signal: controller.signal });
    await spawned.promise;
    assert.ok(child.pid > 0);
    assert.equal(child.exitCode, null);
    if (mode === 'cancel') controller.abort();
    else t.mock.timers.tick(120_000);

    const result = await running;
    assert.equal(result.exitCode, null);
    assert.equal(result.cancelled, mode === 'cancel');
    assert.equal(result.timedOut, mode === 'deadline');
    assert.equal(child.signalCode, 'SIGKILL');
    assert.match(result.error, mode === 'deadline' ? /已终止/ : /已取消/);
  });
}

test('project typecheck bounds captured diagnostics without breaking UTF-8 output', async (t) => {
  const root = fixtureDirectory(t);
  const source = Array.from({ length: 1_800 }, (_, index) => `const value${index}: 'valid' = "错误-${index}";`).join('\n');
  const project = createProject(root, '诊断', source);
  const port = createProjectTypecheckPort({ listAuthorizedRoots: () => [root] });

  const result = await port.run({ directory: project });
  assert.equal(result.exitCode, 2);
  assert.equal(result.outputTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 64 * 1024);
  assert.match(result.stdout, /错误/);
  assert.doesNotMatch(result.stdout, /\uFFFD/);
  assert.equal(result.stderr, '');
});
