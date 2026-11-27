import { constants, type Dirent } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { McpCallResult, McpServerConfig } from '@/packages/contracts/mcp';
import { filesystemApprovalReason, filesystemPathProblem, guardFilesystemCall } from './filesystem-policy';

const MAX_QUERY_CHARS = 120;
const MAX_FILES = 250;
const MAX_DIRECTORIES = 500;
const MAX_DEPTH = 16;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_MATCHES = 80;
const MAX_RESULT_CHARS = 7_200;
const MAX_LINE_CHARS = 500;
const MAX_SEARCH_MS = 10_000;
const MAX_DIRECTORY_ENTRIES = 2_048;
const MAX_PENDING_PATHS = 2_048;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', 'vendor', '.venv', 'venv']);

export const filesystemTextSearchSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', minLength: 1, description: 'Authorized folder or one file to search.' },
    query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_CHARS, description: 'Literal text to find, case-insensitive.' },
  },
  required: ['path', 'query'],
} as const;

export function isFilesystemTextSearchCall(server: Pick<McpServerConfig, 'catalogId' | 'transport'> | undefined, toolName: string) {
  return server?.catalogId === 'filesystem' && server.transport === 'stdio' && toolName === 'search_text';
}

type FilesystemSearchScope = { roots: readonly string[]; dataDir?: string; platform?: string };
type FilesystemSearchOptions = { signal?: AbortSignal; now?: () => number };
type PendingPath = { filePath: string; depth: number };

function searchResult(isError: boolean, text: string, fileTextEvidence?: false): McpCallResult {
  return { isError, text, ...(fileTextEvidence === false ? { fileTextEvidence } : {}) };
}

