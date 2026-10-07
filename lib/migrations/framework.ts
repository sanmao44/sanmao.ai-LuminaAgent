import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DataComponentVersions, DataManifest } from '../data-manifest';

export type MigrationVersion = string | number;
export type MigrationStatus = 'prepared' | 'running' | 'verified' | 'committing' | 'committed' | 'failed';

export type MigrationJournal = {
  format: 'sanmao-migration-journal';
  version: 1;
  migrationId: string;
  status: MigrationStatus;
  source: DataComponentVersions;
  target: DataComponentVersions;
  stagingPath: string;
  rollbackPath: string;
  completedSteps: string[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type MigrationContext = {
  dataDir: string;
  stagingDir: string;
  migrationId: string;
  component: string;
  from: MigrationVersion;
  to: MigrationVersion;
  readJson(relativePath: string): Promise<unknown | null>;
  /** Reads the live metadata root; adapters must write transformed data to staging. */
  readLiveJson(relativePath: string): Promise<unknown | null>;
  writeJson(relativePath: string, value: unknown): Promise<void>;
};

export type MigrationStep = {
  id: string;
  component: string;
  from: MigrationVersion;
  to: MigrationVersion;
  run(context: MigrationContext): Promise<void>;
  verify?(context: MigrationContext): Promise<void>;
};

export type MigrationResult = {
  migrated: boolean;
  manifest: DataManifest;
  migrationId?: string;
};

type MigrationOptions = {
  dataDir: string;
  manifest: DataManifest;
  target: DataComponentVersions;
  steps: readonly MigrationStep[];
  /** Commits only the component metadata prepared by the steps. Large media is not copied here. */
  commit(context: { dataDir: string; stagingDir: string; migrationId: string; target: DataComponentVersions }): Promise<void>;
  writeManifest(manifest: DataManifest): Promise<void>;
  now?: () => string;
};

type MigrationCommitMarker = {
  format: 'sanmao-migration-commit';
  version: 1;
  migrationId: string;
  target: DataComponentVersions;
  phase: 'prepared' | 'applied' | 'finalized';
  committedAt: string;
};

type RollbackEntry = { relativePath: string; existed: boolean; sourceSha256?: string; rollbackSha256?: string };

function sameVersion(left: MigrationVersion | undefined, right: MigrationVersion | undefined) {
  return String(left ?? '') === String(right ?? '');
}

function safeRelativePath(root: string, relativePath: string) {
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('迁移 staging 路径无效');
  return target;
}

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flush: true });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function writeJournal(file: string, journal: MigrationJournal) {
  await writeJsonAtomic(file, journal);
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function acquireMigrationLock(dataDir: string) {
  const lockDir = path.join(dataDir, 'migrations');
  const lockPath = path.join(lockDir, '.lock');
  await mkdir(lockDir, { recursive: true });
  const token = randomBytes(12).toString('hex');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify({ format: 'sanmao-migration-lock', pid: process.pid, token, createdAt: new Date().toISOString() })}\n`, 'utf8');
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: string };
          if (current.token === token) await unlink(lockPath);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST' || attempt > 0) {
        throw new Error('本地数据正在被另一个迁移任务使用，请稍后重试');
      }
      let stale = false;
      try {
        const current = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number; createdAt?: string };
        const age = current.createdAt ? Date.now() - Date.parse(current.createdAt) : 0;
        let alive = false;
        if (Number.isInteger(current.pid) && Number(current.pid) > 0) {
          try { process.kill(Number(current.pid), 0); alive = true; } catch {}
        }
        stale = age > 10 * 60 * 1000 && !alive;
      } catch { stale = true; }
      if (!stale) throw new Error('本地数据正在被另一个迁移任务使用，请稍后重试');
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error('无法获取本地数据迁移锁');
}

async function readJournal(file: string) {
  const value = JSON.parse(await readFile(file, 'utf8')) as Partial<MigrationJournal>;
  const root = path.dirname(file);
  const rootPath = path.resolve(root);
  const validateJournalPath = (candidate: unknown, fallback: string) => {
    const resolved = path.resolve(typeof candidate === 'string' && candidate.trim() ? candidate : fallback);
    if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error('迁移 journal 路径超出迁移目录');
    }
    return resolved;
  };
  // Journals written by the first implementation did not persist rollbackPath.
  // Keep those migrations recoverable after an application update.
  return {
    ...value,
    rollbackPath: validateJournalPath(value.rollbackPath, path.join(root, 'rollback')),
    stagingPath: validateJournalPath(value.stagingPath, path.join(root, 'staging')),
  } as MigrationJournal;
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const directory = safeRelativePath(root, relative || '.');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function prepareRollback(dataDir: string, stagingDir: string, rollbackDir: string) {
  const entries: RollbackEntry[] = [];
  for (const relativePath of await listFiles(stagingDir)) {
    const livePath = safeRelativePath(dataDir, relativePath);
    const rollbackPath = safeRelativePath(rollbackDir, relativePath);
    const existed = await stat(livePath).then((value) => value.isFile()).catch(() => false);
    const stagedData = await readFile(safeRelativePath(stagingDir, relativePath));
    const entry: RollbackEntry = { relativePath, existed, sourceSha256: sha256(stagedData) };
    if (existed) {
      await mkdir(path.dirname(rollbackPath), { recursive: true });
      await copyFile(livePath, rollbackPath);
      entry.rollbackSha256 = sha256(await readFile(rollbackPath));
    }
    entries.push(entry);
  }
  await writeJsonAtomic(path.join(rollbackDir, 'index.json'), entries);
}

async function verifyCommittedMetadata(dataDir: string, stagingDir: string) {
  for (const relativePath of await listFiles(stagingDir)) {
    const staged = await readFile(safeRelativePath(stagingDir, relativePath));
    const live = await readFile(safeRelativePath(dataDir, relativePath));
    if (sha256(staged) !== sha256(live)) throw new Error(`迁移提交校验失败：${relativePath}`);
  }
}

async function restoreRollback(dataDir: string, rollbackDir: string) {
  const entries = JSON.parse(await readFile(path.join(rollbackDir, 'index.json'), 'utf8')) as RollbackEntry[];
  for (const entry of entries) {
    const livePath = safeRelativePath(dataDir, entry.relativePath);
    if (!entry.existed) {
      await unlink(livePath).catch(() => undefined);
      continue;
    }
    const rollbackPath = safeRelativePath(rollbackDir, entry.relativePath);
    await mkdir(path.dirname(livePath), { recursive: true });
    await copyFile(rollbackPath, livePath);
  }
}

function planSteps(current: DataComponentVersions, target: DataComponentVersions, steps: readonly MigrationStep[]) {
  const plan: MigrationStep[] = [];
  for (const [component, targetVersion] of Object.entries(target)) {
    let version = current[component];
    if (sameVersion(version, targetVersion)) continue;
    if (typeof version === 'number' && typeof targetVersion === 'number' && version > targetVersion) {
      throw new Error(`${component} 数据版本 ${version} 高于当前程序支持的版本 ${targetVersion}，请先升级程序`);
    }
    for (let guard = 0; !sameVersion(version, targetVersion) && guard < steps.length + 1; guard += 1) {
      const step = steps.find((candidate) => candidate.component === component && sameVersion(candidate.from, version));
      if (!step) throw new Error(`缺少 ${component} ${String(version)} → ${String(targetVersion)} 的迁移步骤`);
      plan.push(step);
      version = step.to;
    }
    if (!sameVersion(version, targetVersion)) throw new Error(`无法规划 ${component} 到 ${String(targetVersion)} 的迁移`);
  }
  return plan;
}

export async function runMigrations(options: MigrationOptions): Promise<MigrationResult> {
  const now = options.now || (() => new Date().toISOString());
  const plan = planSteps(options.manifest.components, options.target, options.steps);
  if (!plan.length) return { migrated: false, manifest: options.manifest };

  const releaseLock = await acquireMigrationLock(options.dataDir);
  const migrationId = `mig-${now().replace(/[^0-9A-Za-z]/g, '')}-${randomUUID().slice(0, 8)}`;
  const migrationRoot = path.join(options.dataDir, 'migrations', migrationId);
  const stagingDir = path.join(migrationRoot, 'staging');
  const rollbackDir = path.join(migrationRoot, 'rollback');
  const journalPath = path.join(migrationRoot, 'journal.json');
  const commitPath = path.join(migrationRoot, 'commit.json');
  let journal: MigrationJournal = {
    format: 'sanmao-migration-journal',
    version: 1,
    migrationId,
    status: 'prepared',
    source: { ...options.manifest.components },
    target: { ...options.target },
    stagingPath: stagingDir,
    completedSteps: [],
    rollbackPath: rollbackDir,
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await mkdir(stagingDir, { recursive: true });
    await writeJournal(journalPath, journal);
    journal = { ...journal, status: 'running', updatedAt: now() };
    await writeJournal(journalPath, journal);
    for (const step of plan) {
      const context: MigrationContext = {
        dataDir: options.dataDir,
        stagingDir,
        migrationId,
        component: step.component,
        from: step.from,
        to: step.to,
        readJson: async (relativePath) => {
          try { return JSON.parse(await readFile(safeRelativePath(stagingDir, relativePath), 'utf8')); }
          catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; throw error; }
        },
        readLiveJson: async (relativePath) => {
          try { return JSON.parse(await readFile(safeRelativePath(options.dataDir, relativePath), 'utf8')); }
          catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; throw error; }
        },
        writeJson: (relativePath, value) => writeJsonAtomic(safeRelativePath(stagingDir, relativePath), value),
      };
      await step.run(context);
      if (step.verify) await step.verify(context);
      journal = { ...journal, completedSteps: [...journal.completedSteps, step.id], updatedAt: now() };
      await writeJournal(journalPath, journal);
    }

    journal = { ...journal, status: 'verified', updatedAt: now() };
    await writeJournal(journalPath, journal);
    await prepareRollback(options.dataDir, stagingDir, rollbackDir);
    journal = { ...journal, status: 'committing', updatedAt: now() };
    await writeJournal(journalPath, journal);
    const preparedMarker: MigrationCommitMarker = { format: 'sanmao-migration-commit', version: 1, migrationId, target: options.target, phase: 'prepared', committedAt: now() };
    await writeJsonAtomic(commitPath, preparedMarker);
    await options.commit({ dataDir: options.dataDir, stagingDir, migrationId, target: options.target });
    await verifyCommittedMetadata(options.dataDir, stagingDir);
    await writeJsonAtomic(commitPath, { ...preparedMarker, phase: 'applied', committedAt: now() });
    const nextManifest: DataManifest = {
      ...options.manifest,
      components: { ...options.manifest.components, ...options.target },
      activeGeneration: migrationId,
      lastMigrationId: migrationId,
      updatedAt: now(),
    };
    await options.writeManifest(nextManifest);
    await writeJsonAtomic(commitPath, { ...preparedMarker, phase: 'finalized', committedAt: now() });
    journal = { ...journal, status: 'committed', updatedAt: now() };
    await writeJournal(journalPath, journal);
    return { migrated: true, manifest: nextManifest, migrationId };
  } catch (error) {
    const marker = await readFile(commitPath, 'utf8').then((raw) => JSON.parse(raw) as MigrationCommitMarker).catch(() => null);
    if (marker?.phase === 'applied' || marker?.phase === 'finalized') {
      journal = { ...journal, status: 'committing', error: error instanceof Error ? error.message : String(error), updatedAt: now() };
    } else {
      await restoreRollback(options.dataDir, rollbackDir).catch(() => undefined);
      journal = { ...journal, status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: now() };
    }
    await writeJournal(journalPath, journal).catch(() => undefined);
    throw error;
  } finally {
    await releaseLock();
  }
}

export async function recoverPendingMigrations(options: {
  dataDir: string;
  manifest: DataManifest;
  writeManifest(manifest: DataManifest): Promise<void>;
  now?: () => string;
}) {
  const migrationsDir = path.join(options.dataDir, 'migrations');
  const now = options.now || (() => new Date().toISOString());
  const entries = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const root = path.join(migrationsDir, entry.name);
      const journalPath = path.join(root, 'journal.json');
      try { return { root, journalPath, journal: await readJournal(journalPath), mtime: (await stat(journalPath)).mtimeMs }; }
      catch (error) {
        if (error instanceof Error && error.message === '迁移 journal 路径超出迁移目录') throw error;
        return null;
      }
    }));
  const ordered = candidates.filter((value): value is NonNullable<typeof value> => Boolean(value)).sort((left, right) => right.mtime - left.mtime);
  let manifest = options.manifest;
  const recovered: string[] = [];
  const rolledBack: string[] = [];
  for (const item of ordered) {
    const journal = item.journal;
    if (journal.status === 'committed' || journal.status === 'failed') continue;
    const commitPath = path.join(item.root, 'commit.json');
    const commit = await readFile(commitPath, 'utf8').then((raw) => JSON.parse(raw) as MigrationCommitMarker).catch(() => null);
    if ((journal.status === 'committing' || journal.status === 'verified')
      && commit?.migrationId === journal.migrationId
      && commit.target
      && (commit.phase === 'applied' || commit.phase === 'finalized')) {
      manifest = {
        ...manifest,
        components: { ...manifest.components, ...commit.target },
        activeGeneration: journal.migrationId,
        lastMigrationId: journal.migrationId,
        updatedAt: now(),
      };
      await options.writeManifest(manifest);
      await writeJournal(item.journalPath, { ...journal, status: 'committed', updatedAt: now() });
      recovered.push(journal.migrationId);
    } else {
      await restoreRollback(options.dataDir, journal.rollbackPath).catch(() => undefined);
      await writeJournal(item.journalPath, { ...journal, status: 'failed', error: '启动时发现未提交的迁移，已保留原数据', updatedAt: now() });
      rolledBack.push(journal.migrationId);
    }
  }
  return { manifest, recovered, rolledBack };
}
