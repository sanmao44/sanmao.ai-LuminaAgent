import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveProviderConfigDir } from '../data-paths';
import { createSqliteAuthorityFence, isSqliteActive, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';
import type { StoreData } from '../store';
import type { ProviderStateRepository } from '@/packages/contracts/storage';

const stateFile = (configDir = resolveProviderConfigDir()) => path.join(configDir, 'state.json');
const assertStoreStable = createSqliteAuthorityFence();

/**
 * Server provider state adapter. The legacy JSON file is kept inside this
 * adapter for pre-cutover installs and rollback recovery; callers use the
 * repository port and never choose the physical store themselves.
 */
export const providerStateRepository: ProviderStateRepository<Partial<StoreData>> = {
  async read() {
    assertStoreStable();
    const dataDir = resolveProviderConfigDir();
    if (isSqliteActive()) return readSqliteRecord<Partial<StoreData>>('provider-config', 'primary');
    try {
      return JSON.parse(await readFile(stateFile(dataDir), 'utf8')) as Partial<StoreData>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        const source = stateFile(dataDir);
        const corruptPath = `${source.replace(/\.json$/i, '')}.corrupt-${Date.now()}.json`;
        try { await rename(source, corruptPath); } catch {}
        throw new Error(`state.json 数据结构无效；服务端配置已损坏，原文件已保留为 ${path.basename(corruptPath)}，请从备份恢复`);
      }
      throw error;
    }
  },
  async write(value) {
    assertStoreStable();
    if (isSqliteActive()) {
      writeSqliteRecord('provider-config', 'primary', value);
      return;
    }
    const configDir = resolveProviderConfigDir();
    await mkdir(configDir, { recursive: true });
    const target = stateFile(configDir);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flush: true });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  },
};

/** Server provider state persistence boundary. Secrets remain encrypted in DTOs. */
export function readAuthoritativeProviderState() {
  return isSqliteActive() ? readSqliteRecord<Partial<StoreData>>('provider-config', 'primary') : null;
}

export function writeAuthoritativeProviderState(value: StoreData) {
  if (!isSqliteActive()) return false;
  writeSqliteRecord('provider-config', 'primary', value);
  return true;
}
