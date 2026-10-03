import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createArchiveBudget, createBackupArchive, describeBackupSource, extractBackupArchiveFile, extractBackupArchiveStreaming, sha256, sha256File, type BackupArchiveEntry, type BackupArchiveFileEntry, type BackupArchiveSource } from '@/lib/backup-archive';
import { decryptBackupFile, decryptBackupPayload, encryptBackupPayload, isEncryptedBackup, isEncryptedBackupFile, validateBackupPassword } from '@/lib/backup-crypto';
import { getDefaultStoragePath } from '@/lib/image-storage';
import { getDefaultAudioStoragePath } from '@/lib/audio-storage';
import { getDefaultVideoStoragePath } from '@/lib/video-storage';
import { createLocalSnapshot, SNAPSHOT_DURABLE_FILES } from '@/lib/local-snapshots';
import { listInstalledSkillDirs, listSkillFilesForBackup, resolveSkillArchivePath, resolveSkillsDir, shouldSkipSkillPath } from '@/lib/skills';
import { resolveLocalDataDir, resolveProviderConfigDir } from '@/lib/data-paths';
import { validateWorkspaceShape } from '@/lib/workspace-format';
import { BackupRestoreTransaction } from '@/lib/backup-restore-transaction';


const dataDir = resolveLocalDataDir();
const providerConfigDir = resolveProviderConfigDir();
const statePath = path.join(providerConfigDir, 'state.json');
const keyPath = path.join(providerConfigDir, 'master.key');
const workspacePath = path.join(dataDir, 'workspace.json');
const maxClientBytes = 80 * 1024 * 1024;
/**
 * 閹垹顦查弮鑸垫殻娑擃亜缍婂锝堫洣鏉╂稑鍞寸€涙﹫绱版稉鈧▎陇袙鐎靛棎鈧椒绔村▎陇袙閸樺绱濆畡鏉库偓鑲╁娑撳搫缍婂锝勭秼缁夘垳娈?3 閸婂秲鈧?
 * 娑撳﹪妾洪幐?4GiB 鐠佹儳鐣鹃垾鏂衡偓鏃傜閺夋劖妲搁柅鎰）婢х偤鏆遍惃鍕剁礉2GiB 娴兼俺顔€"鐎电厧鍤幋鎰閸楀瓨浠径宥勭瑝娴?閸欐ɑ鍨?
 * 闂堟瑩绮梽鐑芥Ш閿涘牆鐤勫ù瀣閺夋劖澧﹂崠鍛倵瀹告彃鍩?2.07GiB閿涘鈧倸鍟€婢堆冩皑韫囧懘銆忛幎濠冧划婢跺秵鏁奸幋鎰ウ瀵繈鈧?
 */
const maxArchiveBytes = 4 * 1024 * 1024 * 1024;
const maxArchiveLabel = `${maxArchiveBytes / (1024 * 1024 * 1024)}GB`;
const BACKUP_SCHEMA_VERSION = 1;

async function readOptional(file: string) {
  try { return await readFile(file); } catch { return Buffer.alloc(0); }
}

/** File-level restore transaction. Existing files are moved to a rollback tree
 * before writes, so a failed restore can return the live tree to its original
 * state without copying large media buffers. */
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
  providers: Array<Record<string, unknown>>;
  models: unknown[];
  settings: Record<string, unknown>;
  webSearch?: Record<string, unknown>;
  upscaleConnections?: Array<Record<string, unknown>>;
};

type BackupManifest = {
  format?: string;
  version?: number;
  schemaVersion?: number;
  canonical?: { workspace?: string };
  backupMode?: BackupMode;
  externalMasterKey?: boolean;
  files?: Array<{ name: string; bytes: number; sha256: string }>;
};

type RestoreEntry = BackupArchiveEntry | BackupArchiveFileEntry;

function entryBytes(entry: RestoreEntry) {
  return 'data' in entry ? entry.data.byteLength : entry.size;
}

async function readEntry(entry: RestoreEntry) {
  return 'data' in entry ? entry.data : readFile(entry.filePath);
}

async function writeEntry(transaction: BackupRestoreTransaction, target: string, entry: RestoreEntry) {
  if ('data' in entry) await transaction.write(target, entry.data);
  else await transaction.copy(entry.filePath, target);
}

function entrySha256(entry: RestoreEntry) {
  return 'data' in entry ? Promise.resolve(sha256(entry.data)) : Promise.resolve(entry.sha256);
}

