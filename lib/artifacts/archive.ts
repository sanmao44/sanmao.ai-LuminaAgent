import { zipSync } from 'fflate';
import { ARCHIVE_MAX_BYTES, ARCHIVE_MAX_ENTRIES } from './limits';
import { dedupeName, forceArtifactExtension, sanitizeArchiveEntryName } from './sanitize';
import { assertArchiveParts } from './validate';
import type { ArtifactBuild } from './types';

export type ArchiveEntryInput = {
  name: string;
  data: Uint8Array;
};

export function buildZipArchive(entries: readonly ArchiveEntryInput[]): ArtifactBuild {
  const warnings: string[] = [];
  if (!entries.length) throw new Error('ZIP 内容为空：请先指定要打包的文件');
  if (entries.length > ARCHIVE_MAX_ENTRIES) warnings.push(`打包文件超过 ${ARCHIVE_MAX_ENTRIES} 个，已截断`);
  const used = new Set<string>();
  const payload: Record<string, Uint8Array> = {};
  for (const entry of entries.slice(0, ARCHIVE_MAX_ENTRIES)) {
    if (!entry?.data?.length) {
      warnings.push(`${sanitizeArchiveEntryName(entry?.name)} 内容为空，已跳过`);
      continue;
    }
    const safeName = dedupeName(sanitizeArchiveEntryName(entry.name), used);
    payload[safeName] = entry.data;
  }
  if (!Object.keys(payload).length) throw new Error('ZIP 内容为空：所有文件都没有可用内容');
  const buffer = Buffer.from(zipSync(payload, { level: 6 }));
  if (buffer.length > ARCHIVE_MAX_BYTES) throw new Error(`打包结果超过 ${Math.round(ARCHIVE_MAX_BYTES / 1024 / 1024)}MB 上限`);
  assertArchiveParts(buffer, [Object.keys(payload)[0]], 'ZIP 压缩包');
  return { buffer, warnings };
}

export function resolveArchiveFileName(rawName: unknown) {
  const base = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'SANMAO-资料包.zip';
  return forceArtifactExtension(base, '.zip');
}
