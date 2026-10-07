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
  parseSkillDocument,
  skillHttpErrorMessage,
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

/** 多技能归档里的候选技能：key 用于回传 dir 精确安装，root 是它在压缩包里的完整路径。 */
export type SkillArchiveCandidate = {
  key: string;
  root: string;
  name: string;
  description: string;
};

export type SkillArchiveResult = {
  files: SkillFileInput[];
  document: string;
  root: string;
  roots: string[];
  candidates: SkillArchiveCandidate[];
  warnings: string[];
};

function boundedWarnings(warnings: string[]) {
  return warnings.slice(0, 12);
}

/** 每个根目录取“能唯一识别它的最短后缀”，用户回传这个后缀即可精确命中，不用带压缩包的仓库前缀。 */
function uniqueRootKeys(roots: string[]) {
  return roots.map((root) => {
    const segments = root.split('/').filter(Boolean);
    for (let take = 1; take <= segments.length; take += 1) {
      const suffix = segments.slice(segments.length - take).join('/');
      const matched = roots.filter((item) => item === suffix || item.endsWith('/' + suffix));
      if (matched.length === 1) return suffix;
    }
    return root;
  });
}

function documentPreview(text: string) {
  const parsed = parseSkillDocument(text);
  return { name: String(parsed.name || ''), description: String(parsed.description || '') };
}