function validateState(raw: Buffer): BackupState {
  const parsed = JSON.parse(raw.toString('utf8')) as BackupState;
  if (!parsed || !Array.isArray(parsed.providers) || !Array.isArray(parsed.models) || !parsed.settings || typeof parsed.settings !== 'object') throw new Error('Invalid backup server state');
  return parsed;
}

function stripStateSecrets(state: BackupState): BackupState {
  const stripEncryptedFields = (value: Record<string, unknown>) => Object.fromEntries(
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

function pickStateSecrets(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith('encrypted')));
}

function isImageFile(file: string) {
  return /\.(png|jpe?g|webp)$/i.test(file);
}

async function removeStaleFiles(transaction: BackupRestoreTransaction, root: string, expected: Set<string>, predicate: (file: string) => boolean) {
  for (const file of await listFiles(root)) {
    if (!predicate(file)) continue;
    if (!expected.has(path.resolve(file))) await transaction.remove(file);
  }
}

function fileNameFromPath(file: string) {
  return file.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
}

async function appendDirectory(entries: BackupArchiveSource[], root: string, prefix: string, budget: ReturnType<typeof createArchiveBudget>) {
  const resolvedRoot = path.resolve(root);
  for (const file of await listFiles(resolvedRoot)) {
    const relative = fileNameFromPath(path.relative(resolvedRoot, file));
    if (!relative) continue;
    const name = `${prefix}/${relative}`;
    budget.add((await stat(file).catch(() => ({ size: 0 }))).size, name);
    entries.push({ name, filePath: file, size: (await stat(file)).size });
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

async function appendMediaDirectory(entries: BackupArchiveSource[], root: string, folder: 'images' | 'videos' | 'audio', budget: ReturnType<typeof createArchiveBudget>) {
  const resolvedRoot = path.resolve(root);
  for (const file of await listFiles(resolvedRoot)) {
    const relative = fileNameFromPath(path.relative(resolvedRoot, file));
    if (!relative || !isMediaFile(relative, folder)) continue;
    const name = `${folder}/${relative}`;
    // 閸忓牊瀵滄担鎾缎濈紒鎾剁暬閸愬秷顕伴惄姗堢礉闁灝鍘ょ搾鍛存閺冨墎娅х拠璁崇闁秶绀岄弶鎰┾偓?
    budget.add((await stat(file).catch(() => ({ size: 0 }))).size, name);
    entries.push({ name, filePath: file, size: (await stat(file)).size });
  }
}

type BackupMode = 'content' | 'complete';

async function exportArchive(client: unknown, mode: BackupMode) {
  const includeSecrets = mode === 'complete';
  const budget = createArchiveBudget(maxArchiveBytes, maxArchiveLabel);
  const stateRaw = await readOptional(statePath);
  const rawState = stateRaw.length ? validateState(stateRaw) : { schemaVersion: 2, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } };
  const state = includeSecrets ? rawState : stripStateSecrets(rawState);
  const configuredImagePath = String(state.settings?.imageStoragePath || '');
  const configuredVideoPath = String((state.settings as Record<string, unknown>)?.videoStoragePath || '');
  const stateEntry = jsonBuffer(state);
  const clientEntry = jsonBuffer(client || {});
  budget.add(stateEntry.byteLength, 'server/state.json');
  budget.add(clientEntry.byteLength, 'client/client.json');
  const entries: BackupArchiveSource[] = [
    { name: 'server/state.json', data: stateEntry },
    { name: 'client/client.json', data: clientEntry },
  ];
  // client/client.json is the canonical workspace representation. The server
  // workspace file is only a sync mirror and is not emitted as a second truth.
  const masterKey = await readOptional(keyPath);
  if (includeSecrets && masterKey.length) entries.push({ name: 'server/master.key', data: masterKey });

  const logFilesOnDisk = (await readdir(dataDir).catch(() => [])).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name));
  for (const name of logFilesOnDisk) {
    const data = await readOptional(path.join(dataDir, name));
    budget.add(data.byteLength, `server/logs/${name}`);
    entries.push({ name: `server/logs/${name}`, data });
  }

  // Serving can search migration roots, but a portable backup only includes
  // the active roots. Otherwise an old checkout can silently enlarge the
  // backup and restore unrelated files.
  await appendMediaDirectory(entries, configuredImagePath || getDefaultStoragePath(), 'images', budget);
  await appendMediaDirectory(entries, configuredVideoPath || getDefaultVideoStoragePath(), 'videos', budget);
  await appendMediaDirectory(entries, getDefaultAudioStoragePath(), 'audio', budget);
  for (const name of SNAPSHOT_DURABLE_FILES) {
    const data = await readOptional(path.join(dataDir, name));
    if (!data.length) continue;
    budget.add(data.byteLength, `server/tasks/${name}`);
    entries.push({ name: `server/tasks/${name}`, data });
  }
  const mcpConfig = await readOptional(path.join(dataDir, 'mcp', 'servers.json'));
  if (mcpConfig.length) { budget.add(mcpConfig.byteLength, 'server/mcp/servers.json'); entries.push({ name: 'server/mcp/servers.json', data: mcpConfig }); }
  await appendDirectory(entries, path.join(dataDir, 'artifacts'), 'artifacts', budget);

  const skillsRoot = resolveSkillsDir();
  let skillCount = 0;
  let skillFileCount = 0;
  let skillOmittedFiles = 0;
  for (const skill of listInstalledSkillDirs(skillsRoot)) {
    let included = 0;
    for (const file of listSkillFilesForBackup(skill.dir)) {
      const name = `skills/${skill.id}/${file.path}`;
      if (Buffer.byteLength(name, 'utf8') > 256) { skillOmittedFiles += 1; continue; }
      budget.add((await stat(file.file).catch(() => ({ size: 0 }))).size, name);
      entries.push({ name, filePath: file.file, size: (await stat(file.file)).size });
      included += 1;
    }
    if (included) { skillCount += 1; skillFileCount += included; }
  }

  const manifest = {
    format: 'sanmao-ai-local-backup-archive',
    version: 2,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    canonical: { workspace: 'client/client.json' },
    backupMode: mode,
    includesSecrets: includeSecrets && Boolean(masterKey.length),
    exportedAt: new Date().toISOString(),
    imageCount: entries.filter((entry) => entry.name.startsWith('images/')).length,
    videoCount: entries.filter((entry) => entry.name.startsWith('videos/')).length,
    audioCount: entries.filter((entry) => entry.name.startsWith('audio/')).length,
    artifactCount: entries.filter((entry) => entry.name.startsWith('artifacts/')).length,
    includesWorkspace: Boolean((client as { workspace?: unknown } | null)?.workspace),
    includesMcpConfig: Boolean(mcpConfig.length),
    portableDirectoryAuthorizations: false,
    skillCount,
    skillFileCount,
    skillOmittedFiles,
    portableImageStorage: true,
    externalMasterKey: Boolean(process.env.SANMAO_MASTER_KEY?.trim()),
    files: await Promise.all(entries.map(async (entry) => ({ name: entry.name, ...(await describeBackupSource(entry)) }))),
  };
  const archive = await createBackupArchive([{ name: 'manifest.json', data: jsonBuffer(manifest) }, ...entries]);
  return { archive, manifest };
}

