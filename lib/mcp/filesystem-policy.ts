/**
 * Filesystem / 浏览器上传的路径策略——本机这一侧的最后一层。
 *
 * 为什么不能只依赖 MCP 服务自己的 allowed-directories：那条限制证明的是「服务没越界」，
 * 而我们要知道的是「模型这次要动的路径，正好是用户在面板里授权过的那棵树」。
 * 两端各做一遍，任何一端出问题都不会变成「整块硬盘可读」。任务是：
 * - 只接受绝对路径（服务端也按自己的 cwd 解析相对路径，给相对路径必然出错，不如直接说清）；
 * - realpath 后再做包含判断：挡住 `..`、符号链接、Windows junction / reparse point；
 * - 大小写不敏感文件系统按同一规则比较；
 * - 凭据、私钥、浏览器 profile 这类文件一律拒绝，即使它们在授权目录里。
 *
 * 已知限制（写在这里，免得以后误以为这层是万能的）：校验和真正读取之间仍有 TOCTOU 窗口，
 * 恶意服务可以在这一步之后把路径换成软链。要彻底消除只能把文件读写也搬到本机进程里做，
 * Catalog v1 不做。
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { isPathInside } from './filesystem-roots';

/** 这几个参数名在 Filesystem MCP 的工具表里指的是路径（实测 @modelcontextprotocol/server-filesystem@2026.8.31）。 */
export const MCP_FILESYSTEM_PATH_KEYS = ['path', 'paths', 'source', 'destination', 'target', 'from', 'to'] as const;

/**
 * 会改动磁盘的 Filesystem 工具。这些工具除了「路径在授权目录里」，还要求那个目录
 * 打开了写入：只读授权只换到读权限，不该顺带把写也放了。
 */
export const MCP_FILESYSTEM_WRITE_TOOLS: readonly string[] = ['write_file', 'edit_file', 'create_directory', 'move_file'];

/**
 * 默认 DENY：私钥、凭据库、云厂商/SSH 配置、Git 内部文件。
 * 这些文件一旦被读进来就会进入对话上下文并可能被上传到模型服务商，不存在「顺手读一下」的正当场景。
 */
const DENIED_PATH_SEGMENTS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.git', '.password-store']);
const DENIED_FILE_PATTERNS: readonly RegExp[] = [
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^.*\.(pem|key|p12|pfx|ppk|jks|keystore|kdbx)$/i,
  /^\.git-credentials$/i,
  /^\.?_?netrc$/i,
  /^credentials(\.json|\.ini)?$/i,
  /^application_default_credentials\.json$/i,
  /^shadow$/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
];

/**
 * 需要用户额外确认才能读的敏感配置（任务书 §42）：不是「永远不给」，而是不能默默读。
 * 命中后这一轮会停下来等用户点确认，确认记录里带着具体文件路径。
 */
const APPROVAL_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.envrc$/i,
  /^secrets?\.(json|ya?ml|toml|txt)$/i,
  /^.*\.(token|secrets?)$/i,
];

/** 系统密码/凭据库目录：命中直接拒绝，不给确认入口。 */
const SYSTEM_SECRET_DIRS = ['/etc/shadow', '/etc/sudoers', '/etc/ssl/private'];
/** Windows 本机的 SAM/SECURITY 数据库目录（大小写无关，单独判）。 */
const WINDOWS_SECRET_DIR = 'c:\windows\system32\config';

function realpath(value: string) {
  return realpathSync.native ? realpathSync.native(value) : realpathSync(value);
}

/**
 * 目标可能还不存在（write_file / create_directory），所以从最深的存在祖先一路 realpath 上来。
 * 这样「软链目录 + 全新文件名」这种绕法也会被算进软链的真实位置。
 */
function resolveForPolicy(target: string) {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = realpath(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.push(path.basename(current));
    current = parent;
  }
  return path.resolve(target);
}

function segmentsOf(target: string, platform: string) {
  return path.resolve(target).split(/[\\/]+/).filter(Boolean).map((part) => (platform === 'win32' ? part.toLowerCase() : part));
}

