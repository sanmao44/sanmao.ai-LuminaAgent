import path from 'node:path';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const INVALID_FILE_CHARS = /[<>:"/\\|?*]/g;
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE_NAME_LENGTH = 120;

export function isValidArtifactId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

/** 只取基名并剔除控制字符、路径分隔符和 Windows 保留名，防止越界写盘。 */
export function sanitizeArtifactFileName(rawName: unknown, fallback = 'artifact', allowedExtensions: readonly string[] = []) {
  const raw = typeof rawName === 'string' ? rawName : '';
  const baseName = raw.replace(/\\/g, '/').split('/').pop() || '';
  let name = baseName
    .replace(CONTROL_CHARS, '')
    .replace(INVALID_FILE_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!name) name = fallback;
  if (WINDOWS_RESERVED_NAMES.test(name)) name = `_${name}`;
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  if (name.length > MAX_FILE_NAME_LENGTH) {
    const suffix = extension.length > 0 && extension.length <= 16 ? extension : '';
    name = `${stem.slice(0, MAX_FILE_NAME_LENGTH - suffix.length)}${suffix}`.replace(/[.\s]+$/, '');
  }
  if (allowedExtensions.length) {
    const lower = name.toLowerCase();
    if (!allowedExtensions.some((item) => lower.endsWith(item))) name = `${name}${allowedExtensions[0]}`;
  }
  return name || `${fallback}${allowedExtensions[0] || ''}`;
}

/** 已知的“另一种格式”扩展名，模型写错时直接纠正，而不是叠加成 xxx.pdf.docx。 */
const KNOWN_DOCUMENT_EXTENSIONS = [
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.pdf', '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key', '.txt', '.md', '.csv', '.tsv',
];

/** Office 工具的扩展名由服务端决定，模型写错时纠正而不是原样落盘。 */
export function forceArtifactExtension(name: string, extension: string, conflictingExtensions: readonly string[] = KNOWN_DOCUMENT_EXTENSIONS) {
  const lower = name.toLowerCase();
  if (lower.endsWith(extension)) return name;
  const conflicting = conflictingExtensions.find((item) => lower.endsWith(item));
  if (conflicting) return `${name.slice(0, -conflicting.length)}${extension}`;
  return `${name}${extension}`;
}

export function resolveArtifactChild(root: string, ...segments: string[]) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('artifact 路径越界');
  return target;
}

/** ZIP 内条目只允许单层安全文件名，防 zip-slip 和绝对路径。 */
export function sanitizeArchiveEntryName(rawName: unknown, fallback = 'file') {
  const name = sanitizeArtifactFileName(rawName, fallback);
  return name.replace(/^\.+/, '').replace(/^[\\/]+/, '') || fallback;
}

export function sanitizeSheetName(rawName: unknown, index: number) {
  const raw = typeof rawName === 'string' ? rawName : '';
  const cleaned = raw
    .replace(CONTROL_CHARS, '')
    .replace(INVALID_SHEET_CHARS, '_')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

export function dedupeName(name: string, used: Set<string>) {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `${stem}-${Date.now()}${extension}`;
  used.add(fallback.toLowerCase());
  return fallback;
}
