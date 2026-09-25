import { assertSupportedDataManifest, detectDataComponentVersions, ensureDataManifest, writeDataManifest, type DataComponentVersions, type DataManifest, CURRENT_DATA_COMPONENT_VERSIONS } from './data-manifest';
import { resolveDataProfile } from './data-paths';
import { recoverPendingMigrations, runMigrations } from './migrations/framework';
import { LOCAL_DATA_MIGRATIONS } from './migrations/registry';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

let foundationPromise: Promise<Awaited<ReturnType<typeof initializeDataFoundation>>> | null = null;

/** Initializes only durable-data metadata; it does not move or rewrite user media. */
async function initializeDataFoundation() {
  const profile = resolveDataProfile();
  let manifest = await ensureDataManifest(profile);
  assertSupportedDataManifest(manifest);
  const recovery = await recoverPendingMigrations({
    dataDir: profile.dataDir,
    manifest,
    writeManifest: async (next: DataManifest) => { manifest = await writeDataManifest(profile, next); },
  });
  manifest = recovery.manifest;
  const providerRecovery = profile.providerConfigDir === profile.dataDir
    ? { manifest, recovered: [], rolledBack: [] }
    : await recoverPendingMigrations({
      dataDir: profile.providerConfigDir,
      manifest,
      writeManifest: async (next: DataManifest) => { manifest = await writeDataManifest(profile, next); },
    });
  manifest = providerRecovery.manifest;

  const runRootMigration = async (root: string, component: keyof typeof CURRENT_DATA_COMPONENT_VERSIONS, file: string) => {
    const detected = await detectDataComponentVersions({ dataDir: root, providerConfigDir: root });
    const rootManifest = {
      ...manifest,
      components: { ...manifest.components, [component]: (detected as DataComponentVersions)[component] },
    };
    return runMigrations({
    dataDir: root,
    manifest: rootManifest,
    target: { [component]: CURRENT_DATA_COMPONENT_VERSIONS[component] },
    steps: LOCAL_DATA_MIGRATIONS.filter((step) => step.component === component),
    commit: async ({ dataDir, stagingDir }) => {
      // Only metadata files are committed. Media remains in its original root.
      const source = path.join(stagingDir, file);
      const target = path.join(dataDir, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    },
    writeManifest: async (next: DataManifest) => { manifest = await writeDataManifest(profile, next); },
    });
  };

  const workspaceMigration = await runRootMigration(profile.dataDir, 'workspace', 'workspace.json');
  manifest = workspaceMigration.manifest;
  const providerMigration = await runRootMigration(profile.providerConfigDir, 'providerConfig', 'state.json');
  manifest = providerMigration.manifest;
  return { profile, manifest, recovery: { ...recovery, provider: providerRecovery }, migration: { workspace: workspaceMigration, provider: providerMigration } };
}

/** Serialize startup recovery and metadata migrations across concurrent probes. */
export async function ensureDataFoundation() {
  if (!foundationPromise) foundationPromise = initializeDataFoundation();
  try {
    return await foundationPromise;
  } finally {
    foundationPromise = null;
  }
}
