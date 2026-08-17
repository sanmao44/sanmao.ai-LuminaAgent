import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAdminRequest } from '@/lib/auth';

export const runtime = 'nodejs';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const statePath = path.join(dataDir, 'state.json');
const keyPath = path.join(dataDir, 'master.key');
const logPath = path.join(dataDir, 'generation-logs.jsonl');

async function readOptional(file: string) {
  try { return await readFile(file, 'utf8'); } catch { return ''; }
}

async function writeAtomic(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${Date.now()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

function validateState(raw: string) {
  const parsed = JSON.parse(raw) as { providers?: unknown; models?: unknown; settings?: unknown };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.providers) || !Array.isArray(parsed.models) || !parsed.settings || typeof parsed.settings !== 'object') throw new Error('备份中的服务端配置格式无效');
  return JSON.stringify(parsed, null, 2);
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const [storedState, masterKey, generationLogs] = await Promise.all([readOptional(statePath), readOptional(keyPath), readOptional(logPath)]);
    const state = storedState || JSON.stringify({ schemaVersion: 2, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } }, null, 2);
    return Response.json({
      ok: true,
      server: {
        state,
        masterKey: /^[a-f0-9]{64}$/i.test(masterKey.trim()) ? masterKey.trim() : '',
        generationLogs,
        externalMasterKey: Boolean(process.env.SANMAO_MASTER_KEY?.trim()),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '导出服务端数据失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const server = body?.server;
    if (!server || typeof server !== 'object') throw new Error('备份中缺少服务端数据');
    const state = validateState(String(server.state || ''));
    const masterKey = String(server.masterKey || '').trim();
    const generationLogs = String(server.generationLogs || '');
    if (generationLogs.length > 50 * 1024 * 1024) throw new Error('生成日志超过 50MB，无法恢复');
    if (masterKey && !/^[a-f0-9]{64}$/i.test(masterKey)) throw new Error('备份中的主密钥格式无效');

    await mkdir(dataDir, { recursive: true });
    if (masterKey && !process.env.SANMAO_MASTER_KEY?.trim()) await writeAtomic(keyPath, `${masterKey}\n`);
    await writeAtomic(statePath, state);
    await writeAtomic(logPath, generationLogs);
    return Response.json({ ok: true, externalMasterKey: Boolean(process.env.SANMAO_MASTER_KEY?.trim()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '恢复服务端数据失败' }, { status: 400 });
  }
}
