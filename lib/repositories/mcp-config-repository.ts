import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '../data-paths';
import { createSqliteAuthorityFence, isSqliteActive, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';
import type { McpConfigRepository } from '@/packages/contracts/storage';

type McpConfigRepositoryOptions = { dataDir?: string };

function storeFile(dataDir: string) {
  return path.join(dataDir, 'mcp', 'servers.json');
}

function readLegacy<TServer>(dataDir: string): TServer[] {
  const file = storeFile(dataDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { servers?: unknown };
    return Array.isArray(parsed?.servers) ? parsed.servers as TServer[] : [];
  } catch {
    return [];
  }
}

export function createMcpConfigRepository<TServer>(options: McpConfigRepositoryOptions = {}): McpConfigRepository<TServer> & { filePath(): string } {
  const dataDir = path.resolve(options.dataDir || resolveLocalDataDir());
  const assertStoreStable = createSqliteAuthorityFence(dataDir);
  return {
    filePath: () => storeFile(dataDir),
    list() {
      assertStoreStable();
      if (isSqliteActive(dataDir)) return readSqliteRecord<{ servers?: TServer[] }>('mcp', 'primary', dataDir)?.servers || [];
      return readLegacy<TServer>(dataDir);
    },
    save(servers) {
      assertStoreStable();
      const next = servers.slice(0, 20);
      if (isSqliteActive(dataDir)) {
        writeSqliteRecord('mcp', 'primary', { version: 1, servers: next }, dataDir);
        return [...next];
      }
      const file = storeFile(dataDir);
      mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ version: 1, servers: next }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, file);
      return [...next];
    },
  };
}

export const mcpConfigRepository = createMcpConfigRepository();
