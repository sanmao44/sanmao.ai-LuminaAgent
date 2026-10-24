/**
 * 从 GitHub 仓库安装 MCP 项目。
 *
 * 只接受 package.json 能识别的 Node 项目。仓库内容放到应用数据目录，依赖安装
 * 禁用 lifecycle scripts，启动时只执行解析出的入口文件；不读取 README 命令，
 * 也不把用户输入拼成 shell 命令。
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { fetchSkillBytes, githubArchiveUrls, parseGithubSkillTarget, type GithubSkillTarget } from '@/lib/skills';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { resolveNpmCliPath } from './npm-cli';
import { listMcpServers, normalizeMcpServerId, saveMcpServers } from './store';
import { probeMcpServer } from './client';
import { closeStdioServer } from './stdio';
import type { McpServerConfig } from './types';

const REPO_ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;
const REPO_FILE_MAX_BYTES = 8 * 1024 * 1024;
const REPO_FILES_MAX = 2400;
const REPO_TOTAL_MAX_BYTES = 48 * 1024 * 1024;
const REPO_INSTALL_TIMEOUT_MS = 10 * 60_000;
const UV_VERSION = '0.12.19';
const UV_ARCHIVE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;
const UV_ARCHIVE_SHA256 = '6dbb02d79e419522f1c500f0adb1cddcff0cda7d59b0d66ea7f5e3b4a1b2f5f0';
const UV_ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;

export type GithubMcpInstallResult = {
  server: McpServerConfig;
  target: GithubSkillTarget;
  projectRoot: string;
  entry: string;
};

export type GithubMcpUpdateResult = {
  server: McpServerConfig;
  updated: boolean;
  latestCommit: string;
  checkedAt: number;
};

type ArchiveFile = { path: string; data: Uint8Array };
type ExtractedRepo = {
  kind: 'node' | 'python';
  packageRoot: string;
  files: ArchiveFile[];
  packageJson?: Record<string, unknown>;
  pythonEntry?: string;
  projectName?: string;
  packageVersion?: string;
};

function safeArchivePath(value: string) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return '';
  return normalized;
}

function isInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseJsonFile(data: Uint8Array, file: string) {
  try {
    const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是对象');
    return parsed;
  } catch {
    throw new Error(`${file} 不是有效的 package.json`);
  }
}

function packageEntry(packageJson: Record<string, unknown>) {
  const bin = packageJson.bin;
  if (typeof bin === 'string' && bin.trim()) return bin.trim();
  if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    const values = Object.values(bin as Record<string, unknown>).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (values.length) return values[0].trim();
  }
  if (typeof packageJson.main === 'string' && packageJson.main.trim()) return packageJson.main.trim();
  return 'index.js';
}

function packageLooksLikeMcp(packageJson: Record<string, unknown>) {
  const text = JSON.stringify(packageJson).toLowerCase();
  return text.includes('mcp') || text.includes('model context protocol');
}

function parsePythonProject(data: Uint8Array) {
  const text = Buffer.from(data).toString('utf8');
  if (!/\bmcp\b|model-context-protocol/i.test(text)) return null;
  const projectBlock = text.match(/\[project\]([\s\S]*?)(?:\n\s*\[|$)/i)?.[1] || '';
  const projectName = projectBlock.match(/^\s*name\s*=\s*["']([^"']+)["']/im)?.[1]?.trim() || '';
  const packageVersion = projectBlock.match(/^\s*version\s*=\s*["']([^"']+)["']/im)?.[1]?.trim() || '';
  const scriptsBlock = text.match(/\[project\.scripts\]([\s\S]*?)(?:\n\s*\[|$)/i)?.[1] || '';
  const pythonEntry = scriptsBlock.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["']/m)?.[1]?.trim() || '';
  if (!projectName || !pythonEntry) return null;
  return { projectName, pythonEntry, packageVersion };
}

function uvVersionOf(value: unknown) {
  return String(value || '').match(/\d+\.\d+\.\d+/)?.[0] || '';
}

function versionAtLeast(version: string, minimum: string) {
  const parts = version.split('.').map(Number);
  const floor = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(parts.length, floor.length); index += 1) {
    const value = parts[index] || 0;
    const required = floor[index] || 0;
    if (value !== required) return value > required;
  }
  return true;
}

/**
 * 系统自带的 uv 只在版本不旧于应用内置版本时才用。
 *
 * 旧版 uv 在 Windows 上写启动 trampoline 的 PE 资源会被安全软件拦成「拒绝访问」，
 * 直接装不上 Python MCP（实测 0.12.3 必失败、内置的 0.12.19 正常）；版本不够就回退到
 * ensureUvPath() 自己下载的固定版本。
 */
