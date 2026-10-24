import { clearMcpToolCache } from './tools';
import { updateGithubMcpFromRepo, type GithubMcpUpdateDependencies } from './repo-installer';
import type { McpServerConfig } from './types';

type UpdateOptions = {
  dataDir?: string;
  dependencies?: GithubMcpUpdateDependencies;
  update?: typeof updateGithubMcpFromRepo;
};

/** Start due repository updates without delaying capability discovery. */
export function scheduleManagedGithubMcpUpdates(servers: readonly McpServerConfig[], options: UpdateOptions = {}) {
  const update = options.update || updateGithubMcpFromRepo;
  return servers
    .filter((server) => server.enabled && server.transport === 'stdio' && server.managedRepo && server.managedRepo.autoUpdate !== false)
    .map((server) => update(server, {
      ...(options.dataDir ? { dataDir: options.dataDir } : {}),
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
    })
      .then((result) => {
        if (result.updated) clearMcpToolCache(server.id);
        return result;
      })
      .catch(() => undefined));
}