function deniedSegmentProblem(resolved: string, platform: string) {
  const segments = segmentsOf(resolved, platform);
  for (const segment of segments) {
    if (DENIED_PATH_SEGMENTS.has(segment)) return `这个路径属于凭据/私钥目录（${segment}），助手不能访问`;
  }
  for (const prefix of SYSTEM_SECRET_DIRS) {
    if (isPathInside(resolved, prefix, platform)) return '这是系统密码目录，助手不能访问';
  }
  if (platform === 'win32' && isPathInside(resolved, WINDOWS_SECRET_DIR, platform)) return '这是系统密码目录，助手不能访问';
  return '';
}

/**
 * 单个路径的拒绝原因；返回 null 表示这一层通过。
 * roots 为空时一律拒绝：没有授权目录就不该有任何文件被读到。
 */
export function filesystemPathProblem(
  target: unknown,
  options: { roots: readonly string[]; dataDir?: string; platform?: string },
): string | null {
  const platform = options.platform || process.platform;
  const raw = String(target ?? '').trim();
  if (!raw) return '路径不能为空';
  if (!path.isAbsolute(raw)) return `只接受绝对路径，收到的是「${raw}」；请用授权文件夹里的完整路径`;
  const roots = options.roots;
  if (!roots.length) return '还没有授权任何文件夹，先在「MCP 服务」面板里给「本地文件」添加一个目录';
  const resolved = resolveForPolicy(raw);
  if (!roots.some((root) => isPathInside(resolved, root, platform))) {
    return `这个路径不在授权文件夹里：${raw}；当前授权：${roots.join('、')}`;
  }
  if (options.dataDir && isPathInside(resolved, options.dataDir, platform)) {
    return '这是应用自己的数据目录（里面存着凭据和配置），助手不能读；请换一个普通文件夹授权';
  }
  const segmentProblem = deniedSegmentProblem(resolved, platform);
  if (segmentProblem) return segmentProblem;
  const base = path.basename(resolved);
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(base)) return `这是凭据/私钥类文件（${base}），助手默认不读取`;
  }
  return null;
}

/** 命中敏感配置时返回给用户看的理由；返回 null 表示不需要额外确认。 */
export function filesystemApprovalReason(target: unknown, options: { roots: readonly string[]; dataDir?: string; platform?: string }): string | null {
  const raw = String(target ?? '').trim();
  if (!raw) return null;
  const resolved = resolveForPolicy(raw);
  const base = path.basename(resolved);
  for (const pattern of APPROVAL_FILE_PATTERNS) {
    if (pattern.test(base)) return `要读取敏感配置文件 ${base}`;
  }
  return null;
}

export type McpCallGuardDecision =
  | { ok: true; args: Record<string, unknown>; approval: string | null }
  | { ok: false; error: string };

/**
 * 写工具的额外一道：目标必须落在勾了「写入」的目录里。
 * 只读授权只换到读权限，写文件和读文件是两件事，不能顺手一起放行。
 */
function filesystemWriteProblem(
  target: unknown,
  options: { writeRoots?: readonly string[]; platform?: string },
): string | null {
  const platform = options.platform || process.platform;
  const raw = String(target ?? '').trim();
  const writeRoots = options.writeRoots || [];
  const resolved = resolveForPolicy(raw);
  if (writeRoots.some((root) => isPathInside(resolved, root, platform))) return null;
  if (!writeRoots.length) return '还没有任何授权目录打开写入：先在「MCP 服务」面板里给「本地文件」的目录勾上「写入」，助手才能改文件';
  return `这个路径不在任何「可写入」的授权目录里：${raw}；要写文件得先在面板里给对应目录勾上「写入」（当前可写：${writeRoots.join('、')}）`;
}

