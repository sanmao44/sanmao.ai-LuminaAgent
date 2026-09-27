import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAdminRequest } from '@/lib/auth';
import { createBackupArchive, extractBackupArchive, sha256, type BackupArchiveEntry } from '@/lib/backup-archive';
import { decryptBackupPayload, encryptBackupPayload, isEncryptedBackup, validateBackupPassword } from '@/lib/backup-crypto';
import { getDefaultStoragePath } from '@/lib/image-storage';
import { getDefaultAudioStoragePath } from '@/lib/audio-storage';
import { getDefaultVideoStoragePath } from '@/lib/video-storage';
import { createLocalSnapshot } from '@/lib/local-snapshots';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import { listInstalledSkillDirs, listSkillFilesForBackup, resolveSkillArchivePath, resolveSkillsDir, shouldSkipSkillPath } from '@/lib/skills';
import { resolveLocalDataDir, resolveProviderConfigDir } from '@/lib/data-paths';
import { validateWorkspaceShape } from '@/lib/workspace-format';

export const runtime = 'nodejs';

const dataDir = resolveLocalDataDir();
const providerConfigDir = resolveProviderConfigDir();
const statePath = path.join(providerConfigDir, 'state.json');
const keyPath = path.join(providerConfigDir, 'master.key');
const maxClientBytes = 80 * 1024 * 1024;
const maxArchiveBytes = 2 * 1024 * 1024 * 1024;
const workspacePath = path.join(dataDir, 'workspace.json');
const DURABLE_DATA_FILES = ['video-tasks.json', 'upscale-tasks.json', 'clone-jobs.json'] as const;

async function readOptional(file: string) {
  try { return await readFile(file); } catch { return Buffer.alloc(0); }
}

async function writeAtomic(file: string, content: Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${Date.now()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, file);
}

async function listFiles(root: string): Promise<string[]> {
  try {
    const result: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) result.push(...await listFiles(target));
      else if (entry.isFile()) result.push(target);
    }
    return result;
  } catch { return []; }
}

function jsonBuffer(value: unknown) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

type BackupState = {
  schemaVersion?: number;
  providers: Array<Record<string, any>>;
  models: unknown[];
  settings: Record<string, any>;
  webSearch?: Record<string, any>;
  upscaleConnections?: Array<Record<string, any>>;
};

function validateState(raw: Buffer): BackupState {
  const parsed = JSON.parse(raw.toString('utf8')) as BackupState;
  if (!parsed || !Array.isArray(parsed.providers) || !Array.isArray(parsed.models) || !parsed.settings || typeof parsed.settings !== 'object') throw new Error('备份中的服务端配置格式无效');
  return parsed;
}

function stripStateSecrets(state: BackupState): BackupState {
  const stripEncryptedFields = (value: Record<string, any>) => Object.fromEntries(
    Object.entries(value).filter(([key]) => !key.startsWith('encrypted')),
  );
  return {
    ...state,
    providers: state.providers.map(stripEncryptedFields),
    webSearch: state.webSearch ? { provider: state.webSearch.provider } : undefined,
    upscaleConnections: Array.isArray(state.upscaleConnections)
      ? state.upscaleConnections.map(stripEncryptedFields)
      : state.upscaleConnections,
  } as BackupState;
}

function pickStateSecrets(value: Record<string, any>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith('encrypted')));
}

function isImageFile(file: string) {
  return /\.(png|jpe?g|webp)$/i.test(file);
}

function fileNameFromPath(file: string) {
  return file.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
}

async function appendDirectory(entries: BackupArchiveEntry[], root: string, prefix: string) {
  const resolvedRoot = path.resolve(root);
  for (const file of await listFiles(resolvedRoot)) {
    const relative = fileNameFromPath(path.relative(resolvedRoot, file));
    if (relative) entries.push({ name: `${prefix}/${relative}`, data: await readFile(file) });
  }
}

function isMediaFile(file: string, kind: 'images' | 'videos' | 'audio') {
  const patterns = {
    images: /\.(png|jpe?g|webp)$/i,
    videos: /\.(mp4|webm|mov|m4v|ogv)$/i,
    audio: /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i,
  } as const;
  return patterns[kind].test(file);
}

async function appendMediaDirectory(entries: BackupArchiveEntry[], root: string, folder: 'images' | 'videos' | 'audio') {
  const resolvedRoot = path.resolve(root);
  for (const file of await listFiles(resolvedRoot)) {
    const relative = fileNameFromPath(path.relative(resolvedRoot, file));
    if (relative && isMediaFile(relative, folder)) entries.push({ name: `${folder}/${relative}`, data: await readFile(file) });
  }
}

