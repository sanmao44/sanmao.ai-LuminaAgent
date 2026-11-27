import type { McpServerConfig } from './types';

const MAX_LINE = 20_000;
const MAX_LINES_PER_READ = 100;
const MAX_NUMBERED_CHARS = 4_000;
export const FILESYSTEM_TEXT_RANGE_ERROR = `请同时提供有效的 startLine 和 endLine，范围从 1 到 ${MAX_LINE}，最多 ${MAX_LINES_PER_READ} 行，且不与 head 或 tail 并用。`;
export const FILESYSTEM_TEXT_RANGE_EMPTY = '指定行号范围内没有可引用的行，文件可能为空或已到末尾。';

export const filesystemTextRangeProperties = {
  findText: { type: 'string', minLength: 1, maxLength: 120, description: 'Find literal text in one known file. Returns matching numbered lines and nearby lines, searching the first 20,000 lines. Do not combine with line ranges, head or tail.' },
  startLine: { type: 'integer', minimum: 1, maximum: MAX_LINE, description: 'First source line (1-based, inclusive). Use with endLine, without head or tail.' },
  endLine: { type: 'integer', minimum: 1, maximum: MAX_LINE, description: 'Last source line (inclusive). At most startLine + 99.' },
};

export function usesFilesystemTextRange(server: Pick<McpServerConfig, 'catalogId' | 'transport'>, toolName: string) {
  return server.catalogId === 'filesystem' && server.transport === 'stdio' && toolName === 'read_text_file';
}

type FilesystemTextSelection =
  | { args: Record<string, unknown>; startLine: number; endLine: number }
  | { args: Record<string, unknown>; findText: string };

export function filesystemTextRange(args: Record<string, unknown>): FilesystemTextSelection | { error: string } | null {
  const { startLine, endLine, findText, head, tail, ...rest } = args;
  if (findText !== undefined) {
    if (typeof findText !== 'string' || !findText.trim() || findText.length > 120 || /[\r\n]/.test(findText)
      || startLine !== undefined || endLine !== undefined || head !== undefined || tail !== undefined) {
      return { error: 'findText 只接受一行内的短文本，不能与 startLine、endLine、head 或 tail 并用。' };
    }
    return { args: { ...rest, head: MAX_LINE + 1 }, findText: findText.trim() };
  }
  if (startLine === undefined && endLine === undefined) return null;
  if (head !== undefined || tail !== undefined || typeof startLine !== 'number' || typeof endLine !== 'number'
    || !Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine > MAX_LINE
    || endLine < startLine || endLine - startLine >= MAX_LINES_PER_READ) {
    return { error: FILESYSTEM_TEXT_RANGE_ERROR } as const;
  }
  // The existing server still validates and opens the file. Ask for one
  // extra line to distinguish the end of the range from the end of the file.
  return { args: { ...rest, head: endLine + 1 }, startLine, endLine } as const;
}

export function formatFilesystemTextRange(content: string, selection: FilesystemTextSelection) {
  // Upstream head joins the source lines with LF, retaining a final CR in CRLF files.
  content = content.replace(/\r$/, '');
  const lines = content ? content.split(/\r?\n/) : [];
  const numbered = new Map<number, string>();
  let length = 0;
  const append = (line: number) => {
    if (numbered.has(line)) return true;
    const entry = `${line}: ${lines[line - 1]}`;
    if (length + entry.length + 1 > MAX_NUMBERED_CHARS) return false;
    numbered.set(line, entry);
    length += entry.length + 1;
    return true;
  };
  const finish = (note: string) => {
    const source = [...numbered.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry);
    if (note) source.push(note);
    return { isError: numbered.size === 0, text: source.join('\n') };
  };

  if ('findText' in selection) {
    const query = selection.findText.toLowerCase();
    const end = Math.min(lines.length, MAX_LINE);
    const matches: number[] = [];
    let firstOmittedMatch: number | undefined;
    for (let line = 1; line <= end; line += 1) {
      if (!lines[line - 1].toLowerCase().includes(query)) continue;
      if (append(line)) matches.push(line);
      else firstOmittedMatch ??= line;
    }
    const scope = lines.length > end ? `（只检查了前 ${end} 行。）` : '';
    if (!matches.length && firstOmittedMatch === undefined) {
      return { isError: false, text: `没有找到指定文本。${scope}`, fileTextEvidence: false as const };
    }
    // Spend the remaining budget on nearby source only after keeping the matches.
    for (const line of matches) {
      for (let nearby = Math.max(1, line - 2); nearby <= Math.min(end, line + 2); nearby += 1) append(nearby);
    }
    const omitted = firstOmittedMatch === undefined ? '' : `（有命中行超出返回长度，首个未返回的命中在第 ${firstOmittedMatch} 行。）`;
    return finish(`${omitted}${scope}`);
  }

  const { startLine, endLine } = selection;
  if (startLine > lines.length) return finish(FILESYSTEM_TEXT_RANGE_EMPTY);
  for (let line = startLine; line <= endLine && line <= lines.length; line += 1) {
    if (!append(line)) {
      const reason = numbered.size ? '可从该行继续读取' : '该行过长';
      return finish(`…（结果长度达到上限，从第 ${line} 行起未完整返回，${reason}。）`);
    }
  }
  return finish(lines.length <= endLine ? '（已到文件末尾。）' : '');
}