function resolveUvPath() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(command, ['uv'], { shell: false, windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const candidates = String(result.stdout || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item && path.isAbsolute(item) && existsSync(item));
  if (process.platform !== 'win32') return candidates[0] || null;
  return candidates.find((candidate) => {
    const probe = spawnSync(candidate, ['--version'], { shell: false, windowsHide: true, encoding: 'utf8' });
    const version = probe.status === 0 ? uvVersionOf(probe.stdout) : '';
    return Boolean(version) && versionAtLeast(version, UV_VERSION);
  }) || null;
}

export async function ensureUvPath(dataDir: string, signal?: AbortSignal, options: { preferBundled?: boolean } = {}) {
  const installed = options.preferBundled ? null : resolveUvPath();
  if (installed) return installed;
  if (process.platform !== 'win32') throw new Error('这个 Windows MCP 只能在 Windows 上安装');
  const runtimeDir = path.join(dataDir, 'runtime', 'uv');
  const uvPath = path.join(runtimeDir, 'uv.exe');
  if (existsSync(uvPath)) return uvPath;
  const archive = await fetchSkillBytes(UV_ARCHIVE_URL, {
    maxBytes: UV_ARCHIVE_MAX_BYTES,
    accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5',
    signal,
    // 固定版本包有 17MB，慢线路要留足时间，否则第一次安装会被判成超时。
    timeoutMs: 300_000,
  });
  const digest = createHash('sha256').update(archive.data).digest('hex');
  if (digest !== UV_ARCHIVE_SHA256) throw new Error('uv 下载包校验失败，已停止安装');
  const files = unzipSync(archive.data);
  const entry = Object.entries(files).find(([name]) => path.posix.basename(name).toLowerCase() === 'uv.exe')?.[1];
  if (!entry) throw new Error('uv 下载包缺少启动文件，已停止安装');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(`${uvPath}.download`, entry);
  const temporary = `${uvPath}.download`;
  renameSync(temporary, uvPath);
  const check = spawnSync(uvPath, ['--version'], { shell: false, windowsHide: true, encoding: 'utf8' });
  if (check.status !== 0) throw new Error('应用准备 uv 失败，请稍后重试');
  return uvPath;
}

function repoId(target: GithubSkillTarget, used: Set<string>) {
  const base = normalizeMcpServerId(`${target.owner}-${target.repo}`, 'github-mcp');
  if (!used.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = normalizeMcpServerId(`${base}-${index}`);
    if (!used.has(candidate)) return candidate;
  }
  return normalizeMcpServerId(`${base}-${Date.now() % 10000}`);
}

/**
 * codeload 的 zip 永远多一层「仓库名-分支」目录。剥掉它，packageRoot 才是仓库内的路径；
 * 否则安装目录会算到一个从未创建的路径上，npm/uv 以它作为工作目录启动就是 ENOENT。
 */
function archiveRootPrefix(paths: string[]) {
  const first = paths[0]?.split('/')[0] || '';
  if (!first) return '';
  return paths.every((item) => item.includes('/') && item.split('/')[0] === first) ? `${first}/` : '';
}

function stripArchiveRoot(relative: string, prefix: string) {
  return prefix && relative.startsWith(prefix) ? relative.slice(prefix.length) : relative;
}

export function extractMcpRepoArchive(data: Uint8Array) {
  const files: ArchiveFile[] = [];
  let total = 0;
  const nodeCandidates: Array<{ path: string; data: Uint8Array; depth: number }> = [];
  const pythonCandidates: Array<{ path: string; data: Uint8Array; depth: number; projectName: string; pythonEntry: string; packageVersion: string }> = [];
  const unzipped = unzipSync(data, {
    filter: (file: UnzipFileInfo) => {
      if (file.name.endsWith('/')) return false;
      const relative = safeArchivePath(file.name);
      if (!relative || file.originalSize > REPO_FILE_MAX_BYTES || files.length >= REPO_FILES_MAX || total + file.originalSize > REPO_TOTAL_MAX_BYTES) return false;
      return true;
    },
  });
  const entries = Object.entries(unzipped);
  const rootPrefix = archiveRootPrefix(entries.map(([name]) => safeArchivePath(name)).filter(Boolean));
  for (const [rawPath, bytes] of entries) {
    const relative = stripArchiveRoot(safeArchivePath(rawPath), rootPrefix);
    if (!relative || !bytes) continue;
    total += bytes.byteLength;
    files.push({ path: relative, data: bytes });
    if (path.posix.basename(relative).toLowerCase() === 'package.json') {
      try {
        if (packageLooksLikeMcp(parseJsonFile(bytes, relative))) nodeCandidates.push({ path: relative, data: bytes, depth: relative.split('/').length });
      } catch {}
    }
    if (path.posix.basename(relative).toLowerCase() === 'pyproject.toml') {
      const project = parsePythonProject(bytes);
      if (project) pythonCandidates.push({ path: relative, data: bytes, depth: relative.split('/').length, ...project });
    }
  }
  nodeCandidates.sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path));
  pythonCandidates.sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path));
  const selected = nodeCandidates[0];
  const selectedPython = pythonCandidates[0];
  if (!selected && !selectedPython) throw new Error('这个 GitHub 仓库没有找到可识别的 MCP 项目（支持 Node package.json 或 Python pyproject.toml）');
  if (selectedPython && (!selected || selectedPython.depth < selected.depth)) {
    const packageRoot = selectedPython.path.slice(0, -'pyproject.toml'.length).replace(/\/$/, '');
    const prefix = packageRoot ? `${packageRoot}/` : '';
    return {
      kind: 'python',
      packageRoot,
      pythonEntry: selectedPython.pythonEntry,
      projectName: selectedPython.projectName,
      packageVersion: selectedPython.packageVersion,
      files: files.filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: prefix ? file.path.slice(prefix.length) : file.path, data: file.data })),
    } satisfies ExtractedRepo;
  }
  const packageRoot = selected.path.slice(0, -'package.json'.length).replace(/\/$/, '');
  const prefix = packageRoot ? `${packageRoot}/` : '';
  const packageJson = parseJsonFile(selected.data, selected.path);
  return {
    kind: 'node',
    packageJson,
    packageRoot,
    packageVersion: typeof packageJson.version === 'string' ? packageJson.version : '',
    files: files.filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: prefix ? file.path.slice(prefix.length) : file.path, data: file.data })),
  } satisfies ExtractedRepo;
}

