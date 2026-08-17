import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAdminRequest } from '@/lib/auth';
import { createBackupArchive, extractBackupArchive, sha256, type BackupArchiveEntry } from '@/lib/backup-archive';
import { getDefaultStoragePath, getStorageRoots } from '@/lib/image-storage';

export const runtime = 'nodejs';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const statePath = path.join(dataDir, 'state.json');
const keyPath = path.join(dataDir, 'master.key');
const maxClientBytes = 80 * 1024 * 1024;
const maxArchiveBytes = 2 * 1024 * 1024 * 1024;

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

function validateState(raw: Buffer) {
  const parsed = JSON.parse(raw.toString('utf8')) as { providers?: unknown; models?: unknown; settings?: Record<string, unknown> };
  if (!parsed || !Array.isArray(parsed.providers) || !Array.isArray(parsed.models) || !parsed.settings || typeof parsed.settings !== 'object') throw new Error('备份中的服务端配置格式无效');
  return parsed;
}

function isImageFile(file: string) {
  return /\.(png|jpe?g|webp)$/i.test(file);
}

function fileNameFromPath(file: string) {
  return file.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
}

async function exportArchive(client: unknown) {
  const stateRaw = await readOptional(statePath);
  const state = stateRaw.length ? validateState(stateRaw) : { schemaVersion: 2, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } };
  const configuredPath = String(state.settings?.imageStoragePath || '');
  const entries: BackupArchiveEntry[] = [
    { name: 'server/state.json', data: jsonBuffer(state) },
    { name: 'client/client.json', data: jsonBuffer(client || {}) },
  ];
  const masterKey = await readOptional(keyPath);
  if (masterKey.length) entries.push({ name: 'server/master.key', data: masterKey });

  const logFilesOnDisk = (await readdir(dataDir).catch(() => [])).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name));
  for (const name of logFilesOnDisk) entries.push({ name: `server/logs/${name}`, data: await readOptional(path.join(dataDir, name)) });

  const seen = new Set<string>();
  for (const root of getStorageRoots(configuredPath)) {
    for (const file of await listFiles(root)) {
      if (!isImageFile(file)) continue;
      const relative = fileNameFromPath(path.relative(root, file));
      if (!relative || seen.has(relative)) continue;
      seen.add(relative);
      entries.push({ name: `images/${relative}`, data: await readFile(file) });
    }
  }

  const manifest = {
    format: 'sanmao-ai-local-backup-archive',
    version: 2,
    exportedAt: new Date().toISOString(),
    imageCount: seen.size,
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
  state.settings!.imageStoragePath = '';
  await mkdir(dataDir, { recursive: true });
  await writeAtomic(statePath, jsonBuffer(state));

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
  const clientEntry = byName.get('client/client.json');
  return { client: clientEntry ? JSON.parse(clientEntry.data.toString('utf8')) : {}, manifest, restoredImages, externalMasterKey: Boolean(manifest.externalMasterKey) };
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const client = body?.client;
    const clientBytes = Buffer.byteLength(JSON.stringify(client || {}), 'utf8');
    if (clientBytes > maxClientBytes) throw new Error('浏览器历史过大，无法生成备份');
    const result = await exportArchive(client);
    return new Response(result.archive, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="SANMAO-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sanmao-backup.tar.gz"`,
        'X-SANMAO-Backup-Version': '2',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '生成完整备份失败' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > maxArchiveBytes) throw new Error('备份归档超过 2GB，无法恢复');
    const archive = Buffer.from(await request.arrayBuffer());
    if (archive.byteLength > maxArchiveBytes) throw new Error('备份归档超过 2GB，无法恢复');
    const result = await restoreArchive(archive);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '恢复完整备份失败' }, { status: 400 });
  }
}
