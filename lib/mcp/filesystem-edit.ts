import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, renameSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FilesystemEditApproval, FilesystemEditUndo } from '@/packages/contracts/mcp';
import { guardFilesystemCall } from './filesystem-policy';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_CHARS = 16_000;
const STALE_EDIT = '文件在预览后已发生变化，本次没有写入。请重新生成预览再确认。';
const STALE_UNDO = '文件在这次编辑后已发生变化，撤销没有执行。请保留并核对最新内容。';
const MISSING_PREVIEW = '这条文件编辑确认缺少可核对的预览，本次没有写入。请重新发起并确认新的预览。';

type EditScope = { roots: readonly string[]; writeRoots: readonly string[]; dataDir?: string };
type Edit = { oldText: string; newText: string };
type EditResult = { isError: boolean; text: string };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function isFilesystemEditCall(server: { catalogId?: string; transport?: string } | undefined, toolName: string) {
  return server?.catalogId === 'filesystem' && server.transport === 'stdio' && toolName === 'edit_file';
}

function editTarget(args: Record<string, unknown>, scope: EditScope) {
  const raw = typeof args.path === 'string' ? args.path.trim() : '';
  const check = (target: string) => {
    const guard = guardFilesystemCall({ path: target }, { ...scope, toolName: 'edit_file' });
    if (!guard.ok) throw new Error(guard.error);
    if (guard.approval) throw new Error('这个配置文件需要单独授权读取，无法在确认前生成编辑预览。请在本地编辑器中修改。');
  };
  check(raw);
  const resolved = realpathSync.native(raw);
  check(resolved);
  return resolved;
}

function readRegularFile(target: string) {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK | constants.O_NOFOLLOW);
  const handle = openSync(target, flags);
  try {
    const info = fstatSync(handle);
    if (!info.isFile()) throw new Error('只支持编辑普通文本文件。');
    if (info.size > MAX_TEXT_BYTES) throw new Error('这个文件超过 2 MB，无法安全预览。');
    const bytes = Buffer.allocUnsafe(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(handle, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== info.size) throw new Error(STALE_EDIT);
    return { bytes: bytes.subarray(0, length), mode: info.mode & 0o777 };
  } finally {
    closeSync(handle);
  }
}

function editInstructions(value: unknown): Edit[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw new Error('每次编辑请提供 1 到 100 组原文和替换内容。');
  }
  return value.map((entry: unknown) => {
    const edit = entry as Partial<Edit> | null | undefined;
    if (typeof edit?.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string'
      || edit.oldText.length + edit.newText.length > MAX_DIFF_CHARS) {
      throw new Error('请提供可核对的原文和替换内容。');
    }
    return { oldText: edit.oldText, newText: edit.newText };
  });
}

function displayLines(prefix: string, text: string) {
  return text.split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
}

function planEdit(args: Record<string, unknown>, scope: EditScope, expected?: FilesystemEditApproval) {
  const target = editTarget(args, scope);
  if (expected && target !== expected.target) throw new Error(STALE_EDIT);
  const original = readRegularFile(target);
  const baseSha256 = sha256(original.bytes);
  if (expected && baseSha256 !== expected.baseSha256) throw new Error(STALE_EDIT);
  let text = original.bytes.toString('utf8');
  if (text.includes('\0') || !Buffer.from(text).equals(original.bytes)) {
    throw new Error('只支持可完整读取的 UTF-8 文本文件。');
  }
  const hunks = [];
  const changes: FilesystemEditUndo['changes'] = [];
  for (const { oldText, newText } of editInstructions(args.edits)) {
    const pattern = oldText.split(/\r?\n/).map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n');
    const match = new RegExp(pattern).exec(text);
    if (!match) throw new Error('没有找到完全匹配的原文，请重新读取文件后再编辑。');
    const endings = match[0].match(/\r?\n/g) || [];
    const fallback = endings.at(-1) || text.match(/\r?\n/)?.[0] || '\n';
    let lineIndex = 0;
    const replacement = newText.replace(/\r?\n/g, () => endings[lineIndex++] || fallback);
    if (replacement === match[0]) continue;
    changes.push({ offset: match.index, removed: match[0], insertedLength: replacement.length });
    const start = match.index === 0 ? 0 : text.lastIndexOf('\n', match.index - 1) + 1;
    const afterMatch = match.index + match[0].length;
    const endOfLine = text.indexOf('\n', afterMatch);
    const end = endOfLine < 0 ? text.length : Math.max(afterMatch, endOfLine - Number(text[endOfLine - 1] === '\r'));
    const before = text.slice(start, end);
    const after = text.slice(start, match.index) + replacement + text.slice(afterMatch, end);
    const line = (text.slice(0, start).match(/\n/g) || []).length + 1;
    hunks.push(`@@ 第 ${line} 行 @@\n${displayLines('-', before)}\n${displayLines('+', after)}`);
    text = text.slice(0, match.index) + replacement + text.slice(afterMatch);
  }
  const bytes = Buffer.from(text);
  if (text.includes('\0') || bytes.toString('utf8') !== text) throw new Error('替换内容必须是有效的 UTF-8 文本。');
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('修改结果超过 2 MB，请缩小范围。');
  if (bytes.equals(original.bytes)) throw new Error('这次编辑没有改动，请检查原文和替换内容。');
  const diff = `--- ${target}\n+++ ${target}\n${hunks.join('\n')}`;
  if (diff.length > MAX_DIFF_CHARS) throw new Error('编辑预览太长，请拆成较小的修改分别确认。');
  const approval = { target, baseSha256, resultSha256: sha256(bytes), diff };
  if (expected && (approval.resultSha256 !== expected.resultSha256 || approval.diff !== expected.diff)) {
    throw new Error(MISSING_PREVIEW);
  }
  return { approval, bytes, mode: original.mode, changes };
}

