import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

/**
 * Final Architecture Lock enforcement.
 *
 * These tests turn the long-term architecture rules in ARCHITECTURE.md and
 * AGENTS.md into machine-checkable constraints over the real module graph.
 * They verify dependency direction, public boundaries and ownership, never
 * markup, identifiers or file formatting.
 *
 * Categories:
 *  - Dependency enforcement: contracts purity and core/runtime dependency
 *    direction.
 *  - Route enforcement: transport never re-absorbs agent, tool, provider or
 *    task ownership.
 *  - Repository enforcement: business layers do not open persistence directly,
 *    and the remaining direct-filesystem routes are an explicit allowlist.
 *  - Legacy enforcement: removed ownership paths must not be re-imported.
 *  - Runtime infrastructure enforcement: core/runtime packages do not reach
 *    concrete infrastructure.
 *  - Source-test enforcement: no new source-layout tests are added.
 */

const root = process.cwd();
const packagesRoot = path.join(root, 'packages');
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.git', '.data']);

const UI_OR_FRAMEWORK = /^(react|react-dom|next)(\/|$)/;
const UI_PATHS = /^@\/(components|app)(\/|$)/;
const RUNTIME_OR_CORE = /^@\/packages(\/|$)/;
const DIRECT_PERSISTENCE = /^node:(fs|fs\/promises|sqlite)$/;

/** Transport boundary components; they may depend on the application, never on runtime/core or UI. */
const TRANSPORT_BOUNDARY = [
  'app/api/agent/route.ts',
  'apps/api/agent-transport.ts',
  'apps/api/agent-http-contract.ts',
  'apps/api/agent-application-contract.ts',
  'apps/api/agent-entrypoint.ts',
];

/** Execution owners a route must never re-absorb. */
const ROUTE_FORBIDDEN_SPECIFIERS = [
  '@/packages/tool-runtime/tool-loop',
  '@/packages/tool-runtime/runtime',
  '@/packages/model-runtime/provider-coordinator',
  '@/packages/model-runtime/invocation',
  '@/packages/model-runtime/agent-invoker',
  '@/lib/clone/pipeline',
  '@/lib/video-task-service',
];

/** Removed ownership paths; re-importing one would recreate a second source of truth. */
const FORBIDDEN_LEGACY_SPECIFIERS = [
  '@/lib/provider-runtime',
  '@/lib/provider-runtime/chat',
  'lib/provider-runtime',
  'lib/provider-runtime/chat',
];

/**
 * Legacy route adapters that still touch the filesystem directly. Adding a
 * route here is a compatibility decision and must also be recorded in
 * docs/next-architecture/migration-status.md with a deletion condition.
 */
const ROUTES_WITH_DIRECT_FILESYSTEM = [
  'app/api/backup/archive/route.ts',
  'app/api/backup/route.ts',
  'app/api/canvas/assets/route.ts',
  'app/api/runtime/route.ts',
  'app/api/skills/[id]/export/route.ts',
  'app/api/storage/audio/route.ts',
  'app/api/storage/file/route.ts',
  'app/api/storage/video/route.ts',
];

/** The only packages module allowed to use filesystem APIs: the observability adapter. */
const OBSERVABILITY_SINK = path.join('packages', 'observability', 'runtime-sink.ts');

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function collectSources(relativeDir) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(path.join(current, entry.name));
        continue;
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path.join(current, entry.name));
    }
  }
  await walk(path.join(root, relativeDir));
  return files.sort();
}

async function collectAllSources(relativeDirs) {
  const groups = await Promise.all(relativeDirs.map((dir) => collectSources(dir)));
  return groups.flat().sort();
}

/** Returns every module specifier referenced by a source file. */
function importSpecifiers(source) {
  const specifiers = [];
  const statement = /\b(?:import|export)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(statement)) {
    specifiers.push({ specifier: match[2], typeOnly: /\btype\b/.test(match[1]) });
  }
  const sideEffect = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(sideEffect)) specifiers.push({ specifier: match[1] ?? match[2], typeOnly: false });
  return specifiers;
}

