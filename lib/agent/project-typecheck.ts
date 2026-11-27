import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type {
  AgentProjectTypecheckPort,
  AgentProjectTypecheckRequest,
  AgentProjectTypecheckResult,
  AgentProjectTypecheckSelection,
} from '@/packages/contracts/agent';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { filesystemPathProblem } from '@/lib/mcp/filesystem-policy';
import { listFilesystemRoots } from '@/lib/mcp/filesystem-roots';

const TYPECHECK_TIMEOUT_MS = 120_000;
const TYPECHECK_OUTPUT_LIMIT_BYTES = 64 * 1024;
const WINDOWS_ENVIRONMENT_KEYS = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'] as const;
const POSIX_ENVIRONMENT_KEYS = ['TMPDIR', 'LANG', 'LC_ALL'] as const;
const DIRECTORY_HINT = '请提供一个已授权项目目录的绝对路径，路径含空格时请加引号。';

type AuthorizedRoot = { supplied: string; canonical: string };
type TypecheckDependencies = { listAuthorizedRoots?: () => readonly string[] };

function fullyQualified(candidate: string) {
  if (process.platform !== 'win32') return path.isAbsolute(candidate);
  // Windows considers a path rooted at the current drive absolute as well.
  return /^[a-z]:[\\/]/i.test(candidate) || /^[\\/]{2}[^?.\\/][^\\/]*[\\/][^\\/]+/u.test(candidate);
}

