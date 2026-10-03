import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * File-level restore transaction shared by full backups and local snapshots.
 * Existing files are renamed into a rollback tree before any replacement is
 * written. Renaming keeps large media out of an additional memory buffer.
 */
export class BackupRestoreTransaction {
  private readonly root: string;
  private readonly journal: string;
  private readonly captured = new Map<string, { target: string; existed: boolean; backup?: string; captured: boolean }>();

  constructor(private readonly dataRoot: string, id = `${process.pid}-${Date.now()}`) {
    this.root = path.join(dataRoot, `.restore-rollback-${id}`);
    this.journal = path.join(this.root, 'journal.json');
  }

  private async writeJournal() {
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.journal}.tmp`;
    await writeFile(temporary, JSON.stringify([...this.captured.values()], null, 2), { flush: true });
    await rename(temporary, this.journal);
  }

  private backupPath(target: string) {
    const relative = path.relative(this.dataRoot, target).replace(/\\/g, '/');
    if (relative && relative !== '..' && !relative.startsWith('../')) return path.join(this.root, relative);
    return path.join(this.root, 'external', Buffer.from(path.resolve(target), 'utf8').toString('base64url'));
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
    await this.capture(target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flush: true });
  }

  async copy(source: string, target: string) {
    await this.capture(target);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  async remove(target: string) {
    await this.capture(target);
    await rm(target, { force: true });
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
      try { entries = JSON.parse(await readFile(journal, 'utf8')) as typeof entries; } catch { continue; }
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