async function violations(files, predicate) {
  const found = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const entry of importSpecifiers(source)) {
      if (predicate(entry, file)) found.push(`${path.relative(root, file)} -> ${entry.specifier}`);
    }
  }
  return found;
}

function describe(found) {
  return `\n${found.join('\n')}\n`;
}

test('architecture: contracts depend on nothing outside the contracts package', async () => {
  const contractsDir = path.join(packagesRoot, 'contracts');
  const found = await violations(await collectSources('packages/contracts'), ({ specifier }, file) => {
    if (!specifier.startsWith('.')) return true;
    return !isInside(path.resolve(path.dirname(file), specifier), contractsDir);
  });
  assert.deepEqual(found, [], `Contracts must stay dependency-inverted and self-contained. Offenders:${describe(found)}`);
});

test('architecture: runtime/core packages never import framework, application or infrastructure modules', async () => {
  const coreDirs = ['agent-core', 'canvas-core', 'model-runtime', 'tool-runtime', 'task-runtime'];
  const files = await collectAllSources(coreDirs.map((name) => `packages/${name}`));
  const found = await violations(files, ({ specifier }, file) => {
    if (!specifier.startsWith('.')) return true;
    return !isInside(path.resolve(path.dirname(file), specifier), packagesRoot);
  });
  assert.deepEqual(found, [], `Runtime/core must depend on packages only. Offenders:${describe(found)}`);
});

test('architecture: the observability sink stays free of UI and application dependencies', async () => {
  const found = await violations(await collectSources('packages/observability'), ({ specifier }) => {
    if (UI_OR_FRAMEWORK.test(specifier)) return true;
    return /^@\/(app|apps|components|lib)(\/|$)/.test(specifier);
  });
  assert.deepEqual(found, [], `The observability adapter may use infrastructure but not the product layers. Offenders:${describe(found)}`);
});

test('architecture: HTTP route handlers never depend on UI', async () => {
  const found = await violations(await collectSources('app/api'), ({ specifier }, file) => {
    if (!file.endsWith(`${path.sep}route.ts`)) return false;
    return UI_OR_FRAMEWORK.test(specifier) || UI_PATHS.test(specifier);
  });
  assert.deepEqual(found, [], `Routes are transport adapters and must not render UI. Offenders:${describe(found)}`);
});

test('architecture: the transport boundary never reaches runtime/core or UI', async () => {
  const found = [];
  for (const relative of TRANSPORT_BOUNDARY) {
    const file = path.join(root, relative);
    const source = await readFile(file, 'utf8');
    for (const entry of importSpecifiers(source)) {
      if (UI_OR_FRAMEWORK.test(entry.specifier) || UI_PATHS.test(entry.specifier) || RUNTIME_OR_CORE.test(entry.specifier)) {
        found.push(`${relative} -> ${entry.specifier}`);
      }
    }
  }
  assert.deepEqual(found, [], `Transport depends on the application, not on runtime/core or UI. Offenders:${describe(found)}`);
});

test('architecture: routes never re-absorb tool, provider or task execution ownership', async () => {
  const found = await violations(await collectSources('app/api'), ({ specifier }, file) => {
    if (!file.endsWith(`${path.sep}route.ts`)) return false;
    return ROUTE_FORBIDDEN_SPECIFIERS.includes(specifier);
  });
  assert.deepEqual(found, [], `Routes are transport/control entry points, not execution owners. Offenders:${describe(found)}`);
});

test('architecture: task routes execute through the Worker boundary', async () => {
  const files = await collectAllSources(['app/api/video/tasks', 'app/api/upscale/tasks', 'app/api/clone/jobs']);
  files.push(path.join(root, 'app/api/upscale/route.ts'));
  const missing = [];
  for (const file of files) {
    if (!file.endsWith(`${path.sep}route.ts`)) continue;
    const source = await readFile(file, 'utf8');
    const crossesWorker = importSpecifiers(source).some((entry) => entry.specifier.startsWith('@/apps/worker/'));
    if (!crossesWorker) missing.push(path.relative(root, file));
  }
  assert.deepEqual(missing, [], `Task lifecycle must cross the Worker boundary. Offenders:${describe(missing)}`);
});

