import type { ChatMessage } from '@/lib/providers';
import {
  collectArchiveEntries,
  generateArchiveArtifact,
  generateDocumentArtifact,
  generatePresentationArtifact,
  generateSpreadsheetArtifact,
  isValidArtifactId,
  type ArtifactDescriptor,
  type DocumentInput,
  type PresentationInput,
  type SpreadsheetInput,
} from '@/lib/artifacts';
import { ARTIFACT_MAX_PER_TURN } from '@/lib/artifacts/limits';
import { getStorageRoots } from '@/lib/image-storage';
import type { ToolCall, ToolRuntimeState, GeneratedFile } from './capability-state';

export type ArtifactCapabilityInput = {
  state: ToolRuntimeState & { generatedArtifactCount: number };
  call: ToolCall;
  args: Record<string, unknown>;
  signal: AbortSignal;
  imageStoragePath?: string;
};

function generatedFileFromArtifact(artifact: ArtifactDescriptor): GeneratedFile {
  return { name: artifact.name, mimeType: artifact.mimeType, size: artifact.size, artifactId: artifact.id, downloadUrl: artifact.downloadUrl };
}

function artifactToolError(call: ToolCall, error: unknown): ChatMessage {
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '文件生成失败' }) };
}

export async function executeArtifactCapability(input: ArtifactCapabilityInput): Promise<ChatMessage> {
  const { state, call, args, signal } = input;
  const toolName = String(call.function?.name || '');
  if (state.generatedArtifactCount >= ARTIFACT_MAX_PER_TURN) return artifactToolError(call, `本轮最多生成 ${ARTIFACT_MAX_PER_TURN} 个文件，请分次生成或减少文件数量。`);
  try {
    const artifactOptions = { imageRoots: getStorageRoots(input.imageStoragePath?.trim() || '') };
    if (toolName === 'document_generate') {
      const result = await generateDocumentArtifact(args as DocumentInput, undefined, artifactOptions);
      state.generatedArtifactCount += 1;
      const file = generatedFileFromArtifact(result.artifact);
      state.generatedFiles.push(file);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, warnings: result.warnings }) };
    }
    if (toolName === 'spreadsheet_generate') {
      const result = await generateSpreadsheetArtifact(args as SpreadsheetInput);
      state.generatedArtifactCount += 1;
      const file = generatedFileFromArtifact(result.artifact);
      state.generatedFiles.push(file);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, warnings: result.warnings }) };
    }
    if (toolName === 'presentation_generate') {
      const result = await generatePresentationArtifact(args as PresentationInput, undefined, artifactOptions);
      state.generatedArtifactCount += 1;
      const file = generatedFileFromArtifact(result.artifact);
      state.generatedFiles.push(file);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, warnings: result.warnings }) };
    }
    const requestedIds = (Array.isArray(args.artifactIds) ? args.artifactIds : []).filter((id: unknown) => isValidArtifactId(id)).map(String);
    const thisTurnIds = args.includeGeneratedThisTurn === false ? [] : state.generatedFiles.map((file) => file.artifactId).filter((id): id is string => typeof id === 'string');
    const ids = Array.from(new Set([...thisTurnIds, ...requestedIds]));
    if (!ids.length) return artifactToolError(call, '没有可打包的文件：请先生成文件，或提供有效的 artifactIds。');
    const collected = await collectArchiveEntries(ids);
    if (!collected.entries.length) return artifactToolError(call, '指定的文件已过期或被清理，请重新生成后再打包。');
    const result = await generateArchiveArtifact({ filename: args.filename, entries: collected.entries });
    state.generatedArtifactCount += 1;
    const file = generatedFileFromArtifact(result.artifact);
    state.generatedFiles.push(file);
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file, included: collected.entries.length, skipped: collected.missing.length ? collected.missing : undefined, warnings: result.warnings }) };
  } catch (error) {
    if (signal.aborted) throw signal.reason || error;
    return artifactToolError(call, error);
  }
}