function escapeEvidenceText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (character) => {
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

function excerpt(line: string) {
  const value = escapeEvidenceText(line.trimEnd());
  return value.length > MAX_LINE_CHARS ? `${value.slice(0, MAX_LINE_CHARS)}…` : value;
}

async function hasRegularFile(filePath: string) {
  const info = await lstat(filePath).catch(() => undefined);
  return info?.isFile() === true;
}

async function isNextBuildOutput(directory: string) {
  if (!path.basename(directory).toLowerCase().startsWith('.next-')) return false;
  if (await hasRegularFile(path.join(directory, 'BUILD_ID'))
    && await hasRegularFile(path.join(directory, 'build-manifest.json'))) return true;

  const devOutput = path.join(directory, 'dev');
  const devInfo = await lstat(devOutput).catch(() => undefined);
  return devInfo?.isDirectory() === true && await hasRegularFile(path.join(devOutput, 'build-manifest.json'));
}

async function readBoundedFile(handle: Awaited<ReturnType<typeof open>>, limit: number, options: FilesystemSearchOptions, startedAt: number, now: () => number) {
  const bytes = Buffer.allocUnsafe(limit + 1);
  let offset = 0;
  while (offset < bytes.length) {
    if (options.signal?.aborted) return { cancelled: true as const };
    if (now() - startedAt >= MAX_SEARCH_MS) return { timedOut: true as const };
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return { bytes: bytes.subarray(0, offset), exceeded: offset > limit };
}

/** Search authorized local text without following links or reading protected files. */
export async function searchFilesystemText(
  args: Record<string, unknown>,
  scope: FilesystemSearchScope,
  options: FilesystemSearchOptions = {},
): Promise<McpCallResult> {
  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!rawPath || !query || query.length > MAX_QUERY_CHARS || /[\r\n\0]/.test(query)) {
    return searchResult(true, `搜索参数无效：path 必须是文件或文件夹绝对路径；query 必须是 1 到 ${MAX_QUERY_CHARS} 个字符的单行文本。`);
  }

  const guard = guardFilesystemCall({ path: rawPath }, { ...scope, toolName: 'search_text' });
  if (!guard.ok) return searchResult(true, guard.error);
  if (guard.approval) return searchResult(true, `${guard.approval}；全文搜索不会读取这类文件，请改用单文件读取并确认。`);

  const rootProblem = filesystemPathProblem(rawPath, scope);
  if (rootProblem) return searchResult(true, rootProblem);

  let root: string;
  let rootInfo;
  try {
    root = await realpath(rawPath);
    rootInfo = await stat(root);
  } catch (error) {
    return searchResult(true, error instanceof Error ? error.message : '找不到要搜索的路径。');
  }
  if (!rootInfo.isFile() && !rootInfo.isDirectory()) return searchResult(true, '只支持搜索普通文件或文件夹。');

  const needle = query.toLocaleLowerCase();
  const pending: PendingPath[] = [{ filePath: root, depth: 0 }];
  const hits: string[] = [];
  let resultChars = 0;
  let filesVisited = 0;
  let directoriesVisited = 0;
  let bytesRead = 0;
  let sensitiveSkipped = 0;
  let oversizedSkipped = 0;
  let buildOutputsSkipped = 0;
  let stoppedReason = '';
  const now = options.now ?? Date.now;
  const startedAt = now();

  while (pending.length && !stoppedReason) {
    if (options.signal?.aborted) return searchResult(true, '搜索已取消。');
    if (now() - startedAt >= MAX_SEARCH_MS) {
      stoppedReason = '搜索时间达到上限';
      break;
    }
    const current = pending.pop()!;
    const currentProblem = filesystemPathProblem(current.filePath, scope);
    if (currentProblem) continue;
    if (filesystemApprovalReason(current.filePath, scope)) {
      sensitiveSkipped += 1;
      continue;
    }

    let info;
    try {
      info = await stat(current.filePath);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      if (current.depth >= MAX_DEPTH || directoriesVisited >= MAX_DIRECTORIES) {
        stoppedReason = '目录深度或数量已到搜索上限';
        continue;
      }
      directoriesVisited += 1;
      if (current.depth > 0 && await isNextBuildOutput(current.filePath)) {
        buildOutputsSkipped += 1;
        continue;
      }
      const entries: Dirent[] = [];
      let directoryTruncated = false;
      try {
        const directory = await opendir(current.filePath);
        try {
          for await (const entry of directory) {
            if (entries.length >= MAX_DIRECTORY_ENTRIES) {
              directoryTruncated = true;
              break;
            }
            entries.push(entry);
          }
        } finally {
          await directory.close().catch(() => undefined);
        }
      } catch {
        continue;
      }
      // The stack pops from the end, so add files after directories.
      entries.sort((left, right) => {
        if (left.isFile() !== right.isFile()) return left.isFile() ? 1 : -1;
        return right.name.localeCompare(left.name);
      });
      for (const entry of entries) {
        if (stoppedReason) break;
        if (options.signal?.aborted) return searchResult(true, '搜索已取消。');
        if (pending.length >= MAX_PENDING_PATHS) {
          stoppedReason = '待搜索路径数量已到搜索上限';
          break;
        }
        if (entry.isSymbolicLink()) continue;
        const nextPath = path.join(current.filePath, entry.name);
        const pathProblem = filesystemPathProblem(nextPath, scope);
        if (pathProblem) continue;
        if (filesystemApprovalReason(nextPath, scope)) {
          sensitiveSkipped += 1;
          continue;
        }
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) pending.push({ filePath: nextPath, depth: current.depth + 1 });
        } else if (entry.isFile()) {
          pending.push({ filePath: nextPath, depth: current.depth + 1 });
        }
      }
      if (directoryTruncated && !stoppedReason) stoppedReason = '目录条目数量已到搜索上限';
      continue;
    }

    if (!info.isFile()) continue;
    if (filesVisited >= MAX_FILES) {
      stoppedReason = '文件数量已到搜索上限';
      break;
    }
    filesVisited += 1;
    if (info.size > MAX_FILE_BYTES || bytesRead + info.size > MAX_TOTAL_BYTES) {
      oversizedSkipped += 1;
      continue;
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
      handle = await open(current.filePath, flags);
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.size > MAX_FILE_BYTES || bytesRead + openedInfo.size > MAX_TOTAL_BYTES) {
        oversizedSkipped += 1;
        continue;
      }
      const remainingBytes = MAX_TOTAL_BYTES - bytesRead;
      if (remainingBytes <= 0) {
        stoppedReason = '读取总量已到搜索上限';
        continue;
      }
      const limit = Math.min(MAX_FILE_BYTES, remainingBytes);
      const read = await readBoundedFile(handle, limit, options, startedAt, now);
      if ('cancelled' in read) return searchResult(true, '搜索已取消。');
      if ('timedOut' in read) {
        stoppedReason = '搜索时间达到上限';
        break;
      }
      bytesRead += Math.min(read.bytes.byteLength, limit);
      if (read.exceeded) {
        oversizedSkipped += 1;
        continue;
      }
      const bytes = read.bytes;
      if (bytes.includes(0)) continue;
      const content = bytes.toString('utf8');
      if (!Buffer.from(content, 'utf8').equals(bytes)) continue;
      const currentRealPath = await realpath(current.filePath);
      if (filesystemPathProblem(currentRealPath, scope)) continue;
      const displayPath = rootInfo.isDirectory()
        ? path.relative(root, currentRealPath) || path.basename(currentRealPath)
        : currentRealPath;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (options.signal?.aborted) return searchResult(true, '搜索已取消。');
        if (now() - startedAt >= MAX_SEARCH_MS) {
          stoppedReason = '搜索时间达到上限';
          break;
        }
        const line = lines[index];
        if (!line.toLocaleLowerCase().includes(needle)) continue;
        const hit = `${escapeEvidenceText(displayPath)}:${index + 1}: ${excerpt(line)}`;
        if (hits.length >= MAX_MATCHES || resultChars + hit.length + 1 > MAX_RESULT_CHARS) {
          stoppedReason = '命中结果已到返回上限';
          break;
        }
        hits.push(hit);
        resultChars += hit.length + 1;
      }
    } catch {
      // Files can disappear or become unreadable while a folder is being searched.
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }

  if (options.signal?.aborted) return searchResult(true, '搜索已取消。');
  const notes = [
    sensitiveSkipped ? `跳过 ${sensitiveSkipped} 个需要单独授权的敏感文件或目录。` : '',
    oversizedSkipped ? `跳过 ${oversizedSkipped} 个超出大小限制的文件。` : '',
    buildOutputsSkipped ? `跳过 ${buildOutputsSkipped} 个 Next.js 构建目录。要搜索产物，请指定构建目录。` : '',
    stoppedReason ? `${stoppedReason}，结果可能不完整。可缩小搜索范围，指定子目录或单个文件。` : '',
  ].filter(Boolean);
  if (!hits.length) return searchResult(false, `没有找到指定文本。已检查 ${filesVisited} 个文件。${notes.length ? ` ${notes.join(' ')}` : ''}`, false);
  return searchResult(false, `找到 ${hits.length} 个命中（已检查 ${filesVisited} 个文件）：\n${hits.join('\n')}${notes.length ? `\n${notes.join('\n')}` : ''}`);
}
