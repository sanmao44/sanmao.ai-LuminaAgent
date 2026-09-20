export type ArtifactKind = 'document' | 'spreadsheet' | 'presentation' | 'archive' | /** 原样收下的文件：浏览器下载、截图这类不归 Office 管的产物。 */ 'file';

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
  // 只是兜底：导入时按真实扩展名给 mimeType，认不出来才用它。
  file: 'application/octet-stream',
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  archive: 'application/zip',
};

export const ARTIFACT_EXTENSIONS: Record<ArtifactKind, string> = {
  /** 空串表示「不强制扩展名」：下载下来的文件名是什么就存什么。 */
  file: '',
  document: '.docx',
  spreadsheet: '.xlsx',
  presentation: '.pptx',
  archive: '.zip',
};

/** 只按 id 取件的下载地址，客户端不需要、也不允许传磁盘路径。 */
export function artifactDownloadUrl(id: string) {
  return `/api/artifacts/${id}`;
}