function errorText(error: unknown) {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') return '文件不存在或已被移走，本次没有写入。';
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') return '无法安全打开或替换文件，请检查文件是否被占用或需要权限。';
  if (code) return '无法准备或应用文件编辑，本次没有写入。';
  return error instanceof Error ? error.message : '无法准备或应用文件编辑。';
}

/** Capture the byte baseline and the preview from the same read. */
export function prepareFilesystemEdit(args: Record<string, unknown>, scope: EditScope) {
  try { return { ok: true as const, approval: planEdit(args, scope).approval }; }
  catch (error) { return { ok: false as const, error: errorText(error) }; }
}

async function replaceReviewedFile(
  args: Record<string, unknown>,
  scope: EditScope,
  input: { target: string; fromSha256: string; bytes: Buffer; mode: number; staleMessage: string; signal?: AbortSignal },
) {
  const { target, fromSha256, bytes, mode, staleMessage, signal } = input;
  const temporary = path.join(path.dirname(target), `.sanmao-edit-${randomUUID()}.tmp`);
  const staging = await open(temporary, 'wx', 0o600);
  try {
    try {
      await staging.writeFile(bytes);
      if (process.platform !== 'win32') await staging.chmod(mode);
    } finally {
      await staging.close();
    }
    signal?.throwIfAborted();
    // This detects intervening changes before the final atomic replacement. Node does not
    // expose a version-conditional rename across unrelated processes.
    if (editTarget(args, scope) !== target || sha256(readRegularFile(target).bytes) !== fromSha256) throw new Error(staleMessage);
    renameSync(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function callFilesystemEdit(args: Record<string, unknown>, scope: EditScope, options: {
  approved?: FilesystemEditApproval;
  requirePreview?: boolean;
  signal?: AbortSignal;
  captureUndo?: (change: FilesystemEditUndo) => void;
} = {}): Promise<EditResult> {
  if (options.requirePreview && !options.approved) return { isError: true, text: MISSING_PREVIEW };
  try {
    options.signal?.throwIfAborted();
    const planned = planEdit(args, scope, options.approved);
    const { target, baseSha256, resultSha256, diff } = planned.approval;
    if (args.dryRun === true) return { isError: false, text: diff };
    options.captureUndo?.({ target, baseSha256, resultSha256, changes: planned.changes });
    await replaceReviewedFile(args, scope, {
      target, fromSha256: baseSha256, bytes: planned.bytes, mode: planned.mode, signal: options.signal, staleMessage: STALE_EDIT,
    });
    return { isError: false, text: diff };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { isError: true, text: errorText(error) };
  }
}

export async function undoFilesystemEdit(change: FilesystemEditUndo, scope: EditScope, signal?: AbortSignal): Promise<EditResult> {
  try {
    signal?.throwIfAborted();
    const args = { path: change.target };
    const target = editTarget(args, scope);
    if (target !== change.target) throw new Error(STALE_UNDO);
    const current = readRegularFile(target);
    if (sha256(current.bytes) !== change.resultSha256) throw new Error(STALE_UNDO);
    let text = current.bytes.toString('utf8');
    for (const { offset, removed, insertedLength } of [...change.changes].reverse()) {
      text = text.slice(0, offset) + removed + text.slice(offset + insertedLength);
    }
    const original = Buffer.from(text);
    if (sha256(original) !== change.baseSha256) throw new Error('无法核对撤销记录，文件保持原样。');
    await replaceReviewedFile(args, scope, {
      target, fromSha256: change.resultSha256, bytes: original, mode: current.mode, signal, staleMessage: STALE_UNDO,
    });
    return { isError: false, text: '已撤销这次文件编辑。' };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { isError: true, text: errorText(error) };
  }
}