test('architecture: SQLite is opened only by the database adapter', async () => {
  const files = await collectAllSources(['lib', 'app', 'apps', 'packages', 'components']);
  const found = await violations(files, ({ specifier, typeOnly }, file) => {
    if (specifier !== 'node:sqlite' || typeOnly) return false;
    return !isInside(file, path.join(root, 'lib/database'));
  });
  assert.deepEqual(found, [], `SQLite has one authoritative adapter. Offenders:${describe(found)}`);
});

test('architecture: business layers do not open persistence directly', async () => {
  const files = await collectAllSources(['apps', 'packages']);
  const found = await violations(files.filter((file) => !file.endsWith(OBSERVABILITY_SINK)), ({ specifier }) => DIRECT_PERSISTENCE.test(specifier));
  const directBrowserStore = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/\blocalStorage\s*\./.test(source) || /\bindexedDB\s*\./.test(source)) directBrowserStore.push(path.relative(root, file));
  }
  assert.deepEqual(found, [], `Application and runtime/core must go through repository ports. Offenders:${describe(found)}`);
  assert.deepEqual(directBrowserStore, [], `Application and runtime/core must not use browser storage directly. Offenders:${describe(directBrowserStore)}`);
});

test('architecture: only the recorded legacy routes touch the filesystem directly', async () => {
  const files = (await collectSources('app/api')).filter((file) => file.endsWith(`${path.sep}route.ts`));
  const withFilesystem = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (importSpecifiers(source).some((entry) => /^node:fs(\/promises)?$/.test(entry.specifier))) {
      withFilesystem.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  assert.deepEqual(
    withFilesystem.sort(),
    [...ROUTES_WITH_DIRECT_FILESYSTEM].sort(),
    `A new route reached the filesystem directly. Record it in migration-status.md and update the allowlist. Offenders:${describe(withFilesystem)}`,
  );
});

test('architecture: removed legacy modules are not re-imported', async () => {
  const files = await collectAllSources(['lib', 'packages', 'apps', 'app', 'components']);
  const found = await violations(files, ({ specifier }) => FORBIDDEN_LEGACY_SPECIFIERS.includes(specifier));
  assert.deepEqual(found, [], `Removed ownership paths must not be re-created. Offenders:${describe(found)}`);
});

const SOURCE_TEXT_MARKERS = [/\.tsx?'/, /\.tsx?"/, /'lib\//, /"lib\//, /'components\//, /"components\//, /'app\//, /"app\//, /'packages\//, /"packages\//, /'apps\//, /"apps\//];

/** True when a file reads production TypeScript/TSX source inside a test assertion setup. */
function readsProductionSource(source) {
  const readCall = /(?:readFileSync|readFile)\s*\(/g;
  for (const match of source.matchAll(readCall)) {
    const snippet = source.slice(match.index, match.index + 400);
    const stop = snippet.search(/\)\s*[,;]/);
    const window = stop > 0 ? snippet.slice(0, stop) : snippet;
    if (SOURCE_TEXT_MARKERS.some((marker) => marker.test(window))) return true;
  }
  return false;
}

test('architecture: no new source-layout tests are added', async () => {
  const baseline = new Set(JSON.parse(await readFile(path.join(root, 'tests/architecture-source-test-baseline.json'), 'utf8')));
  const files = (await readdir(path.join(root, 'tests'))).filter((name) => name.endsWith('.test.mjs'));
  const added = [];
  for (const name of files) {
    if (baseline.has(name)) continue;
    const source = await readFile(path.join(root, 'tests', name), 'utf8');
    if (readsProductionSource(source)) added.push(name);
  }
  assert.deepEqual(added, [], `New source-layout tests are forbidden; use transpile+execute behavior tests. Offenders:${describe(added)}`);
});