async function manifestEntries(entries: RestoreEntry[], manifest: { files?: Array<{ name: string; bytes: number; sha256: string }> }) {
  const expected = new Map<string, { bytes: number; sha256: string }>((manifest.files || []).map((file) => [file.name, { bytes: file.bytes, sha256: file.sha256 }]));
  const actual = new Set<string>();
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const file = expected.get(entry.name);
    if (!file || file.bytes !== entryBytes(entry) || file.sha256 !== await entrySha256(entry)) throw new Error("Backup file checksum failed: " + entry.name);
    actual.add(entry.name);
  }
  if (actual.size !== expected.size || [...expected.keys()].some((name) => !actual.has(name))) throw new Error('Backup is missing files');
  return expected;
}

async function restoreArchive(entries: RestoreEntry[]) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get('manifest.json');
  const stateEntry = byName.get('server/state.json');
  if (!manifestEntry || !stateEntry) throw new Error('Backup is missing manifest.json or server/state.json');
  const manifest = JSON.parse((await readEntry(manifestEntry)).toString('utf8')) as BackupManifest;
  if (manifest.format !== 'sanmao-ai-local-backup-archive' || manifest.version !== 2) throw new Error('Unsupported backup version');
  if (Number(manifest.schemaVersion || 1) !== BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup schema version');
  if (manifest.canonical?.workspace && manifest.canonical.workspace !== 'client/client.json') throw new Error('Unsupported canonical workspace');
  await manifestEntries(entries, manifest);
  const state = validateState(await readEntry(stateEntry));
  const backupMode: BackupMode = manifest.backupMode === 'complete' || byName.has('server/master.key') ? 'complete' : 'content';
  const clientEntry = byName.get('client/client.json');
  if (manifest.canonical?.workspace === 'client/client.json' && !clientEntry) throw new Error('Backup is missing canonical client/client.json');
  const client = clientEntry ? JSON.parse((await readEntry(clientEntry)).toString('utf8')) as { gallery?: unknown; chatSessions?: unknown; workspace?: unknown } : {};
  if (clientEntry) {
    if (!Array.isArray(client.gallery) || !Array.isArray(client.chatSessions)) throw new Error('Invalid backup browser history');
  }
  const workspaceEntry = byName.get('server/workspace.json');
  const workspace = client.workspace || (workspaceEntry ? JSON.parse((await readEntry(workspaceEntry)).toString('utf8')) : null);
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
  const transaction = new BackupRestoreTransaction(dataDir);
  try {
    await BackupRestoreTransaction.recover(dataDir);
    await transaction.write(statePath, jsonBuffer(state));
    if (workspace) await transaction.write(workspacePath, jsonBuffer(workspace));

  const restoredLogs = entries.filter((entry) => entry.name.startsWith('server/logs/') && entry.name.endsWith('.jsonl'));
  for (const name of (await readdir(dataDir).catch(() => [])).filter((value) => /^generation-logs(?:-\d+)?\.jsonl$/.test(value))) await transaction.remove(path.join(dataDir, name));
  for (const entry of restoredLogs) await writeEntry(transaction, path.join(dataDir, path.basename(entry.name)), entry);
  const masterKey = byName.get('server/master.key');
  if (masterKey && !process.env.SANMAO_MASTER_KEY?.trim()) await writeEntry(transaction, keyPath, masterKey);

  const imageRoot = getDefaultStoragePath();
  await mkdir(imageRoot, { recursive: true });
  const expectedImages = new Set<string>();
  for (const entry of entries.filter((value) => value.name.startsWith('images/'))) {
    const relative = entry.name.slice('images/'.length).replace(/\\/g, '/');
    if (relative && !relative.startsWith('/') && !relative.split('/').includes('..') && isImageFile(relative)) expectedImages.add(path.resolve(imageRoot, relative));
  }
  await removeStaleFiles(transaction, imageRoot, expectedImages, isImageFile);
  let restoredImages = 0;
  for (const entry of entries.filter((value) => value.name.startsWith('images/'))) {
    const relative = entry.name.slice('images/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !isImageFile(relative)) continue;
    const target = path.resolve(imageRoot, relative);
    if (target !== imageRoot && !target.startsWith(`${imageRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeEntry(transaction, target, entry);
    restoredImages += 1;
  }

  let restoredVideos = 0;
  const videoRoot = getDefaultVideoStoragePath();
  const expectedVideos = new Set<string>();
  for (const entry of entries.filter((value) => value.name.startsWith('videos/'))) {
    const relative = entry.name.slice('videos/'.length).replace(/\\/g, '/');
    if (relative && !relative.startsWith('/') && !relative.split('/').includes('..') && /\.(mp4|webm|mov|m4v|ogv)$/i.test(relative)) expectedVideos.add(path.resolve(videoRoot, relative));
  }
  await removeStaleFiles(transaction, videoRoot, expectedVideos, (file) => /\.(mp4|webm|mov|m4v|ogv)$/i.test(file));
  for (const entry of entries.filter((value) => value.name.startsWith('videos/'))) {
    const relative = entry.name.slice('videos/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !/\.(mp4|webm|mov|m4v|ogv)$/i.test(relative)) continue;
    const target = path.resolve(videoRoot, relative);
    if (target !== videoRoot && !target.startsWith(`${videoRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeEntry(transaction, target, entry);
    restoredVideos += 1;
  }
  let restoredAudio = 0;
  const audioRoot = getDefaultAudioStoragePath();
  const expectedAudio = new Set<string>();
  for (const entry of entries.filter((value) => value.name.startsWith('audio/'))) {
    const relative = entry.name.slice('audio/'.length).replace(/\\/g, '/');
    if (relative && !relative.startsWith('/') && !relative.split('/').includes('..') && /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(relative)) expectedAudio.add(path.resolve(audioRoot, relative));
  }
  await removeStaleFiles(transaction, audioRoot, expectedAudio, (file) => /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(file));
  for (const entry of entries.filter((value) => value.name.startsWith('audio/'))) {
    const relative = entry.name.slice('audio/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(relative)) continue;
    const target = path.resolve(audioRoot, relative);
    if (target !== audioRoot && !target.startsWith(`${audioRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeEntry(transaction, target, entry);
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
    await writeEntry(transaction, target, entry);
    restoredSkillFiles += 1;
    restoredSkillIds.add(relative.split('/')[0]);
  }

  for (const entry of entries.filter((value) => value.name.startsWith('server/tasks/'))) {
    const name = path.basename(entry.name);
    if (!(SNAPSHOT_DURABLE_FILES as readonly string[]).includes(name)) continue;
    await writeEntry(transaction, path.join(dataDir, name), entry);
  }
  const restoredMcp = byName.get('server/mcp/servers.json');
  if (restoredMcp) await writeEntry(transaction, path.join(dataDir, 'mcp', 'servers.json'), restoredMcp);
  else await transaction.remove(path.join(dataDir, 'mcp', 'servers.json'));
  let restoredArtifacts = 0;
  const artifactRoot = path.resolve(dataDir, 'artifacts');
  const expectedArtifacts = new Set(entries.filter((value) => value.name.startsWith('artifacts/')).map((entry) => path.resolve(artifactRoot, entry.name.slice('artifacts/'.length).replace(/\\/g, '/'))));
  await removeStaleFiles(transaction, artifactRoot, expectedArtifacts, () => true);
  for (const entry of entries.filter((value) => value.name.startsWith('artifacts/'))) {
    const relative = entry.name.slice('artifacts/'.length).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) continue;
    const target = path.resolve(artifactRoot, relative);
    if (target !== artifactRoot && !target.startsWith(`${artifactRoot}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeEntry(transaction, target, entry);
    restoredArtifacts += 1;
  }

    await transaction.commit();
    return { client, manifest: { ...manifest, backupMode, schemaVersion: BACKUP_SCHEMA_VERSION }, restoredImages, restoredVideos, restoredAudio, restoredArtifacts, restoredWorkspace: Boolean(workspace), restoredSkills: restoredSkillIds.size, restoredSkillFiles, externalMasterKey: Boolean(manifest.externalMasterKey), includesSecrets: backupMode === 'complete' };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}


export async function createBackupExport(client: unknown, backupPassword: string, mode: BackupMode) {
  validateBackupPassword(backupPassword);
  const result = await exportArchive(client, mode);
  const encrypted = encryptBackupPayload(result.archive, backupPassword);
  return { encrypted, manifest: result.manifest };
}

export async function restoreBackupArchive(uploaded: Buffer, backupPassword: string) {
  if (uploaded.byteLength > maxArchiveBytes) throw new Error(`Backup archive exceeds ${maxArchiveLabel}`);
  const encrypted = isEncryptedBackup(uploaded);
  const archive = encrypted ? decryptBackupPayload(uploaded, backupPassword) : uploaded;
  if (archive.byteLength > maxArchiveBytes) throw new Error(`Backup archive exceeds ${maxArchiveLabel}`);
  await createLocalSnapshot('before-restore');
  const result = await restoreArchive(await extractBackupArchiveStreaming(archive));
  return { legacyUnencrypted: !encrypted, ...result };
}

/** Restore an HTTP upload using disk staging. The request route writes the
 * upload to a temporary file, then this service decrypts and extracts one
 * entry at a time without a full archive Buffer. */
export async function restoreBackupArchiveFile(uploadedPath: string, backupPassword: string, uploadedBytes: number) {
  if (uploadedBytes > maxArchiveBytes) throw new Error(`Backup archive exceeds ${maxArchiveLabel}`);
  const staging = await mkdtemp(path.join(tmpdir(), 'sanmao-restore-'));
  const encryptedPath = path.join(staging, 'uploaded.backup');
  const archivePath = path.join(staging, 'archive.gz');
  const extractDir = path.join(staging, 'entries');
  try {
    const encrypted = await isEncryptedBackupFile(uploadedPath);
    if (encrypted) {
      await decryptBackupFile(uploadedPath, archivePath, backupPassword);
    } else {
      const source = createReadStream(uploadedPath);
      const target = createWriteStream(archivePath, { flags: 'wx' });
      await new Promise<void>((resolve, reject) => { source.once('error', reject); target.once('error', reject); target.once('finish', resolve); source.pipe(target); });
    }
    const info = await stat(archivePath);
    if (info.size > maxArchiveBytes) throw new Error(`Backup archive exceeds ${maxArchiveLabel}`);
    await createLocalSnapshot('before-restore');
    const result = await restoreArchive(await extractBackupArchiveFile(archivePath, extractDir));
    return { legacyUnencrypted: !encrypted, ...result };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function getBackupLimits() {
  return { maxArchiveBytes, maxArchiveLabel, maxClientBytes };
}

