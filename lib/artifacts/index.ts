import { readFile } from 'node:fs/promises';
import { artifactStore, type ArtifactStore } from './storage';
import { ARTIFACT_MIME_TYPES, type ArtifactGeneration } from './types';
import { buildSpreadsheet, resolveSpreadsheetFileName, type SpreadsheetInput } from './excel';
import { buildPresentation, resolvePresentationFileName, type PresentationInput } from './powerpoint';
import { buildWordDocument, resolveDocumentFileName, type DocumentInput } from './word';
import { buildZipArchive, resolveArchiveFileName, type ArchiveEntryInput } from './archive';
import type { ArtifactGenerateOptions, ArtifactImageInput } from './images';

export type * from './types';
export type { DocumentInput, DocumentSectionInput, DocumentTableInput } from './word';
export type { SpreadsheetInput, SpreadsheetSheetInput, SpreadsheetColumnInput, SpreadsheetColumnTotal, SpreadsheetColumnHighlight } from './excel';
export type { PresentationInput, PresentationSlideInput, PresentationChartInput } from './powerpoint';
export type { ArchiveEntryInput } from './archive';
export type { ArtifactImageInput, ArtifactImage, ArtifactGenerateOptions } from './images';
export { artifactStore, createArtifactStore } from './storage';
export { buildZipArchive, resolveArchiveFileName } from './archive';
export { buildWordDocument, markdownToSections, parseMarkdownBlocks, resolveDocumentFileName } from './word';
export { buildSpreadsheet, resolveSpreadsheetFileName } from './excel';
export { buildPresentation, markdownToSlides, resolvePresentationFileName } from './powerpoint';
export { ARTIFACT_EXTENSIONS, ARTIFACT_MIME_TYPES, artifactDownloadUrl } from './types';
export { isValidArtifactId, sanitizeArchiveEntryName, sanitizeArtifactFileName } from './sanitize';
export { readArchiveEntries, readArchiveText } from './validate';

async function persist(store: ArtifactStore, kind: keyof typeof ARTIFACT_MIME_TYPES, name: string, build: { buffer: Buffer; warnings: string[] }): Promise<ArtifactGeneration> {
  const artifact = await store.save({ kind, name, data: build.buffer, mimeType: ARTIFACT_MIME_TYPES[kind] });
  return { artifact, warnings: build.warnings };
}

export async function generateDocumentArtifact(input: DocumentInput, store: ArtifactStore = artifactStore, options: ArtifactGenerateOptions = {}) {
  return persist(store, 'document', resolveDocumentFileName(input.filename), await buildWordDocument(input, options));
}

export async function generateSpreadsheetArtifact(input: SpreadsheetInput, store: ArtifactStore = artifactStore) {
  return persist(store, 'spreadsheet', resolveSpreadsheetFileName(input.filename), await buildSpreadsheet(input));
}

export async function generatePresentationArtifact(input: PresentationInput, store: ArtifactStore = artifactStore, options: ArtifactGenerateOptions = {}) {
  return persist(store, 'presentation', resolvePresentationFileName(input.filename), await buildPresentation(input, options));
}

export async function generateArchiveArtifact(
  input: { filename?: unknown; entries: readonly ArchiveEntryInput[] },
  store: ArtifactStore = artifactStore,
) {
  return persist(store, 'archive', resolveArchiveFileName(input.filename), buildZipArchive(input.entries));
}

/** 按 id 收集要打包的文件内容；模型无法指定任意磁盘路径。 */
export async function collectArchiveEntries(ids: readonly string[], store: ArtifactStore = artifactStore) {
  const stored = await store.list(ids);
  const entries: ArchiveEntryInput[] = [];
  const missing: string[] = [];
  for (const item of stored) {
    try {
      entries.push({ name: item.descriptor.name, data: new Uint8Array(await readFile(item.filePath)) });
    } catch {
      missing.push(item.descriptor.name);
    }
  }
  return { entries, missing, found: stored.length };
}