async function downloadGithubArchive(target: GithubSkillTarget, signal?: AbortSignal) {
  let lastError: unknown = null;
  for (const url of githubArchiveUrls(target)) {
    try {
      // 慢线路下 1.7MB 的仓库包实测要 40 秒以上，60 秒会把正常安装判成超时。
      return await fetchSkillBytes(url, { maxBytes: REPO_ARCHIVE_MAX_BYTES, accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5', signal, timeoutMs: 180_000 });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('HTTP 404')) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('GitHub 仓库下载失败');
}

type GithubCommit = { sha: string; ref: string };

async function githubJson(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const timeout = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, {
    signal: requestSignal,
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'SANMAO.AI-MCP-Updater/1.0' },
  });
  if (!response.ok) throw new Error(`GitHub 版本检查失败（HTTP ${response.status}）`);
  return response.json();
}

async function resolveLatestGithubCommit(
  owner: string,
  repo: string,
  ref: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<GithubCommit> {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error('GitHub 仓库来源记录无效，已停止更新');
  }
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = await githubJson(base, options.signal, options.fetchImpl) as { full_name?: unknown; default_branch?: unknown };
  if (String(repository.full_name || '').toLowerCase() !== `${owner}/${repo}`.toLowerCase()) {
    throw new Error('GitHub 返回的仓库身份与已安装来源不一致，已停止更新');
  }
  const branch = ref.trim() || String(repository.default_branch || '').trim();
  if (!branch || branch.length > 200 || /[\r\n]/.test(branch)) throw new Error('GitHub 仓库没有可用的默认分支');
  const query = new URLSearchParams({ sha: branch, per_page: '1' });
  const commits = await githubJson(`${base}/commits?${query}`, options.signal, options.fetchImpl);
  const sha = Array.isArray(commits) ? String((commits[0] as { sha?: unknown } | undefined)?.sha || '') : '';
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('GitHub 没有返回有效的提交版本');
  return { sha: sha.toLowerCase(), ref: branch };
}

async function downloadGithubCommitArchive(target: GithubSkillTarget, commit: string, signal?: AbortSignal) {
  const url = `https://codeload.github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/zip/${commit}`;
  return fetchSkillBytes(url, {
    maxBytes: REPO_ARCHIVE_MAX_BYTES,
    accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5',
    signal,
    timeoutMs: 180_000,
  });
}

function writeArchiveFiles(root: string, files: ArchiveFile[]) {
  for (const file of files) {
    const target = path.resolve(root, file.path);
    if (!isInside(root, target)) throw new Error('仓库包含不安全的文件路径');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.data);
  }
}

function runNpmInstall(projectRoot: string) {
  const npmCli = resolveNpmCliPath();
  if (!npmCli) throw new Error('这台机器上找不到 npm，无法安装这个 MCP');
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, 'install', '--prefix', projectRoot, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'], {
      shell: false,
      windowsHide: true,
      cwd: projectRoot,
      env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_yes: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const append = (chunk: string) => { log = (log + chunk).slice(-1200); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('MCP 安装超时，请检查网络后重试')); }, REPO_INSTALL_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`MCP 安装失败：${error.message}`)); });
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`MCP 安装失败（退出码 ${code ?? 'null'}）${log.trim() ? `：${log.trim()}` : ''}`)); });
  });
}