function isPathInside(target: string, parent: string) {
  const relative = path.relative(parent, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizedRoots(roots: readonly string[]) {
  return roots.flatMap((root): AuthorizedRoot[] => {
    if (!fullyQualified(root)) return [];
    try {
      const supplied = path.resolve(root);
      const canonical = realpathSync.native(supplied);
      if (!statSync(canonical).isDirectory() || canonical === path.parse(canonical).root) return [];
      return [{ supplied, canonical }];
    } catch {
      return [];
    }
  });
}

function validateProjectDirectory(directory: string, roots: readonly AuthorizedRoot[]): AgentProjectTypecheckSelection {
  const raw = typeof directory === 'string' ? directory.trim() : '';
  if (!raw || !fullyQualified(raw)) return { ok: false, reason: DIRECTORY_HINT };
  if (!roots.length) return { ok: false, reason: '还没有授权任何项目文件夹。请先在「本地文件」工具中授权项目目录。' };

  const denied = '项目目录不在当前授权文件夹内，请先授权项目目录或其父文件夹。';
  const absolute = path.resolve(raw);
  if (!roots.some(({ supplied, canonical }) => isPathInside(absolute, supplied) || isPathInside(absolute, canonical))) {
    return { ok: false, reason: denied };
  }

  let resolved: string;
  try {
    resolved = realpathSync.native(absolute);
  } catch {
    return { ok: false, reason: '在授权文件夹内找不到指定的项目目录。' };
  }

  const matchingRoots = roots.filter(({ canonical }) => isPathInside(resolved, canonical));
  if (!matchingRoots.length) return { ok: false, reason: denied };
  const scope = { roots: matchingRoots.map(({ canonical }) => canonical), dataDir: resolveLocalDataDir() };
  const pathProblem = filesystemPathProblem(resolved, scope);
  if (pathProblem) return { ok: false, reason: pathProblem };

  try {
    if (!statSync(resolved).isDirectory()) return { ok: false, reason: '项目路径不是文件夹。' };
    const config = realpathSync.native(path.join(resolved, 'tsconfig.json'));
    if (!isPathInside(config, resolved)) return { ok: false, reason: '项目 tsconfig.json 指向了项目目录之外，已拒绝执行。' };
    if (!statSync(config).isFile() || filesystemPathProblem(config, scope)) {
      return { ok: false, reason: '项目 tsconfig.json 必须是项目内可访问的普通文件。' };
    }
    return { ok: true, directory: resolved };
  } catch {
    return { ok: false, reason: '项目目录中找不到 tsconfig.json。' };
  }
}

const QUOTED_TEXT = /"[^"\r\n]+"|(?<![\w])'[^'\r\n]+'|`[^`\r\n]+`|“[^”\r\n]+”|‘[^’\r\n]+’|「[^」\r\n]+」|『[^』\r\n]+』/gu;
const BARE_PATH = /(?<![\w.\/\\:@%+-])(?:[a-z]:|(?:\.{1,2}|~)?[\\/])[^\s"'`“”‘’「」『』<>|?*，。；：！？、（）【】,;!?()[\]{}]*/giu;
const PATH_LIKE = /^(?:[a-z]:|[\\/]|(?:\.{1,2}|~)(?:[\\/]|$))|^[^\s]+[\\/][^\s]+$/iu;
const AFTER_BARE_PATH = /^\s*(?:$|[，。；：！？、,;()\]】]|[!?](?=\s|$)|(?:中|里|内)?(?:执行|运行|请求|跑|做|目录|文件夹|仓库|工作区)|(?:run|execute|typecheck|once|please)\b|and\s+(?:return|report|show|print)\b)/iu;
const IMPLICIT_SCOPE = /^(?:(?:这[个里]|此|本|该|当前|目前|默认|(?:当前)?(?:已)?授权|(?:已)?选[中择])(?:的)?\s*)?(?:工作区|工作目录|项目(?:根)?目录|文件夹|目录|项目|仓库)$|^(?:这里|当前|(?:the\s+)?(?:(?:current|authorized|selected|local|default)\s+)?(?:project|workspace|working directory|directory|folder|repository)|here)$/iu;

function requestedDirectory(instruction: string): { directory?: string; reason?: string } {
  const quoted: string[] = [];
  const prose = instruction.replace(QUOTED_TEXT, (text) => {
    const value = text.slice(1, -1).trim();
    if (PATH_LIKE.test(value)) quoted.push(value);
    return ' '.repeat(text.length);
  });
  const bare = [...prose.matchAll(BARE_PATH)];
  const candidates = [...quoted, ...bare.map((match) => match[0].replace(/(?<=[\p{L}\p{N}])\.$/u, ''))];
  const seen = new Map(candidates.map((candidate) => [
    fullyQualified(candidate) && process.platform === 'win32' ? path.normalize(candidate).toLowerCase() : candidate,
    candidate,
  ]));
  if (seen.size > 1) return { reason: `检测到多个路径。${DIRECTORY_HINT}` };
  if (bare.some((match) => !AFTER_BARE_PATH.test(instruction.slice(match.index + match[0].length)))) {
    return { reason: `无法辨认完整的项目路径。${DIRECTORY_HINT}` };
  }
  // Handle a named scope before or after the command. Only generic references
  // like "current project" can use the single-project default.
  const scopes = [
    /(?:^|[\s，,。；;：:请只仅])(?:在|从|切到|进入)\s*([^\r\n，,。；;]+?)\s*(?:中|里|内)?\s*(?=(?:运行|执行|跑|做))/u,
    /\btype[\s-]?check\b["'`]?\s*(?:[，,]\s*)?(?:在|从|(?:in|under)\b)\s*([^\r\n，,。；;]+)/iu,
    /\b(?:in|under)\s+([^\r\n，,。；;]+?)\s*[,，]?\s+(?=(?:please\s+)?(?:run|execute)\b)/iu,
    /(?:\bcwd\b|工作目录|项目目录|项目路径|目录)\s*[:：=]\s*([^\r\n，,。；;]+)/iu,
    /(?:\bcd\s+|--project(?:\s+|=))(\S+)/iu,
  ];
  for (const scope of scopes) {
    const name = instruction.match(scope)?.[1]?.trim().replace(/^["'`“‘「『]|["'`”’」』]$/gu, '').trim();
    if (name && !IMPLICIT_SCOPE.test(name) && !candidates.some((candidate) => name.includes(candidate))) {
      return { reason: DIRECTORY_HINT };
    }
  }
  return seen.size ? { directory: seen.values().next().value } : {};
}

function selectDirectory({ instruction, cwd, authorizedRoots }: Parameters<AgentProjectTypecheckPort['selectDirectory']>[0]): AgentProjectTypecheckSelection {
  const requested = requestedDirectory(instruction);
  if (requested.reason) return { ok: false, reason: requested.reason };
  const roots = normalizedRoots(authorizedRoots);
  if (requested.directory !== undefined) return validateProjectDirectory(requested.directory, roots);
  if (!roots.length) return { ok: false, reason: '还没有授权任何项目文件夹。请先在「本地文件」工具中授权项目目录。' };

  const projects = new Set<string>();
  for (const candidate of [cwd, ...roots.map(({ canonical }) => canonical)]) {
    const project = validateProjectDirectory(candidate, roots);
    if (project.ok) projects.add(project.directory);
  }
  if (projects.size === 1) return { ok: true, directory: [...projects][0] };
  const reason = projects.size ? '有多个符合条件的项目，无法确定要检查哪一个。' : '没有找到可自动选用的项目。';
  return { ok: false, reason: `${reason}${DIRECTORY_HINT}` };
}

function trustedCompilerPath() {
  // The Windows and macOS launchers start Node from the app's own directory.
  const appRoot = realpathSync.native(process.cwd());
  // Next's server bundler cannot statically resolve createRequire() when it
  // receives a runtime path and can rewrite it to an undefined shim. Resolve
  // through Node's built-in module API at runtime instead.
  const moduleApi = process.getBuiltinModule('node:module');
  if (!moduleApi) throw new Error('Node.js module API is unavailable.');
  const appRequire = moduleApi.createRequire(path.join(appRoot, 'package.json'));
  const compiler = realpathSync.native(appRequire.resolve('typescript/lib/tsc.js'));
  if (!isPathInside(compiler, appRoot) || !statSync(compiler).isFile()) {
    throw new Error('应用自带的 TypeScript 编译器不可用。');
  }
  return compiler;
}

function compilerEnvironment() {
  const keys = process.platform === 'win32' ? WINDOWS_ENVIRONMENT_KEYS : POSIX_ENVIRONMENT_KEYS;
  const entries = keys.flatMap((key) => {
    const value = process.env[key];
    return value === undefined ? [] : [[key, value] as const];
  });
  return { NODE_ENV: 'production' as const, NODE_DISABLE_COMPILE_CACHE: '1', ...Object.fromEntries(entries) };
}

function captureOutput(stream: Readable) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  stream.on('data', (chunk: Buffer) => {
    const accepted = chunk.subarray(0, TYPECHECK_OUTPUT_LIMIT_BYTES - bytes);
    if (accepted.length) chunks.push(accepted);
    bytes += accepted.length;
    if (accepted.length < chunk.length) truncated = true;
  });
  return () => {
    const buffer = Buffer.concat(chunks, bytes);
    const text = truncated ? new StringDecoder('utf8').write(buffer) : buffer.toString('utf8');
    return { text, truncated };
  };
}

function typecheckResult(directory: string, fields: Partial<AgentProjectTypecheckResult> = {}): AgentProjectTypecheckResult {
  return {
    directory,
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    timedOut: false,
    cancelled: false,
    outputTruncated: false,
    ...fields,
  };
}

function runCompiler(directory: string, compiler: string, signal?: AbortSignal): Promise<AgentProjectTypecheckResult> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    let scratch = '';
    try {
      // Redirect all optional compiler output outside the project and clean it up afterwards.
      scratch = mkdtempSync(path.join(os.tmpdir(), 'sanmao-agent-typecheck-'));
child = spawn(process.execPath, [
        compiler, '--project', directory, '--pretty', 'false', '--noEmit', '--noCheck', 'false',
        // A project's composite and tracing options can otherwise write despite --noEmit.
        '--incremental', 'false', '--composite', 'false',
        '--tsBuildInfoFile', path.join(scratch, 'tsconfig.tsbuildinfo'),
        '--generateTrace', path.join(scratch, 'trace'),
        '--generateCpuProfile', path.join(scratch, 'tsc.cpuprofile'),
      ], { cwd: directory, env: compilerEnvironment(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      resolve(typecheckResult(directory, { error: '无法启动本地 TypeScript 检查。' }));
      return;
    }

    const readStdout = captureOutput(child.stdout);
    const readStderr = captureOutput(child.stderr);
    let stopped: 'timeout' | 'cancel' | undefined;
    let processError = false;
    const stop = (kind: 'timeout' | 'cancel') => {
      if (stopped || child.exitCode !== null || child.signalCode !== null) return;
      stopped = kind;
      try { child.kill('SIGKILL'); } catch { processError = true; }
    };
    const abort = () => stop('cancel');
    const timer = setTimeout(() => stop('timeout'), TYPECHECK_TIMEOUT_MS);
    child.once('error', () => { processError = true; });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const stdout = readStdout();
      const stderr = readStderr();
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      const error = stopped === 'timeout' ? `TypeScript 检查超过 ${TYPECHECK_TIMEOUT_MS / 1000} 秒，已终止。`
        : stopped === 'cancel' ? '执行已取消。'
          : processError || exitCode === null ? '本地 TypeScript 检查进程未正常结束。' : undefined;
      resolve(typecheckResult(directory, {
        exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut: stopped === 'timeout',
        cancelled: stopped === 'cancel',
        outputTruncated: stdout.truncated || stderr.truncated,
        ...(error ? { error } : {}),
      }));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function createProjectTypecheckPort(options: TypecheckDependencies = {}): AgentProjectTypecheckPort {
  const getAuthorizedRoots = options.listAuthorizedRoots || (() => listFilesystemRoots());
  const validateDirectory = (directory: string, roots: readonly string[]) => validateProjectDirectory(directory, normalizedRoots(roots));

  return {
    listAuthorizedRoots: getAuthorizedRoots,
    selectDirectory,
    validateDirectory,
    run: async (input: AgentProjectTypecheckRequest, { signal } = {}) => {
      if (signal?.aborted) return typecheckResult(input.directory, { cancelled: true, error: '执行已取消。' });
      const checked = validateDirectory(input.directory, getAuthorizedRoots());
      if (!checked.ok) return typecheckResult(input.directory, { error: checked.reason });
      if (path.relative(input.directory, checked.directory)) {
        return typecheckResult(input.directory, { error: '项目目录已指向另一个位置，请重新确认。' });
      }
      let compiler: string;
      try {
        compiler = trustedCompilerPath();
      } catch {
        return typecheckResult(checked.directory, { error: '应用自带的 TypeScript 编译器不可用。' });
      }
      return runCompiler(checked.directory, compiler, signal);
    },
  };
}