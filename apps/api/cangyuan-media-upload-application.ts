import type { CangyuanMediaUploadInput, CangyuanMediaUploadPort, CangyuanMediaUploadResult } from '@/packages/contracts/cangyuan-media-upload';

export const CANGYUAN_IMAGE_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
export const CANGYUAN_AUDIO_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const CANGYUAN_VIDEO_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export class CangyuanMediaUploadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CangyuanMediaUploadInputError';
  }
}

function normalizeMime(value: string) {
  const mime = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'audio/x-wav') return 'audio/wav';
  if (mime === 'audio/x-m4a' || mime === 'audio/m4a') return 'audio/mp4';
  if (mime === 'audio/x-flac') return 'audio/flac';
  if (mime === 'audio/oga') return 'audio/ogg';
  if (mime === 'audio/x-aac') return 'audio/aac';
  if (mime === 'video/x-m4v') return 'video/mp4';
  return mime;
}

function hasAudioSignature(bytes: Uint8Array, mime: string) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mime === 'audio/mpeg') return ascii(0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (mime === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime === 'audio/flac') return ascii(0, 4) === 'fLaC';
  if (mime === 'audio/aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (mime === 'audio/mp4') return ascii(4, 4) === 'ftyp';
  return false;
}

function hasImageSignature(bytes: Uint8Array, mime: string) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (mime === 'image/webp') return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (mime === 'image/gif') return bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a');
  return false;
}

function hasVideoSignature(bytes: Uint8Array, mime: string) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mime === 'video/mp4' || mime === 'video/quicktime') return bytes.byteLength >= 12 && ascii(4, 4) === 'ftyp';
  if (mime === 'video/webm') return bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}

function validateInput(input: CangyuanMediaUploadInput) {
  const mimeType = normalizeMime(input.mimeType);
  const allowedMimeTypes = input.kind === 'image' ? IMAGE_MIME_TYPES : input.kind === 'audio' ? AUDIO_MIME_TYPES : VIDEO_MIME_TYPES;
  const maximumBytes = input.kind === 'image' ? CANGYUAN_IMAGE_UPLOAD_MAX_BYTES : input.kind === 'audio' ? CANGYUAN_AUDIO_UPLOAD_MAX_BYTES : CANGYUAN_VIDEO_UPLOAD_MAX_BYTES;
  const label = input.kind === 'image' ? '图片' : input.kind === 'audio' ? '音频' : '视频';
  const maximumMiB = Math.round(maximumBytes / 1024 / 1024);
  if (!input.bytes.byteLength) throw new CangyuanMediaUploadInputError('文件内容为空。');
  if (input.bytes.byteLength > maximumBytes) {
    throw new CangyuanMediaUploadInputError(`${label}不能超过 ${maximumMiB} MiB（本站上传限制）。`);
  }
  if (!allowedMimeTypes.has(mimeType)) {
    throw new CangyuanMediaUploadInputError(input.kind === 'image'
      ? '图片仅支持 JPG、PNG、WebP 或 GIF。'
      : input.kind === 'audio'
        ? '音频仅支持 MP3、WAV、OGG、FLAC、AAC 或 M4A。'
        : '视频仅支持 MP4、MOV 或 WebM。');
  }
  if (input.kind === 'image' && !hasImageSignature(input.bytes, mimeType)) {
    throw new CangyuanMediaUploadInputError('文件内容与图片格式不匹配，请选择有效的 JPG、PNG、WebP 或 GIF 文件。');
  }
  if (input.kind === 'audio' && !hasAudioSignature(input.bytes, mimeType)) {
    throw new CangyuanMediaUploadInputError('文件内容与音频格式不匹配，请选择有效的音频文件。');
  }
  if (input.kind === 'video' && !hasVideoSignature(input.bytes, mimeType)) {
    throw new CangyuanMediaUploadInputError('文件内容与视频格式不匹配，请选择有效的 MP4、MOV 或 WebM 文件。');
  }
  return { ...input, mimeType };
}

export async function uploadCangyuanMedia(input: CangyuanMediaUploadInput, port: CangyuanMediaUploadPort): Promise<CangyuanMediaUploadResult> {
  const valid = validateInput(input);
  const published = await port.publish(valid);
  return {
    ...published,
    mimeType: valid.mimeType,
    bytes: valid.bytes.byteLength,
  };
}