function runUvSync(uvPath: string, projectRoot: string, dataDir: string) {
  // 有些安全软件会拦下系统 %TEMP% 里对新 exe 的 PE 资源改写，uv 写 trampoline 时会报
  // 「拒绝访问」直接装不上；给 uv 一个应用自己管理的临时目录，安装才稳定。
  const tempDir = path.join(dataDir, 'mcp', 'tmp');
  mkdirSync(tempDir, { recursive: true });
  return new Promise<void>((resolve, reject) => {
    const child = spawn(uvPath, ['--directory', projectRoot, 'sync', '--no-dev'], {
      shell: false,
      windowsHide: true,
      cwd: projectRoot,
      env: { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const append = (chunk: string) => { log = (log + chunk).slice(-1600); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('Python MCP 依赖安装超时，请检查网络后重试')); }, REPO_INSTALL_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`Python MCP 依赖安装失败：${error.message}`)); });
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Python MCP 依赖安装失败（退出码 ${code ?? 'null'}）${log.trim() ? `：${log.trim()}` : ''}`)); });
  });
}

/** 下载、安装并生成受控 stdio 配置；不会执行 README 或 package scripts。 */
export async function installGithubMcpFromRepo(value: unknown, options: { dataDir?: string; signal?: AbortSignal } = {}): Promise<GithubMcpInstallResult> {
  const parsedTarget = parseGithubSkillTarget(value);
  if (!parsedTarget) throw new Error('请提供 GitHub 仓库地址，例如 https://github.com/owner/repo');
  const latest = await resolveLatestGithubCommit(parsedTarget.owner, parsedTarget.repo, parsedTarget.ref, { signal: options.signal });
  const target = { ...parsedTarget, ref: latest.ref };
  const archive = await downloadGithubCommitArchive(target, latest.sha, options.signal);
  const extracted = extractMcpRepoArchive(archive.data);
  const dataDir = options.dataDir || resolveLocalDataDir();
  const used = new Set(listMcpServers({ dataDir }).map((server) => server.id));
  const id = repoId(target, used);
  const installRoot = path.join(dataDir, 'mcp', 'repos', id);
  const projectRoot = path.resolve(installRoot, extracted.packageRoot);
  if (!isInside(installRoot, projectRoot)) throw new Error('仓库项目目录不安全');
  let pythonUvPath = '';
  if (extracted.kind === 'python') pythonUvPath = await ensureUvPath(dataDir, options.signal);
  // 归档文件已按 packageRoot 裁掉前缀落盘，projectRoot 才是它们真正所在的工作目录。
  mkdirSync(projectRoot, { recursive: true });
  writeArchiveFiles(projectRoot, extracted.files);
  let command = '';
  let args: string[] = [];
  let entry = '';
  let name = `${target.owner}/${target.repo}`;
  if (extracted.kind === 'node') {
    const entryPath = path.resolve(projectRoot, packageEntry(extracted.packageJson));
    if (!isInside(projectRoot, entryPath)) throw new Error('package.json 的 MCP 入口超出了仓库目录');
    await runNpmInstall(projectRoot);
    if (!existsSync(entryPath)) throw new Error('依赖安装完成，但没有找到 MCP 启动入口');
    command = process.execPath;
    args = [entryPath];
    entry = entryPath;
    name = typeof extracted.packageJson?.name === 'string' && extracted.packageJson.name.trim() ? extracted.packageJson.name.trim().slice(0, 60) : name;
  } else {
    await runUvSync(pythonUvPath, projectRoot, dataDir);
    command = pythonUvPath;
    args = ['--directory', projectRoot, 'run', extracted.pythonEntry || 'mcp', 'serve'];
    entry = extracted.pythonEntry || 'mcp';
    name = extracted.projectName?.slice(0, 60) || name;
  }
  const server: McpServerConfig = {
    id,
    name,
    url: `stdio://${id}`,
    transport: 'stdio',
    enabled: true,
    allowWrite: false,
    command,
    args,
    cwd: projectRoot,
    managedRepo: {
      owner: target.owner,
      repo: target.repo,
      ref: target.ref,
      url: String(value || ''),
      kind: extracted.kind,
      packageName: extracted.kind === 'node' ? String(extracted.packageJson?.name || '') : String(extracted.projectName || ''),
      packageVersion: extracted.packageVersion || '',
      commit: latest.sha,
      archiveSha256: createHash('sha256').update(archive.data).digest('hex'),
      installedAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      autoUpdate: true,
    },
  };
  const saved = saveMcpServers([...listMcpServers({ dataDir }).filter((item) => item.id !== id), server], { dataDir });
  return { server: saved.find((item) => item.id === id) || server, target, projectRoot, entry };
}