type BackupMode = 'content' | 'complete';

async function exportArchive(client: unknown, mode: BackupMode) {
  const includeSecrets = mode === 'complete';
  const stateRaw = await readOptional(statePath);
  const rawState = stateRaw.length ? validateState(stateRaw) : { schemaVersion: 2, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } };
  const state = includeSecrets ? rawState : stripStateSecrets(rawState);
  const configuredImagePath = String(state.settings?.imageStoragePath || '');
  const configuredVideoPath = String((state.settings as Record<string, unknown>)?.videoStoragePath || '');
  const entries: BackupArchiveEntry[] = [
    { name: 'server/state.json', data: jsonBuffer(state) },
    { name: 'client/client.json', data: jsonBuffer(client || {}) },
  ];
  const workspace = await readOptional(workspacePath);
  if (workspace.length) entries.push({ name: 'server/workspace.json', data: workspace });
  const masterKey = await readOptional(keyPath);
  if (includeSecrets && masterKey.length) entries.push({ name: 'server/master.key', data: masterKey });

  const logFilesOnDisk = (await readdir(dataDir).catch(() => [])).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name));
  for (const name of logFilesOnDisk) entries.push({ name: `server/logs/${name}`, data: await readOptional(path.join(dataDir, name)) });

  // Serving can search migration roots, but a portable backup only includes
  // the active roots. Otherwise an old checkout can silently enlarge the
  // backup and restore unrelated files.
  await appendMediaDirectory(entries, configuredImagePath || getDefaultStoragePath(), 'images');
  await appendMediaDirectory(entries, configuredVideoPath || getDefaultVideoStoragePath(), 'videos');
  await appendMediaDirectory(entries, getDefaultAudioStoragePath(), 'audio');
  for (const name of DURABLE_DATA_FILES) {
    const data = await readOptional(path.join(dataDir, name));
    if (data.length) entries.push({ name: `server/tasks/${name}`, data });
  }
  const mcpConfig = await readOptional(path.join(dataDir, 'mcp', 'servers.json'));
  if (mcpConfig.length) entries.push({ name: 'server/mcp/servers.json', data: mcpConfig });
  await appendDirectory(entries, path.join(dataDir, 'artifacts'), 'artifacts');

  const skillsRoot = resolveSkillsDir();
  let skillCount = 0;
  let skillFileCount = 0;
  let skillOmittedFiles = 0;
  for (const skill of listInstalledSkillDirs(skillsRoot)) {
    let included = 0;
    for (const file of listSkillFilesForBackup(skill.dir)) {
      const name = `skills/${skill.id}/${file.path}`;
      if (Buffer.byteLength(name, 'utf8') > 256) { skillOmittedFiles += 1; continue; }
      entries.push({ name, data: await readFile(file.file) });
      included += 1;
    }
    if (included) { skillCount += 1; skillFileCount += included; }
  }

  const manifest = {
    format: 'sanmao-ai-local-backup-archive',
    version: 2,
    backupMode: mode,
    includesSecrets: includeSecrets && Boolean(masterKey.length),
    exportedAt: new Date().toISOString(),
    imageCount: entries.filter((entry) => entry.name.startsWith('images/')).length,
    videoCount: entries.filter((entry) => entry.name.startsWith('videos/')).length,
    audioCount: entries.filter((entry) => entry.name.startsWith('audio/')).length,
    artifactCount: entries.filter((entry) => entry.name.startsWith('artifacts/')).length,
    includesWorkspace: Boolean(workspace.length),
    includesMcpConfig: Boolean(mcpConfig.length),
    portableDirectoryAuthorizations: false,
    skillCount,
    skillFileCount,
    skillOmittedFiles,
    portableImageStorage: true,
    externalMasterKey: Boolean(process.env.SANMAO_MASTER_KEY?.trim()),
    files: entries.map((entry) => ({ name: entry.name, bytes: entry.data.byteLength, sha256: sha256(entry.data) })),
  };
  const archive = createBackupArchive([{ name: 'manifest.json', data: jsonBuffer(manifest) }, ...entries]);
  return { archive, manifest };
}

