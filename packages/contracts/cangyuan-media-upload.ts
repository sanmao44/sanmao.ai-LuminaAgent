export type CangyuanMediaUploadKind = 'audio' | 'image' | 'video';

export type CangyuanMediaUploadInput = {
  kind: CangyuanMediaUploadKind;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type CangyuanMediaUploadResult = {
  url: string;
  expiresAt?: string;
  mimeType: string;
  bytes: number;
};

export type CangyuanMediaUploadPort = {
  publish(input: CangyuanMediaUploadInput): Promise<Pick<CangyuanMediaUploadResult, 'url' | 'expiresAt'>>;
};
