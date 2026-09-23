import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type DataPathOptions = {
  dataDir?: string;
  providerConfigDir?: string;
};

export type DataProfileMode = 'development' | 'portable' | 'installed' | 'custom';

export type DataProfile = {
  mode: DataProfileMode;
  rootDir: string;
  dataDir: string;
  providerConfigDir: string;
  override: boolean;
};

type DataProfileEnv = {
  [key: string]: string | undefined;
  SANMAO_DATA_DIR?: string;
  SANMAO_PORTABLE?: string;
  SANMAO_DATA_MODE?: string;
  SANMAO_INSTALL_MODE?: string;
  SANMAO_INSTALLED?: string;
  LOCALAPPDATA?: string;
};

function absolutePath(root: string, value: string) {
  return path.resolve(root, value);
}

function isEnabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function installedDataDir(env: DataProfileEnv) {
  const localAppData = String(env.LOCALAPPDATA || '').trim();
  if (localAppData) return path.join(localAppData, 'SANMAO.AI');
  let home = '';
  try { home = os.homedir(); } catch {}
  if (process.platform === 'win32' && home) return path.join(home, 'AppData', 'Local', 'SANMAO.AI');
  return path.join(home || path.resolve('.'), '.local', 'share', 'SANMAO.AI');
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

/**
 * Resolves the durable-data profile without changing the historical
 * development default. Installed and portable launchers opt in explicitly;
 * SANMAO_DATA_DIR always wins for tests and custom layouts.
 */
export function resolveDataProfile(cwd = process.cwd(), env: DataProfileEnv = process.env): DataProfile {
  const root = path.resolve(cwd);
  const configured = String(env.SANMAO_DATA_DIR || '').trim();
  if (configured) {
    const dataDir = absolutePath(root, configured);
    return { mode: 'custom', rootDir: root, dataDir, providerConfigDir: dataDir, override: true };
  }

  const portable = isEnabled(env.SANMAO_PORTABLE)
    || String(env.SANMAO_DATA_MODE || '').trim().toLowerCase() === 'portable';
  if (portable) {
    const dataDir = path.join(root, 'data');
    return { mode: 'portable', rootDir: root, dataDir, providerConfigDir: dataDir, override: false };
  }

  const installed = String(env.SANMAO_INSTALL_MODE || '').trim().toLowerCase() === 'installed'
    || isEnabled(env.SANMAO_INSTALLED);
  if (installed) {
    const dataDir = installedDataDir(env);
    return { mode: 'installed', rootDir: root, dataDir, providerConfigDir: dataDir, override: false };
  }

  const dataDir = path.join(root, '.data');
  return { mode: 'development', rootDir: root, dataDir, providerConfigDir: dataDir, override: false };
}

export function resolveLocalDataDir(cwd = process.cwd(), configured = process.env.SANMAO_DATA_DIR) {
  return resolveDataProfile(cwd, { ...process.env, SANMAO_DATA_DIR: configured }).dataDir;
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

  const profile = resolveDataProfile(root);
  if (profile.mode !== 'development') return profile.providerConfigDir;
  return path.join(resolveMainWorktreeRoot(root) || root, '.data');
}