function manifestEntries(entries: BackupArchiveEntry[], manifest: any) {
  const expected = new Map<string, { bytes: number; sha256: string }>((manifest.files || []).map((file: any) => [String(file.name), { bytes: Number(file.bytes), sha256: String(file.sha256) }]));
  const actual = new Set<string>();
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const file = expected.get(entry.name);
    if (!file || file.bytes !== entry.data.byteLength || file.sha256 !== sha256(entry.data)) throw new Error(`备份文件校验失败：${entry.name}`);
    actual.add(entry.name);
  }
  if (actual.size !== expected.size || [...expected.keys()].some((name) => !actual.has(name))) throw new Error('备份缺少文件');
  return expected;
}

async function restoreArchive(archive: Buffer) {
  const entries = extractBackupArchive(archive);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get('manifest.json');
  const stateEntry = byName.get('server/state.json');
  if (!manifestEntry || !stateEntry) throw new Error('备份缺少 manifest.json 或 server/state.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  if (manifest.format !== 'sanmao-ai-local-backup-archive' || manifest.version !== 2) throw new Error('不支持的备份版本');
  manifestEntries(entries, manifest);
  const state = validateState(stateEntry.data);
  const backupMode: BackupMode = manifest.backupMode === 'complete' || byName.has('server/master.key') ? 'complete' : 'content';
  const clientEntry = byName.get('client/client.json');
  const client = clientEntry ? JSON.parse(clientEntry.data.toString('utf8')) as { gallery?: unknown; chatSessions?: unknown; workspace?: unknown } : {};
  if (clientEntry) {
    if (!Array.isArray(client.gallery) || !Array.isArray(client.chatSessions)) throw new Error('备份中的浏览器历史格式无效');
  }
  const workspaceEntry = byName.get('server/workspace.json');
  const workspace = client.workspace || (workspaceEntry ? JSON.parse(workspaceEntry.data.toString('utf8')) : null);
  if (workspace) validateWorkspaceShape(workspace);
  if (backupMode === 'content') {
    const current = await readOptional(statePath).then((raw) => raw.length ? validateState(raw) : null);
    if (current) {
      const currentById = new Map(current.providers.map((provider) => [String(provider.id), provider]));
      state.providers = state.providers.map((provider) => {
        const existing = currentById.get(String(provider.id));
        return existing ? { ...provider, ...pickStateSecrets(existing) } : provider;
      });
      if (current.webSearch?.encryptedApiKey && state.webSearch) state.webSearch.encryptedApiKey = current.webSearch.encryptedApiKey;
      if (Array.isArray(current.upscaleConnections) && Array.isArray(state.upscaleConnections)) {
        const currentByProvider = new Map(current.upscaleConnections.map((connection) => [String(connection.provider), connection]));
        state.upscaleConnections = state.upscaleConnections.map((connection) => {
          const existing = currentByProvider.get(String(connection.provider));
          return existing ? { ...connection, ...pickStateSecrets(existing) } : connection;
        });
      }
    }
  }
  state.settings!.imageStoragePath = '';
  state.settings!.videoStoragePath = '';
  await mkdir(dataDir, { recursive: true });
  await writeAtomic(statePath, jsonBuffer(state));
  if (workspace) await writeAtomic(workspacePath, jsonBuffer(workspace));

  const restoredLogs = entries.filter((entry) => entry.name.startsWith('server/logs/') && entry.name.endsWith('.jsonl'));
  for (const name of (await readdir(dataDir).catch(() => [])).filter((value) => /^generation-logs(?:-\d+)?\.jsonl$/.test(value))) await rm(path.join(dataDir, name), { force: true });
  for (const entry of restoredLogs) await writeAtomic(path.join(dataDir, path.basename(entry.name)), entry.data);
  const masterKey = byName.get('server/master.key');
  if (masterKey && !process.env.SANMAO_MASTER_KEY?.trim()) await writeAtomic(keyPath, masterKey.data);

  const imageRoot = getDefaultStoragePath();
  await mkdir(imageRoot, { recursive: true });
  let restoredImages = 0;
  for (const entry of entries.filter((value) => value.name.startsWith('images/'))) {
    const relative = entry.name.slice('images/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !isImageFile(relative)) continue;
    const target = path.resolve(imageRoot, relative);
    if (target !== imageRoot && !target.startsWith(`${imageRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
    restoredImages += 1;
  }

  let restoredVideos = 0;
  const videoRoot = getDefaultVideoStoragePath();
  for (const entry of entries.filter((value) => value.name.startsWith('videos/'))) {
    const relative = entry.name.slice('videos/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !/\.(mp4|webm|mov|m4v|ogv)$/i.test(relative)) continue;
    const target = path.resolve(videoRoot, relative);
    if (target !== videoRoot && !target.startsWith(`${videoRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
    restoredVideos += 1;
  }
  let restoredAudio = 0;
  const audioRoot = getDefaultAudioStoragePath();
  for (const entry of entries.filter((value) => value.name.startsWith('audio/'))) {
    const relative = entry.name.slice('audio/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(relative)) continue;
    const target = path.resolve(audioRoot, relative);
    if (target !== audioRoot && !target.startsWith(`${audioRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
    restoredAudio += 1;
  }

  const skillsRoot = resolveSkillsDir();
  const restoredSkillIds = new Set<string>();
  let restoredSkillFiles = 0;
  for (const entry of entries.filter((value) => value.name.startsWith('skills/'))) {
    const relative = entry.name.slice('skills/'.length);
    if (relative.split('/').length < 2 || shouldSkipSkillPath(relative)) continue;
    const target = resolveSkillArchivePath(skillsRoot, relative);
    if (!target) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
    restoredSkillFiles += 1;
    restoredSkillIds.add(relative.split('/')[0]);
  }

  for (const entry of entries.filter((value) => value.name.startsWith('server/tasks/'))) {
    const name = path.basename(entry.name);
    if (!(DURABLE_DATA_FILES as readonly string[]).includes(name)) continue;
    await writeAtomic(path.join(dataDir, name), entry.data);
  }
  const restoredMcp = byName.get('server/mcp/servers.json');
  if (restoredMcp) await writeAtomic(path.join(dataDir, 'mcp', 'servers.json'), restoredMcp.data);
  let restoredArtifacts = 0;
  const artifactRoot = path.resolve(dataDir, 'artifacts');
  for (const entry of entries.filter((value) => value.name.startsWith('artifacts/'))) {
    const relative = entry.name.slice('artifacts/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) continue;
    const target = path.resolve(artifactRoot, relative);
    if (target !== artifactRoot && !target.startsWith(`${artifactRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
    restoredArtifacts += 1;
  }

  return { client, manifest: { ...manifest, backupMode }, restoredImages, restoredVideos, restoredAudio, restoredArtifacts, restoredWorkspace: Boolean(workspace), restoredSkills: restoredSkillIds.size, restoredSkillFiles, externalMasterKey: Boolean(manifest.externalMasterKey), includesSecrets: backupMode === 'complete' };
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('backup-export');
    const body = await request.json();
    const client = body?.client;
    const clientBytes = Buffer.byteLength(JSON.stringify(client || {}), 'utf8');
    if (clientBytes > maxClientBytes) throw new Error('浏览器历史过大，无法生成备份');
    const backupPassword = String(body?.backupPassword || '');
    validateBackupPassword(backupPassword);
    const backupMode = body?.backupMode === 'complete' ? 'complete' : body?.backupMode === 'content' ? 'content' : null;
    if (!backupMode) throw new Error('必须明确选择内容备份或完整加密备份');
    const result = await exportArchive(client, backupMode);
    const encrypted = encryptBackupPayload(result.archive, backupPassword);
    return new Response(encrypted, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="SANMAO-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sanmao-backup"`,
        'X-SANMAO-Backup-Version': '2',
        'X-SANMAO-Backup-Encrypted': '1',
        'X-SANMAO-Backup-Mode': result.manifest.backupMode,
        'X-SANMAO-Backup-Skills': String(result.manifest.skillCount),
      },
    });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '生成完整备份失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}

export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('backup-restore');
    const backupPassword = request.headers.get('x-sanmao-backup-password') || '';
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > maxArchiveBytes) throw new Error('备份归档超过 2GB，无法恢复');
    const uploaded = Buffer.from(await request.arrayBuffer());
    if (uploaded.byteLength > maxArchiveBytes) throw new Error('备份归档超过 2GB，无法恢复');
    const encrypted = isEncryptedBackup(uploaded);
    const archive = encrypted ? decryptBackupPayload(uploaded, backupPassword) : uploaded;
    if (archive.byteLength > maxArchiveBytes) throw new Error('备份归档超过 2GB，无法恢复');
    await createLocalSnapshot('before-restore');
    const result = await restoreArchive(archive);
    return Response.json({ ok: true, legacyUnencrypted: !encrypted, ...result });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '恢复完整备份失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
