/**
 * 从 GitHub 仓库安装 MCP 项目。
 *
 * 只接受 package.json 能识别的 Node 项目。仓库内容放到应用数据目录，依赖安装
 * 禁用 lifecycle scripts，启动时只执行解析出的入口文件；不读取 README 命令，
 * 也不把用户输入拼成 shell 命令。
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { fetchSkillBytes, githubArchiveUrls, parseGithubSkillTarget, type GithubSkillTarget } from '@/lib/skills';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { listMcpServers, normalizeMcpServerId, saveMcpServers } from './store';
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

function resolveNpmCliPath(nodePath: string = process.execPath) {
  const candidate = path.join(path.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(candidate) ? candidate : null;
}

export type GithubMcpInstallResult = {
  server: McpServerConfig;
  target: GithubSkillTarget;
  projectRoot: string;
  entry: string;
};

type ArchiveFile = { path: string; data: Uint8Array };
type ExtractedRepo = {
  kind: 'node' | 'python';
  packageRoot: string;
  files: ArchiveFile[];
  packageJson?: Record<string, unknown>;
  pythonEntry?: string;
  projectName?: string;
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
  const scriptsBlock = text.match(/\[project\.scripts\]([\s\S]*?)(?:\n\s*\[|$)/i)?.[1] || '';
  const pythonEntry = scriptsBlock.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["']/m)?.[1]?.trim() || '';
  if (!projectName || !pythonEntry) return null;
  return { projectName, pythonEntry };
}

function resolveUvPath() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(command, ['uv'], { shell: false, windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const first = String(result.stdout || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean) || '';
  return first && path.isAbsolute(first) && existsSync(first) ? first : null;
}

async function ensureUvPath(dataDir: string, signal?: AbortSignal) {
  const installed = resolveUvPath();
  if (installed) return installed;
  if (process.platform !== 'win32') throw new Error('这个 Windows MCP 只能在 Windows 上安装');
  const runtimeDir = path.join(dataDir, 'runtime', 'uv');
  const uvPath = path.join(runtimeDir, 'uv.exe');
  if (existsSync(uvPath)) return uvPath;
  const archive = await fetchSkillBytes(UV_ARCHIVE_URL, {
    maxBytes: UV_ARCHIVE_MAX_BYTES,
    accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5',
    signal,
    timeoutMs: 120_000,
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

function extractArchive(data: Uint8Array) {
  const files: ArchiveFile[] = [];
  let total = 0;
  const nodeCandidates: Array<{ path: string; data: Uint8Array; depth: number }> = [];
  const pythonCandidates: Array<{ path: string; data: Uint8Array; depth: number; projectName: string; pythonEntry: string }> = [];
  const unzipped = unzipSync(data, {
    filter: (file: UnzipFileInfo) => {
      if (file.name.endsWith('/')) return false;
      const relative = safeArchivePath(file.name);
      if (!relative || file.originalSize > REPO_FILE_MAX_BYTES || files.length >= REPO_FILES_MAX || total + file.originalSize > REPO_TOTAL_MAX_BYTES) return false;
      return true;
    },
  });
  for (const [rawPath, bytes] of Object.entries(unzipped)) {
    const relative = safeArchivePath(rawPath);
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
      files: files.filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: prefix ? file.path.slice(prefix.length) : file.path, data: file.data })),
    } satisfies ExtractedRepo;
  }
  const packageRoot = selected.path.slice(0, -'package.json'.length).replace(/\/$/, '');
  const prefix = packageRoot ? `${packageRoot}/` : '';
  return {
    kind: 'node',
    packageJson: parseJsonFile(selected.data, selected.path),
    packageRoot,
    files: files.filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: prefix ? file.path.slice(prefix.length) : file.path, data: file.data })),
  } satisfies ExtractedRepo;
}

async function downloadGithubArchive(target: GithubSkillTarget, signal?: AbortSignal) {
  let lastError: unknown = null;
  for (const url of githubArchiveUrls(target)) {
    try {
      return await fetchSkillBytes(url, { maxBytes: REPO_ARCHIVE_MAX_BYTES, accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5', signal, timeoutMs: 60_000 });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('HTTP 404')) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('GitHub 仓库下载失败');
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

function runUvSync(uvPath: string, projectRoot: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(uvPath, ['--directory', projectRoot, 'sync', '--no-dev'], {
      shell: false,
      windowsHide: true,
      cwd: projectRoot,
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
  const target = parseGithubSkillTarget(value);
  if (!target) throw new Error('请提供 GitHub 仓库地址，例如 https://github.com/owner/repo');
  const archive = await downloadGithubArchive(target, options.signal);
  const extracted = extractArchive(archive.data);
  const dataDir = options.dataDir || resolveLocalDataDir();
  const used = new Set(listMcpServers({ dataDir }).map((server) => server.id));
  const id = repoId(target, used);
  const installRoot = path.join(dataDir, 'mcp', 'repos', id);
  const projectRoot = path.resolve(installRoot, extracted.packageRoot);
  if (!isInside(installRoot, projectRoot)) throw new Error('仓库项目目录不安全');
  let pythonUvPath = '';
  if (extracted.kind === 'python') pythonUvPath = await ensureUvPath(dataDir, options.signal);
  mkdirSync(installRoot, { recursive: true });
  writeArchiveFiles(installRoot, extracted.files);
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
    await runUvSync(pythonUvPath, projectRoot);
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
    managedRepo: { owner: target.owner, repo: target.repo, ref: target.ref, url: String(value || '') },
  };
  const saved = saveMcpServers([...listMcpServers({ dataDir }).filter((item) => item.id !== id), server], { dataDir });
  return { server: saved.find((item) => item.id === id) || server, target, projectRoot, entry };
}

export function readManagedMcpPackage(server: McpServerConfig) {
  if (server.transport !== 'stdio' || !server.managedRepo || !server.cwd || !server.command) return null;
  const packageFile = path.join(server.cwd, 'package.json');
  if (!existsSync(packageFile)) return null;
  try { return JSON.parse(readFileSync(packageFile, 'utf8')) as Record<string, unknown>; } catch { return null; }
}
