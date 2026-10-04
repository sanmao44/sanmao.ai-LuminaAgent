export type ArtifactKind = 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'file';
export type ArtifactDescriptor = {
  id: string;
  kind: ArtifactKind;
  name: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  createdAt: number;
};

/** Tool inputs remain schema-shaped records at the runtime boundary. */
export type DocumentInput = Record<string, unknown>;
export type SpreadsheetInput = Record<string, unknown>;
export type PresentationInput = Record<string, unknown>;
