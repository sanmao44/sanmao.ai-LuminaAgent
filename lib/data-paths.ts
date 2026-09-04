import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type DataPathOptions = {
  dataDir?: string;
  providerConfigDir?: string;
};

function absolutePath(root: string, value: string) {
  return path.resolve(root, value);
}

function findGitEntry(start: string) {
  let current = path.resolve(start);
  while (true) {
    const gitPath = path.join(current, '.git');
    try {
      const info = statSync(gitPath);
      return { root: current, gitPath, isDirectory: info.isDirectory() };
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readGitCommonDir(entry: { root: string; gitPath: string; isDirectory: boolean }) {
  if (entry.isDirectory) return entry.gitPath;
  try {
    const pointer = readFileSync(entry.gitPath, 'utf8').match(/^gitdir:\s*(.+?)\s*$/im)?.[1];
    if (!pointer) return null;
    const worktreeGitDir = absolutePath(entry.root, pointer);
    const commonDirFile = path.join(worktreeGitDir, 'commondir');
    if (!existsSync(commonDirFile)) return worktreeGitDir;
    const commonDir = readFileSync(commonDirFile, 'utf8').trim();
    return commonDir ? absolutePath(worktreeGitDir, commonDir) : worktreeGitDir;
  } catch {
    return null;
  }
}

/** Returns the checkout root that owns the shared .git directory. */
export function resolveMainWorktreeRoot(cwd = process.cwd()) {
  const entry = findGitEntry(cwd);
  if (!entry) return null;
  const commonDir = readGitCommonDir(entry);
  if (!commonDir || path.basename(commonDir).toLowerCase() !== '.git') return null;
  return path.dirname(commonDir);
}

export function resolveLocalDataDir(cwd = process.cwd(), configured = process.env.SANMAO_DATA_DIR) {
  const root = path.resolve(cwd);
  const value = String(configured || '').trim();
  return value ? absolutePath(root, value) : path.join(root, '.data');
}

/**
 * Provider credentials are server-side configuration and should follow a
 * linked Git worktree back to the primary checkout. Other local data keeps
 * using resolveLocalDataDir(), so worktrees do not overwrite each other's
 * canvas, media, logs, or task files.
 */
export function resolveProviderConfigDir(cwd = process.cwd(), options: DataPathOptions = {}) {
  const root = path.resolve(cwd);
  const configuredProviderDir = options.providerConfigDir ?? process.env.SANMAO_PROVIDER_CONFIG_DIR;
  if (String(configuredProviderDir || '').trim()) return absolutePath(root, String(configuredProviderDir).trim());

  const configuredDataDir = options.dataDir ?? process.env.SANMAO_DATA_DIR;
  if (String(configuredDataDir || '').trim()) return absolutePath(root, String(configuredDataDir).trim());

  return path.join(resolveMainWorktreeRoot(root) || root, '.data');
}