const MCP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const managedUpdates = new Map<string, Promise<GithubMcpUpdateResult>>();

function managedPackageIdentity(server: McpServerConfig) {
  if (!server.cwd || !server.managedRepo) throw new Error('缺少已安装的 MCP 项目目录，无法安全更新');
  let identity: { kind: 'node' | 'python'; packageName: string; packageVersion: string };
  const packageFile = path.join(server.cwd, 'package.json');
  if (existsSync(packageFile)) {
    const pkg = readManagedMcpPackage(server);
    if (typeof pkg?.name !== 'string' || !pkg.name.trim()) throw new Error('已安装的 Node MCP 缺少 package.json name，无法安全更新');
    identity = { kind: 'node', packageName: pkg.name.trim(), packageVersion: String(pkg.version || '') };
  } else {
    const projectFile = path.join(server.cwd, 'pyproject.toml');
    if (!existsSync(projectFile)) throw new Error('已安装的 MCP 项目清单无法识别，无法安全更新');
    const parsed = parsePythonProject(new Uint8Array(readFileSync(projectFile)));
    if (!parsed) throw new Error('已安装的 Python MCP 缺少可识别的项目名或启动入口，无法安全更新');
    identity = { kind: 'python', packageName: parsed.projectName, packageVersion: parsed.packageVersion };
  }
  if (server.managedRepo.kind && server.managedRepo.kind !== identity.kind) throw new Error('本地 MCP 运行时类型与来源记录不一致，已停止更新');
  if (server.managedRepo.packageName && normalizePackageName(server.managedRepo.packageName) !== normalizePackageName(identity.packageName)) {
    throw new Error('本地 MCP 包名与来源记录不一致，已停止更新');
  }
  return identity;
}

