import { copyFile, mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * File-level restore transaction shared by full backups and local snapshots.
 * Existing files are renamed into a rollback tree before any replacement is
 * written. Renaming keeps large media out of an additional memory buffer.
 */
export class BackupRestoreTransaction {
  private readonly root: string;
  private readonly captured = new Map<string, { target: string; existed: boolean; backup?: string }>();

  constructor(private readonly dataRoot: string, id = `${process.pid}-${Date.now()}`) {
    this.root = path.join(dataRoot, `.restore-rollback-${id}`);
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
      if (!info.isFile()) { this.captured.set(target, { target, existed: false }); return; }
      const backup = this.backupPath(target);
      await mkdir(path.dirname(backup), { recursive: true });
      try {
        await rename(target, backup);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
        await copyFile(target, backup);
        await unlink(target);
      }
      this.captured.set(target, { target, existed: true, backup });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.captured.set(target, { target, existed: false });
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
}