/** 目录匹配规则：完全相等，或压缩包根路径以 /目录 结尾（带仓库前缀的归档）。 */
export function archiveRootMatches(root: string, dir: string) {
  return root === dir || root.endsWith('/' + dir);
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
        // SKILL.md 与 meta.json 是保留名，但解压阶段必须放行：后面要按 SKILL.md 定位技能根目录。
        if (shouldSkipSkillPath(rel)) return false;
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

  const rootText = (item: string) => {
    const wanted = (item ? item + '/' : '') + 'skill.md';
    const rel = paths.find((candidate) => candidate.toLowerCase() === wanted.toLowerCase());
    const bytes = rel ? unzipped[rel] : null;
    return bytes ? Buffer.from(bytes).toString('utf8') : '';
  };
  const keys = uniqueRootKeys(roots);
  const candidates: SkillArchiveCandidate[] = roots.map((item, index) => ({ key: keys[index], root: item, ...documentPreview(rootText(item)) }));

  let root = roots[0];
  if (wantedDir) {
    const exact = roots.find((item) => archiveRootMatches(item, wantedDir));
    if (exact) root = exact;
    else if (warnings.length < 12) warnings.push('未找到目录 ' + wantedDir + '，已改用 ' + (root || '压缩包根目录'));
  } else if (roots.length > 1 && warnings.length < 12) {
    warnings.push('压缩包里有 ' + roots.length + ' 个技能，未指定目录时默认选择“' + root + '”');
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

  return { files, document, root, roots, candidates, warnings: boundedWarnings(warnings) };
}

export function githubSkillDirCandidates(target: GithubSkillTarget) {
  const dir = String(target.dir || '').replace(/^\/+|\/+$/g, '');
  const segments = dir.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  const candidates = [dir];
  if (last) candidates.push('skills/' + last, last);
  candidates.push('');
  return candidates.filter((value, index, list) => list.indexOf(value) === index);
}

export function githubRawSkillUrls(target: GithubSkillTarget) {
  const refs = [target.ref, 'HEAD', 'main', 'master'].filter((ref, index, list) => Boolean(ref) && list.indexOf(ref) === index);
  const dirs = githubSkillDirCandidates(target);
  const urls: string[] = [];
  for (const ref of refs) {
    for (const dir of dirs) {
      urls.push('https://raw.githubusercontent.com/' + target.owner + '/' + target.repo + '/' + ref + '/' + (dir ? dir + '/' : '') + 'SKILL.md');
    }
  }
  return urls;
}

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_TIMEOUT_MS = 15000;

function githubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'sanmao-ai-local', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function githubRequestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function githubMatchKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function fetchGithubContents(target: GithubSkillTarget, dir: string, options: { signal?: AbortSignal } = {}) {
  const pathPart = String(dir || '').split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/');
  const query = target.ref ? '?ref=' + encodeURIComponent(target.ref) : '';
  const url = GITHUB_API_BASE + '/repos/' + encodeURIComponent(target.owner) + '/' + encodeURIComponent(target.repo) + '/contents' + (pathPart ? '/' + pathPart : '') + query;
  const response = await fetch(url, { headers: githubApiHeaders(), cache: 'no-store', signal: githubRequestSignal(options.signal, GITHUB_API_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(skillHttpErrorMessage(response.status, 'GitHub 目录接口失败'));
  return response.json() as Promise<any>;
}

async function githubEntryBytes(entry: any, options: { signal?: AbortSignal } = {}) {
  if (typeof entry?.content === 'string' && entry.content) return Buffer.from(entry.content, 'base64');
  const url = String(entry?.download_url || '');
  if (!url) return null;
  const fetched = await fetchSkillBytes(url, { maxBytes: SKILL_FILE_MAX_BYTES, signal: options.signal, timeoutMs: SKILL_FETCH_TIMEOUT_MS });
  return fetched.data;
}

async function githubEntryText(entry: any, options: { signal?: AbortSignal } = {}) {
  const bytes = await githubEntryBytes(entry, options);
  return bytes ? bytes.toString('utf8') : '';
}

async function skillFilesFromGithubListing(dir: string, listing: any[], options: { signal?: AbortSignal } = {}) {
  const documentEntry = listing.find((entry) => entry?.type === 'file' && String(entry?.name || '').toLowerCase() === 'skill.md');
  if (!documentEntry) return null;
  const document = await githubEntryText(documentEntry, options);
  if (!document.trim()) throw new Error('GitHub 上的 SKILL.md 是空文件');
  const prefix = dir ? dir + '/' : '';
  const files: SkillFileInput[] = [];
  const warnings: string[] = [];
  let total = 0;
  let skipped = 0;
  for (const entry of listing) {
    if (entry?.type !== 'file') continue;
    const rel = normalizeSkillFilePath(String(entry.path || '').slice(prefix.length));
    if (!rel || rel.toLowerCase() === 'skill.md') continue;
    if (isReservedSkillPath(rel) || shouldSkipSkillPath(rel)) continue;
    if (Number(entry.size || 0) > SKILL_FILE_MAX_BYTES || files.length >= SKILL_FILES_MAX || total >= SKILL_TOTAL_MAX_BYTES) { skipped += 1; continue; }
    try {
      const bytes = await githubEntryBytes(entry, options);
      if (!bytes) { skipped += 1; continue; }
      total += bytes.byteLength;
      files.push(isSkillTextPath(rel) ? { path: rel, text: bytes.toString('utf8') } : { path: rel, base64: bytes.toString('base64') });
    } catch { skipped += 1; }
  }
  if (skipped) warnings.push('已跳过 ' + skipped + ' 个附件');
  return { files, document, root: dir, roots: [dir], candidates: [{ key: dir, root: dir, ...documentPreview(document) }], warnings, sourceUrl: String(documentEntry.html_url || documentEntry.download_url || '') };
}

async function fetchSkillFilesFromGithubApi(target: GithubSkillTarget, options: { signal?: AbortSignal } = {}) {
  for (const dir of githubSkillDirCandidates(target)) {
    const listing = await fetchGithubContents(target, dir, options);
    if (!listing) continue;
    if (Array.isArray(listing)) {
      const parsed = await skillFilesFromGithubListing(dir, listing, options);
      if (parsed) return parsed;
      continue;
    }
    if (listing?.type === 'file' && String(listing.name || '').toLowerCase() === 'skill.md') {
      const text = await githubEntryText(listing, options);
      if (!text.trim()) throw new Error('GitHub 上的 SKILL.md 是空文件');
      return { files: [] as SkillFileInput[], document: text, root: dir, roots: [dir], candidates: [{ key: dir, root: dir, ...documentPreview(text) }], warnings: ['只导入了 SKILL.md，仓库里的其他附件没有下载'], sourceUrl: String(listing.html_url || listing.download_url || '') };
    }
  }
  const segments = String(target.dir || '').split('/').filter(Boolean);
  const wanted = githubMatchKey(segments[segments.length - 1] || '');
  if (!wanted) return null;
  for (const parent of ['skills', '']) {
    const listing = await fetchGithubContents(target, parent, options);
    if (!Array.isArray(listing)) continue;
    const match = listing.find((entry) => {
      if (entry?.type !== 'dir') return false;
      const key = githubMatchKey(String(entry.name || ''));
      return Boolean(key) && (key === wanted || key.includes(wanted));
    });
    if (!match) continue;
    const dir = String(match.path || '');
    const children = await fetchGithubContents(target, dir, options);
    if (!Array.isArray(children)) continue;
    const parsed = await skillFilesFromGithubListing(dir, children, options);
    if (parsed) return parsed;
  }
  return null;
}

export async function fetchSkillFilesFromGithub(target: GithubSkillTarget, options: { signal?: AbortSignal; dir?: string } = {}) {
  /* dir 覆盖：用户在候选列表里指定了具体技能目录时，后续所有通道都按这个目录找。 */
  const wantedDir = typeof options.dir === 'string' && options.dir ? options.dir : target.dir;
  const searchTarget: GithubSkillTarget = wantedDir === target.dir ? target : { ...target, dir: wantedDir };
  for (const url of githubRawSkillUrls(searchTarget)) {
    try {
      const fetched = await fetchSkillBytes(url, { maxBytes: SKILL_FILE_MAX_BYTES, signal: options.signal, timeoutMs: SKILL_FETCH_TIMEOUT_MS });
      const document = fetched.data.toString('utf8');
      return {
        files: [] as SkillFileInput[],
        document,
        root: searchTarget.dir,
        roots: [searchTarget.dir],
        candidates: [{ key: searchTarget.dir, root: searchTarget.dir, ...documentPreview(document) }],
        warnings: ['只导入了 SKILL.md，仓库里的其他附件没有下载'],
        sourceUrl: fetched.url,
      };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error;
    }
  }

  let apiError: unknown = null;
  try {
    const viaApi = await fetchSkillFilesFromGithubApi(searchTarget, options);
    if (viaApi) return viaApi;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason || error;
    apiError = error;
  }

  const urls = githubArchiveUrls(searchTarget);
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
  if (!data) {
    const archiveMessage = lastError instanceof Error ? lastError.message : '仓库下载失败';
    if (apiError instanceof Error) throw new Error(archiveMessage + '；GitHub 接口通道也不可用：' + apiError.message.slice(0, 120));
    throw lastError instanceof Error ? lastError : new Error('仓库下载失败');
  }
  const parsed = skillFilesFromArchive(data, { dir: searchTarget.dir });
  return { ...parsed, sourceUrl };
}