function asArgs(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/**
 * Filesystem 工具的入参检查。命中的第一个问题就返回：一次说清一个问题，
 * 模型改起来比面对一长串错误容易。
 *
 * toolName 是可选的：给了才知道这次是不是写工具（写工具要额外落在可写目录里）。
 */
export function guardFilesystemCall(
  args: unknown,
  options: { roots: readonly string[]; dataDir?: string; platform?: string; toolName?: string; writeRoots?: readonly string[] },
): McpCallGuardDecision {
  const input = asArgs(args);
  const roots = options.roots;
  const writeTool = options.toolName ? MCP_FILESYSTEM_WRITE_TOOLS.includes(options.toolName) : false;
  let approval: string | null = null;
  for (const key of MCP_FILESYSTEM_PATH_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (typeof item !== 'string') return { ok: false, error: `参数 ${key} 必须是文件路径字符串` };
      const problem = filesystemPathProblem(item, { roots, dataDir: options.dataDir, platform: options.platform });
      if (problem) return { ok: false, error: problem };
      // 写工具还要落进「已勾写入」的目录：move_file 的 source / destination 两边都要过。
      if (writeTool) {
        const writeProblem = filesystemWriteProblem(item, options);
        if (writeProblem) return { ok: false, error: writeProblem };
      }
      approval = approval || filesystemApprovalReason(item, { roots, dataDir: options.dataDir, platform: options.platform });
    }
  }
  return { ok: true, args: input, approval };
}

/** 浏览器上传的来源白名单（任务书 §43）：授权目录 + 应用自己产出的文件。 */
export function uploadSourceDirs(options: { roots: readonly string[]; dataDir?: string }) {
  const dirs = [...options.roots];
  if (options.dataDir) {
    dirs.push(path.join(options.dataDir, 'media'), path.join(options.dataDir, 'browser', 'downloads'));
  }
  return dirs;
}

/**
 * browser_file_upload 只能上传「本机产出的文件」或用户在授权目录里挑的文件。
 * 不能因为 Filesystem 有授权目录，就让浏览器把整棵树里的任意文件传出去。
 */
export function guardUploadCall(args: unknown, options: { roots: readonly string[]; dataDir?: string; platform?: string }): McpCallGuardDecision {
  const input = asArgs(args);
  const files = input.paths ?? input.path;
  const list = Array.isArray(files) ? files : files === undefined || files === null ? [] : [files];
  if (!list.length) return { ok: false, error: '没有要上传的文件路径' };
  const allowed = uploadSourceDirs(options);
  if (!allowed.length) return { ok: false, error: '上传前需要先授权一个文件夹：「MCP 服务」面板里给「本地文件」添加目录' };
  for (const item of list) {
    if (typeof item !== 'string') return { ok: false, error: '参数 paths 必须是文件路径字符串' };
    const raw = item.trim();
    if (!path.isAbsolute(raw)) return { ok: false, error: `上传只接受绝对路径，收到的是「${raw}」` };
    const resolved = resolveForPolicy(raw);
    const platform = options.platform || process.platform;
    if (!allowed.some((dir) => isPathInside(resolved, dir, platform))) {
      return { ok: false, error: `这个文件不在允许上传的范围里：${raw}；只能上传授权文件夹或助手自己生成的文件` };
    }
    const segmentProblem = deniedSegmentProblem(resolved, platform);
    if (segmentProblem) return { ok: false, error: segmentProblem };
    const base = path.basename(resolved);
    // 上传比读取更危险：读 .env 还能让用户确认，传出去就收不回来了，所以两类模式一律拒绝。
    for (const pattern of [...DENIED_FILE_PATTERNS, ...APPROVAL_FILE_PATTERNS]) {
      if (pattern.test(base)) return { ok: false, error: `这是凭据/私钥类文件（${base}），不能上传` };
    }
  }
  return { ok: true, args: input, approval: null };
}

/**
 * 服务级入口：调用方只要给「哪个服务的哪个工具、参数是什么」，由这里判断要不要检查。
 * 非受控服务（用户自己配的远程服务）不在职责范围内，原样放行。
 */
export function guardMcpServerCall(
  server: { id?: string; catalogId?: string } | null | undefined,
  toolName: string,
  args: unknown,
  options: { roots: readonly string[]; dataDir?: string; platform?: string; writeRoots?: readonly string[] },
): McpCallGuardDecision {
  const catalogId = String(server?.catalogId || server?.id || '');
  if (catalogId === 'filesystem') return guardFilesystemCall(args, { ...options, toolName: String(toolName) });
  if (catalogId === 'playwright' && String(toolName) === 'browser_file_upload') return guardUploadCall(args, options);
  return { ok: true, args: asArgs(args), approval: null };
}