function normalizePackageName(value: string) {
  return value.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

function packageIdentityMatches(expected: { kind: string; packageName: string }, extracted: ExtractedRepo) {
  if (expected.kind !== extracted.kind) return false;
  const actual = extracted.kind === 'node' ? String(extracted.packageJson?.name || '') : String(extracted.projectName || '');
  return normalizePackageName(actual) === normalizePackageName(expected.packageName);
}

function sameManagedSource(left: NonNullable<McpServerConfig['managedRepo']>, right: NonNullable<McpServerConfig['managedRepo']>) {
  return left.owner.toLowerCase() === right.owner.toLowerCase()
    && left.repo.toLowerCase() === right.repo.toLowerCase()
    && String(left.commit || '').toLowerCase() === String(right.commit || '').toLowerCase();
}

function saveManagedRepoMetadata(
  server: McpServerConfig,
  expectedSource: NonNullable<McpServerConfig['managedRepo']>,
  patch: Partial<NonNullable<McpServerConfig['managedRepo']>>,
  options: { dataDir?: string },
) {
  const servers = listMcpServers(options);
  const index = servers.findIndex((item) => item.id === server.id);
  if (index < 0) throw new Error(`找不到本地 MCP「${server.id}」，更新结果未应用`);
  const current = servers[index];
  if (!current.managedRepo || !sameManagedSource(current.managedRepo, expectedSource)) throw new Error('MCP 来源在更新期间发生变化，更新结果未应用');
  const saved = { ...current, managedRepo: { ...current.managedRepo, ...patch } };
  saveMcpServers(servers.map((item, position) => position === index ? saved : item), options);
  return saved;
}

export type GithubMcpUpdateDependencies = {
  downloadArchive?: (target: GithubSkillTarget, commit: string, signal?: AbortSignal) => Promise<{ data: Uint8Array }>;
  installNode?: (projectRoot: string) => Promise<void>;
  installPython?: (projectRoot: string, dataDir: string, signal?: AbortSignal) => Promise<string>;
  probe?: typeof probeMcpServer;
};

async function updateManagedGithubMcp(
  server: McpServerConfig,
  options: { dataDir?: string; signal?: AbortSignal; fetchImpl?: typeof fetch; force?: boolean; dependencies?: GithubMcpUpdateDependencies } = {},
): Promise<GithubMcpUpdateResult> {
  const installedSource = server.managedRepo;
  if (server.transport !== 'stdio' || !installedSource) throw new Error('这个 MCP 没有受控的 GitHub 仓库来源，不能自动更新');
  if (installedSource.autoUpdate === false && options.force !== true) {
    return { server, updated: false, latestCommit: installedSource.commit || '', checkedAt: installedSource.lastCheckedAt || 0 };
  }
  const dataDir = options.dataDir || resolveLocalDataDir();
  const now = Date.now();
  if (options.force !== true && now - (installedSource.lastCheckedAt || 0) < MCP_UPDATE_CHECK_INTERVAL_MS) {
    return { server, updated: false, latestCommit: installedSource.commit || '', checkedAt: installedSource.lastCheckedAt || 0 };
  }
  const checkedAt = Date.now();
  const versionRoot = path.join(dataDir, 'mcp', 'repos', server.id);
  let stagingRoot = '';
  try {
    if (!server.cwd || !isInside(versionRoot, server.cwd)) throw new Error('MCP 安装目录与 GitHub 来源记录不匹配，已停止更新');
    const identity = managedPackageIdentity(server);
    const latest = await resolveLatestGithubCommit(installedSource.owner, installedSource.repo, installedSource.ref, {
      signal: options.signal,
      fetchImpl: options.fetchImpl,
    });
    if (latest.sha === String(installedSource.commit || '').toLowerCase()) {
      const saved = saveManagedRepoMetadata(server, installedSource, { ref: latest.ref, lastCheckedAt: checkedAt, lastUpdateError: '' }, { dataDir });
      return { server: saved, updated: false, latestCommit: latest.sha, checkedAt };
    }

    const target: GithubSkillTarget = { owner: installedSource.owner, repo: installedSource.repo, ref: latest.ref, dir: '' };
    const archive = await (options.dependencies?.downloadArchive || downloadGithubCommitArchive)(target, latest.sha, options.signal);
    const extracted = extractMcpRepoArchive(archive.data);
    if (!packageIdentityMatches(identity, extracted)) throw new Error('GitHub 最新提交的 MCP 包名或运行时类型与当前安装不一致，已保留旧版本');

    stagingRoot = path.join(versionRoot, 'versions', `${latest.sha}-${randomUUID()}`);
    const projectRoot = path.resolve(stagingRoot, extracted.packageRoot);
    if (!isInside(stagingRoot, projectRoot)) throw new Error('GitHub 更新包的项目目录无效');
    mkdirSync(projectRoot, { recursive: true });
    writeArchiveFiles(projectRoot, extracted.files);
    let command = '';
    let args: string[] = [];
    if (extracted.kind === 'node') {
      const entryPath = path.resolve(projectRoot, packageEntry(extracted.packageJson || {}));
      if (!isInside(projectRoot, entryPath)) throw new Error('GitHub MCP 启动入口超出项目目录');
      await (options.dependencies?.installNode || ((root: string) => runNpmInstall(root)))(projectRoot);
      if (!existsSync(entryPath)) throw new Error('GitHub MCP 更新缺少启动入口，已保留旧版本');
      command = process.execPath;
      args = [entryPath];
    } else {
      const uv = await (options.dependencies?.installPython || (async (root, targetDataDir, signal) => {
        const executable = await ensureUvPath(targetDataDir, signal);
        await runUvSync(executable, root, targetDataDir);
        return executable;
      }))(projectRoot, dataDir, options.signal);
      command = uv;
      args = ['--directory', projectRoot, 'run', extracted.pythonEntry || 'mcp', 'serve'];
    }
    const probeId = `mcp-update-${randomUUID()}`;
    const candidate: McpServerConfig = { ...server, id: probeId, command, args, cwd: projectRoot };
    let probe: Awaited<ReturnType<typeof probeMcpServer>>;
    try {
      probe = await (options.dependencies?.probe || probeMcpServer)(candidate, { retry: true, signal: options.signal });
    } finally {
      closeStdioServer(probeId);
    }
    if (!probe.tools.length) throw new Error('GitHub MCP 更新后没有公布可用工具，已保留旧版本');
    const current = listMcpServers({ dataDir }).find((item) => item.id === server.id);
    if (!current?.managedRepo || !sameManagedSource(current.managedRepo, installedSource)
      || current.cwd !== server.cwd || current.command !== server.command
      || JSON.stringify(current.args) !== JSON.stringify(server.args)) {
      throw new Error('MCP 配置在更新期间发生变化，更新结果未应用');
    }
    const nextSource = {
      ...current.managedRepo,
      ref: latest.ref,
      kind: extracted.kind,
      packageName: identity.packageName,
      packageVersion: extracted.packageVersion || '',
      commit: latest.sha,
      archiveSha256: createHash('sha256').update(archive.data).digest('hex'),
      lastCheckedAt: checkedAt,
      lastUpdatedAt: checkedAt,
      lastUpdateError: '',
    } satisfies NonNullable<McpServerConfig['managedRepo']>;
    const activated: McpServerConfig = {
      ...current,
      command,
      args,
      cwd: projectRoot,
      managedRepo: nextSource,
    };
    const servers = listMcpServers({ dataDir });
    saveMcpServers(servers.map((item) => item.id === server.id ? activated : item), { dataDir });
    return { server: activated, updated: true, latestCommit: latest.sha, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'GitHub MCP 更新失败';
    if (stagingRoot) rmSync(stagingRoot, { recursive: true, force: true });
    try { saveManagedRepoMetadata(server, installedSource, { lastCheckedAt: checkedAt, lastUpdateError: message }, { dataDir }); } catch {}
    throw error instanceof Error ? error : new Error(message);
  }
}

export function updateGithubMcpFromRepo(
  server: McpServerConfig,
  options: { dataDir?: string; signal?: AbortSignal; fetchImpl?: typeof fetch; force?: boolean; dependencies?: GithubMcpUpdateDependencies } = {},
): Promise<GithubMcpUpdateResult> {
  const key = `${options.dataDir || ''}\u0000${server.id}`;
  const current = managedUpdates.get(key);
  if (current) return current;
  const pending = updateManagedGithubMcp(server, options).finally(() => managedUpdates.delete(key));
  managedUpdates.set(key, pending);
  return pending;
}

export function readManagedMcpPackage(server: McpServerConfig) {
  if (server.transport !== 'stdio' || !server.managedRepo || !server.cwd || !server.command) return null;
  const packageFile = path.join(server.cwd, 'package.json');
  if (!existsSync(packageFile)) return null;
  try { return JSON.parse(readFileSync(packageFile, 'utf8')) as Record<string, unknown>; } catch { return null; }
}
