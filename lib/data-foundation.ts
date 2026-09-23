import { ensureDataManifest, writeDataManifest, type DataManifest } from './data-manifest';
import { resolveDataProfile } from './data-paths';
import { recoverPendingMigrations } from './migrations/framework';

/** Initializes only durable-data metadata; it does not move or rewrite user media. */
export async function ensureDataFoundation() {
  const profile = resolveDataProfile();
  let manifest = await ensureDataManifest(profile);
  const recovery = await recoverPendingMigrations({
    dataDir: profile.dataDir,
    manifest,
    writeManifest: async (next: DataManifest) => { manifest = await writeDataManifest(profile, next); },
  });
  manifest = recovery.manifest;
  return { profile, manifest, recovery };
}
