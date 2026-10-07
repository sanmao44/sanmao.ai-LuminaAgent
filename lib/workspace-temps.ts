import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const WORKSPACE_TEMP_PATTERN = /^workspace\.json\.\d+\.\d+\.tmp$/;
export const WORKSPACE_TEMP_MAX_AGE_MS = 10 * 60 * 1000;

type SweepOptions = { maxAgeMs?: number; now?: number };

export async function sweepStaleWorkspaceTemps(dataDir: string, options: SweepOptions = {}) {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? WORKSPACE_TEMP_MAX_AGE_MS;
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  await Promise.all(entries
    .filter((entry) => entry.isFile() && WORKSPACE_TEMP_PATTERN.test(entry.name))
    .map(async (entry) => {
      const file = path.join(dataDir, entry.name);
      try {
        const info = await stat(file);
        if (now - info.mtimeMs < maxAgeMs) return;
        await unlink(file);
        removed += 1;
      } catch {}
    }));
  return removed;
}
