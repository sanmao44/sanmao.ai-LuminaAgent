import type { ChatMessage } from '@/lib/providers';
import type {
  ArtifactDescriptor,
  DocumentInput,
  PresentationInput,
  SpreadsheetInput,
} from '@/lib/artifacts';
import type { ToolCall, ToolRuntimeState, GeneratedFile } from './capability-state';

export type ArtifactCapabilityInput = {
  state: ToolRuntimeState & { generatedArtifactCount: number };
  call: ToolCall;
  args: Record<string, unknown>;
  signal: AbortSignal;
  imageStoragePath?: string;
  infrastructure: ArtifactCapabilityInfrastructure;
};

export type ArtifactCapabilityInfrastructure = {
  maxPerTurn: number;
  isValidArtifactId: (id: unknown) => boolean;
  getStorageRoots: (configuredPath: string) => readonly string[];
  generateDocumentArtifact: (input: DocumentInput, store?: unknown, options?: { imageRoots: readonly string[] }) => Promise<{ artifact: ArtifactDescriptor; warnings: string[] }>;
  generateSpreadsheetArtifact: (input: SpreadsheetInput) => Promise<{ artifact: ArtifactDescriptor; warnings: string[] }>;
  generatePresentationArtifact: (input: PresentationInput, store?: unknown, options?: { imageRoots: readonly string[] }) => Promise<{ artifact: ArtifactDescriptor; warnings: string[] }>;
  collectArchiveEntries: (ids: readonly string[]) => Promise<{ entries: readonly { name: string; data: Uint8Array }[]; missing: string[] }>;
  generateArchiveArtifact: (input: { filename?: unknown; entries: readonly { name: string; data: Uint8Array }[] }) => Promise<{ artifact: ArtifactDescriptor; warnings: string[] }>;
};

function generatedFileFromArtifact(artifact: ArtifactDescriptor): GeneratedFile {
  return { name: artifact.name, mimeType: artifact.mimeType, size: artifact.size, artifactId: artifact.id, downloadUrl: artifact.downloadUrl };
}

function artifactToolError(call: ToolCall, error: unknown): ChatMessage {
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '文件生成失败' }) };
}

export async function executeArtifactCapability(input: ArtifactCapabilityInput): Promise<ChatMessage> {
  const { state, call, args, signal, infrastructure } = input;
  const toolName = String(call.function?.name || '');
  if (state.generatedArtifactCount >= infrastructure.maxPerTurn) return artifactToolError(call, `本轮最多生成 ${infrastructure.maxPerTurn} 个文件，请分次生成或减少文件数量。`);
  try {
    const artifactOptions = { imageRoots: infrastructure.getStorageRoots(input.imageStoragePath?.trim() || '') };
    if (toolName === 'document_generate') {
      const result = await infrastructure.generateDocumentArtifact(args as DocumentInput, undefined, artifactOptions);
      state.generatedArtifactCount += 1;
      const file = generatedFileFromArtifact(result.artifact);
      state.generatedFiles.push(file);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, warnings: result.warnings }) };
    }
    if (toolName === 'spreadsheet_generate') {
      const result = await infrastructure.generateSpreadsheetArtifact(args as SpreadsheetInput);
      state.generatedArtifactCount += 1;
      const file = generatedFileFromArtifact(result.artifact);
      state.generatedFiles.push(file);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, warnings: result.warnings }) };
    }
    if (toolName === 'presentation_generate') {
      const result = await infrastructure.generatePresentationArtifact(args as PresentationInput, undefined, artifactOptions);
      state.generatedArtifactCount += 1;
      const file = generatedFileFromArtifact(result.artifact);
      state.generatedFiles.push(file);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, warnings: result.warnings }) };
    }
    const requestedIds = (Array.isArray(args.artifactIds) ? args.artifactIds : []).filter((id: unknown) => infrastructure.isValidArtifactId(id)).map(String);
    const thisTurnIds = args.includeGeneratedThisTurn === false ? [] : state.generatedFiles.map((file) => file.artifactId).filter((id): id is string => typeof id === 'string');
    const ids = Array.from(new Set([...thisTurnIds, ...requestedIds]));
    if (!ids.length) return artifactToolError(call, '没有可打包的文件：请先生成文件，或提供有效的 artifactIds。');
    const collected = await infrastructure.collectArchiveEntries(ids);
    if (!collected.entries.length) return artifactToolError(call, '指定的文件已过期或被清理，请重新生成后再打包。');
    const result = await infrastructure.generateArchiveArtifact({ filename: args.filename, entries: collected.entries });
    state.generatedArtifactCount += 1;
    const file = generatedFileFromArtifact(result.artifact);
    state.generatedFiles.push(file);
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, included: collected.entries.length, skipped: collected.missing.length ? collected.missing : undefined, warnings: result.warnings }) };
  } catch (error) {
    if (signal.aborted) throw signal.reason || error;
    return artifactToolError(call, error);
  }
}
