import { unzipSync, type UnzipFileInfo } from 'fflate';
import {
  SKILL_ARCHIVE_MAX_BYTES,
  SKILL_ARCHIVE_TIMEOUT_MS,
  SKILL_FILE_MAX_BYTES,
  SKILL_FETCH_TIMEOUT_MS,
  SKILL_FILES_MAX,
  SKILL_TOTAL_MAX_BYTES,
  fetchSkillBytes,
  githubArchiveUrls,
  isReservedSkillPath,
  isSkillTextPath,
  normalizeSkillFilePath,
  shouldSkipSkillPath,
  type GithubSkillTarget,
  type SkillFileInput,
} from './skills';

/**
 * 归档解析：把 ZIP（含 GitHub 仓库归档）转换成本地技能文件列表。
 * 解压阶段先按“扫描上限”宽松放行，选定技能目录后再按技能上限严格收口，
 * 避免大型仓库因为先遇到无关文件而被提前截断。
 */

const ARCHIVE_SCAN_FILES_MAX = 900;
const ARCHIVE_SCAN_BYTES_MAX = 48 * 1024 * 1024;

export type SkillArchiveResult = {
  files: SkillFileInput[];
  document: string;
  root: string;
  roots: string[];
  warnings: string[];
};

function boundedWarnings(warnings: string[]) {
  return warnings.slice(0, 12);
}

export function skillFilesFromArchive(data: Uint8Array, options: { dir?: string } = {}): SkillArchiveResult {
  const warnings: string[] = [];
  const wantedDir = options.dir ? normalizeSkillFilePath(options.dir) : '';
  let scanBytes = 0;
  let scanCount = 0;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(data, {
      filter: (file: UnzipFileInfo) => {
        if (file.name.endsWith('/')) return false;
        const rel = normalizeSkillFilePath(file.name);
        if (!rel) { if (warnings.length < 12) warnings.push('已忽略路径不安全的条目：' + file.name.slice(0, 80)); return false; }
        if (shouldSkipSkillPath(rel) || isReservedSkillPath(rel)) return false;
        if (file.originalSize > SKILL_FILE_MAX_BYTES) { if (warnings.length < 12) warnings.push('已忽略超大文件：' + rel); return false; }
        if (scanCount >= ARCHIVE_SCAN_FILES_MAX) return false;
        if (scanBytes + file.originalSize > ARCHIVE_SCAN_BYTES_MAX) return false;
        scanCount += 1;
        scanBytes += file.originalSize;
        return true;
      },
    });
  } catch (error) {
    throw new Error('压缩包解析失败：' + (error instanceof Error ? error.message : '文件不是有效的 ZIP'));
  }

  const paths = Object.keys(unzipped);
  const roots = paths
    .filter((rel) => rel.toLowerCase() === 'skill.md' || rel.toLowerCase().endsWith('/skill.md'))
    .map((rel) => rel.slice(0, rel.length - 'SKILL.MD'.length).replace(/\/$/, ''))
    .filter((root, index, list) => list.indexOf(root) === index)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  if (!roots.length) throw new Error('压缩包里没有找到 SKILL.md');

  let root = roots[0];
  if (wantedDir) {
    const exact = roots.find((item) => item === wantedDir || item.endsWith('/' + wantedDir));
    if (exact) root = exact;
    else if (warnings.length < 12) warnings.push('未找到目录 ' + wantedDir + '，已改用 ' + (root || '压缩包根目录'));
  } else if (roots.length > 1 && warnings.length < 12) {
    warnings.push('压缩包里有 ' + roots.length + ' 个技能，已导入“' + root + '”，其余可通过链接单独导入');
  }

  const prefix = root ? root + '/' : '';
  const files: SkillFileInput[] = [];
  let total = 0;
  let skipped = 0;
  let document = '';
  for (const rel of paths.sort((a, b) => a.localeCompare(b))) {
    if (prefix && !rel.startsWith(prefix)) continue;
    const inner = prefix ? rel.slice(prefix.length) : rel;
    if (!inner) continue;
    const bytes = unzipped[rel];
    if (!bytes) continue;
    if (inner.toLowerCase() === 'skill.md') { if (!document) document = Buffer.from(bytes).toString('utf8'); continue; }
    if (isReservedSkillPath(inner)) continue;
    if (files.length >= SKILL_FILES_MAX || total + bytes.byteLength > SKILL_TOTAL_MAX_BYTES) { skipped += 1; continue; }
    total += bytes.byteLength;
    files.push(isSkillTextPath(inner) ? { path: inner, text: Buffer.from(bytes).toString('utf8') } : { path: inner, base64: Buffer.from(bytes).toString('base64') });
  }
  if (skipped) warnings.push('技能附件超过上限，已跳过 ' + skipped + ' 个文件');
  if (!document.trim()) throw new Error('压缩包里的 SKILL.md 是空文件');

  return { files, document, root, roots, warnings: boundedWarnings(warnings) };
}

export function githubRawSkillUrls(target: GithubSkillTarget) {
  const refs = [target.ref, 'HEAD', 'main', 'master'].filter((ref, index, list) => Boolean(ref) && list.indexOf(ref) === index);
  const dirs = target.dir ? [target.dir, ''] : [''];
  const urls: string[] = [];
  for (const ref of refs) {
    for (const dir of dirs) {
      urls.push('https://raw.githubusercontent.com/' + target.owner + '/' + target.repo + '/' + ref + '/' + (dir ? dir + '/' : '') + 'SKILL.md');
    }
  }
  return urls;
}
export async function fetchSkillFilesFromGithub(target: GithubSkillTarget, options: { signal?: AbortSignal } = {}) {
  for (const url of githubRawSkillUrls(target)) {
    try {
      const fetched = await fetchSkillBytes(url, { maxBytes: SKILL_FILE_MAX_BYTES, signal: options.signal, timeoutMs: SKILL_FETCH_TIMEOUT_MS });
      return {
        files: [] as SkillFileInput[],
        document: fetched.data.toString('utf8'),
        root: target.dir,
        roots: [target.dir],
        warnings: ['只导入了 SKILL.md，仓库里的其他附件没有下载'],
        sourceUrl: fetched.url,
      };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error;
    }
  }
  const urls = githubArchiveUrls(target);
  let data: Buffer | null = null;
  let sourceUrl = '';
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const result = await fetchSkillBytes(url, {
        maxBytes: SKILL_ARCHIVE_MAX_BYTES,
        accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5',
        signal: options.signal,
        timeoutMs: SKILL_ARCHIVE_TIMEOUT_MS,
      });
      data = result.data;
      sourceUrl = result.url;
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('HTTP 404')) break;
    }
  }
  if (!data) throw lastError instanceof Error ? lastError : new Error('仓库下载失败');
  const parsed = skillFilesFromArchive(data, { dir: target.dir });
  return { ...parsed, sourceUrl };
}
