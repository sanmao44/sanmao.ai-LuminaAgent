import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Staged file restore transaction shared by full backups and local snapshots.
 * Incoming files are written under the rollback tree first. The live targets
 * are captured and replaced only at commit, keeping validation and cutover
 * separate while avoiding large media buffers.
 */
export class BackupRestoreTransaction {
  private readonly root: string;
  private readonly journal: string;
  private readonly captured = new Map<string, { target: string; existed: boolean; backup?: string; captured: boolean }>();
  private readonly operations = new Map<string, { target: string; type: 'write' | 'remove'; stage?: string }>();

  constructor(private readonly dataRoot: string, id = `${process.pid}-${Date.now()}`) {
    this.root = path.join(dataRoot, `.restore-rollback-${id}`);
    this.journal = path.join(this.root, 'journal.json');
  }

  private async writeJournal(phase: 'active' | 'committed' = 'active') {
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.journal}.tmp`;
    await writeFile(temporary, JSON.stringify({ phase, entries: [...this.captured.values()], operations: [...this.operations.values()] }, null, 2), { flush: true });
    await rename(temporary, this.journal);
  }

  private backupPath(target: string) {
    const relative = path.relative(this.dataRoot, target).replace(/\\/g, '/');
    if (relative && relative !== '..' && !relative.startsWith('../')) return path.join(this.root, relative);
    return path.join(this.root, 'external', Buffer.from(path.resolve(target), 'utf8').toString('base64url'));
  }

  private stagePath(target: string) {
    const relative = path.relative(this.dataRoot, target).replace(/\\/g, '/');
    const safe = relative && relative !== '..' && !relative.startsWith('../')
      ? relative
      : path.join('external', Buffer.from(path.resolve(target), 'utf8').toString('base64url'));
    return path.join(this.root, 'staged', safe);
  }

  private async capture(target: string) {
    if (this.captured.has(target)) return;
    try {
      const info = await stat(target);
      if (!info.isFile()) { this.captured.set(target, { target, existed: false, captured: true }); await this.writeJournal(); return; }
      const backup = this.backupPath(target);
      await mkdir(path.dirname(backup), { recursive: true });
      this.captured.set(target, { target, existed: true, backup, captured: false });
      await this.writeJournal();
      try {
        await rename(target, backup);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
        await copyFile(target, backup);
        await unlink(target);
      }
      this.captured.set(target, { target, existed: true, backup, captured: true });
      await this.writeJournal();
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.captured.set(target, { target, existed: false, captured: true });
        await this.writeJournal();
        return;
      }
      throw error;
    }
  }

  async write(target: string, data: Buffer | string) {
    const stage = this.stagePath(target);
    await mkdir(path.dirname(stage), { recursive: true });
    await writeFile(stage, data, { flush: true });
    this.operations.set(target, { target, type: 'write', stage });
    await this.writeJournal();
  }

  async copy(source: string, target: string) {
    const stage = this.stagePath(target);
    await mkdir(path.dirname(stage), { recursive: true });
    await copyFile(source, stage);
    this.operations.set(target, { target, type: 'write', stage });
    await this.writeJournal();
  }

  async remove(target: string) {
    this.operations.set(target, { target, type: 'remove' });
    await this.writeJournal();
  }

  async rollback() {
    for (const entry of [...this.captured.values()].reverse()) {
      await rm(entry.target, { force: true }).catch(() => undefined);
      if (entry.existed && entry.backup) {
        await mkdir(path.dirname(entry.target), { recursive: true });
        try {
          await rename(entry.backup, entry.target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
          await copyFile(entry.backup, entry.target);
          await unlink(entry.backup).catch(() => undefined);
        }
      }
    }
    await rm(this.root, { recursive: true, force: true }).catch(() => undefined);
  }

  async commit() {
    // This is the durable cutover point. If the process dies after this
    // marker, the new state is authoritative and recovery only removes the
    // rollback tree; before it, recovery restores the previous state.
    for (const operation of this.operations.values()) await this.capture(operation.target);
    for (const operation of this.operations.values()) {
      if (operation.type === 'remove') {
        await rm(operation.target, { force: true });
        continue;
      }
      if (!operation.stage) throw new Error(`缺少 staged restore 文件：${operation.target}`);
      await mkdir(path.dirname(operation.target), { recursive: true });
      try { await rename(operation.stage, operation.target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
        await copyFile(operation.stage, operation.target);
        await unlink(operation.stage);
      }
    }
    await this.writeJournal('committed');
    await rm(this.root, { recursive: true, force: true });
  }

  /** Recover a transaction interrupted by process termination. If a journal
   * was written before a rename, the target is left untouched when no backup
   * exists. If the backup exists, the old file is restored atomically where
   * possible. */
  static async recover(dataRoot: string) {
    const candidates = await readdir(dataRoot, { withFileTypes: true }).catch(() => []);
    for (const candidate of candidates) {
      if (!candidate.isDirectory() || !candidate.name.startsWith('.restore-rollback-')) continue;
      const root = path.join(dataRoot, candidate.name);
      const journal = path.join(root, 'journal.json');
      let entries: Array<{ target: string; existed: boolean; backup?: string; captured: boolean }>;
      let phase: 'active' | 'committed' = 'active';
      try {
        const parsed = JSON.parse(await readFile(journal, 'utf8')) as { phase?: 'active' | 'committed'; entries?: typeof entries } | typeof entries;
        if (Array.isArray(parsed)) entries = parsed;
        else { entries = Array.isArray(parsed.entries) ? parsed.entries : []; phase = parsed.phase === 'committed' ? 'committed' : 'active'; }
      } catch { continue; }
      if (phase === 'committed') {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      for (const entry of entries.reverse()) {
        if (!entry.existed || !entry.backup) {
          if (entry.captured) await rm(entry.target, { force: true }).catch(() => undefined);
          continue;
        }
        let backupExists = false;
        try { backupExists = (await stat(entry.backup)).isFile(); } catch {}
        if (!backupExists) continue;
        await rm(entry.target, { force: true }).catch(() => undefined);
        await mkdir(path.dirname(entry.target), { recursive: true });
        try { await rename(entry.backup, entry.target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
          await copyFile(entry.backup, entry.target);
          await unlink(entry.backup).catch(() => undefined);
        }
      }
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
