import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { isAdminRequest } from '@/lib/auth';
import { resolveLocalDataDir, resolveProviderConfigDir } from '@/lib/data-paths';
import { isSqliteActive } from '@/lib/database/sqlite';
import { getStoredStateForBackup, type StoreData } from '@/lib/store';
import { BackupRestoreTransaction } from '@/lib/backup-restore-transaction';
import { openSqliteDatabase, replaceSqliteDomain, sqliteDatabasePath } from '@/lib/database/sqlite';

export const runtime = 'nodejs';

const dataDir = resolveLocalDataDir();
const providerConfigDir = resolveProviderConfigDir();
const statePath = path.join(providerConfigDir, 'state.json');
const keyPath = path.join(providerConfigDir, 'master.key');
const logPath = path.join(dataDir, 'generation-logs.jsonl');

async function readOptional(file: string) {
  try { return await readFile(file, 'utf8'); } catch { return ''; }
}

function validateState(raw: string) {
  const parsed = JSON.parse(raw) as { providers?: unknown; models?: unknown; settings?: unknown };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.providers) || !Array.isArray(parsed.models) || !parsed.settings || typeof parsed.settings !== 'object') throw new Error('备份中的服务端配置格式无效');
  return JSON.stringify(parsed, null, 2);
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const [storedState, masterKey, generationLogs] = await Promise.all([
      isSqliteActive(dataDir) ? getStoredStateForBackup().then((value) => JSON.stringify(value)) : readOptional(statePath),
      readOptional(keyPath),
      readOptional(logPath),
    ]);
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
    await BackupRestoreTransaction.recover(dataDir);
    const transaction = new BackupRestoreTransaction(dataDir, `legacy-backup-${process.pid}-${Date.now()}`);
    let stagedDatabase = '';
    try {
      if (isSqliteActive(dataDir)) {
        stagedDatabase = path.join(dataDir, `.restore-legacy-db-${process.pid}-${Date.now()}.sqlite`);
        await copyFile(sqliteDatabasePath(dataDir), stagedDatabase);
        const db = openSqliteDatabase(stagedDatabase);
        replaceSqliteDomain(db, 'provider-config', [{ key: 'primary', value: JSON.parse(state) as StoreData }]);
        db.close();
        await transaction.copy(stagedDatabase, sqliteDatabasePath(dataDir));
      } else {
        await transaction.write(statePath, state);
      }
      if (masterKey && !process.env.SANMAO_MASTER_KEY?.trim()) await transaction.write(keyPath, `${masterKey}\n`);
      await transaction.write(logPath, generationLogs);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      if (stagedDatabase) await rm(stagedDatabase, { force: true }).catch(() => undefined);
    }
    return Response.json({ ok: true, externalMasterKey: Boolean(process.env.SANMAO_MASTER_KEY?.trim()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '恢复服务端数据失败' }, { status: 400 });
  }
}
