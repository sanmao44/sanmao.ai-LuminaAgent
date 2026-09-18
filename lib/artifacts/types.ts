export type ArtifactKind = 'document' | 'spreadsheet' | 'presentation' | 'archive';

export type ArtifactDescriptor = {
  id: string;
  kind: ArtifactKind;
  name: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  createdAt: number;
};

export type ArtifactBuild = {
  buffer: Buffer;
  warnings: string[];
};

export type ArtifactGeneration = {
  artifact: ArtifactDescriptor;
  warnings: string[];
};

export const ARTIFACT_MIME_TYPES: Record<ArtifactKind, string> = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  archive: 'application/zip',
};

export const ARTIFACT_EXTENSIONS: Record<ArtifactKind, string> = {
  document: '.docx',
  spreadsheet: '.xlsx',
  presentation: '.pptx',
  archive: '.zip',
};

/** 只按 id 取件的下载地址，客户端不需要、也不允许传磁盘路径。 */
export function artifactDownloadUrl(id: string) {
  return `/api/artifacts/${id}`;
}
