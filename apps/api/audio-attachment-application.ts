export const AUDIO_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

const AUDIO_EXTENSIONS: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
};

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
};

const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export type AudioAttachmentStorageResult = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
};

export type AudioAttachmentStorage = {
  save: (input: { name: string; mimeType: string; data: Uint8Array }) => Promise<AudioAttachmentStorageResult>;
};

export type AudioAttachmentUpload = {
  name: unknown;
  mimeType: unknown;
  data: Uint8Array;
};

export class AudioAttachmentError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AudioAttachmentError';
    this.status = status;
  }
}

function normalizedMimeType(value: unknown) {
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

function safeName(value: unknown) {
  const raw = typeof value === 'string' ? value : '';
  const base = raw.replace(/\\/g, '/').split('/').pop() || '';
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return cleaned || 'audio';
}

function resolveAudioFile(name: string, declaredMimeType: string) {
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
  const extensionMime = AUDIO_EXTENSIONS[extension];
  const mimeExtension = MIME_EXTENSIONS[declaredMimeType];
  if (extension && !extensionMime) {
    throw new AudioAttachmentError('只支持 MP3、WAV、M4A、AAC、FLAC、OGG、OPUS 和 WEBM 音频。', 415);
  }
  if (extensionMime && mimeExtension && extensionMime !== MIME_BY_EXTENSION[mimeExtension]) {
    throw new AudioAttachmentError('音频扩展名与文件类型不一致。', 415);
  }
  if (!extensionMime && !mimeExtension) {
    throw new AudioAttachmentError('无法识别音频格式，请使用 MP3、WAV、M4A、AAC、FLAC、OGG、OPUS 或 WEBM。', 415);
  }
  if (!GENERIC_MIME_TYPES.has(declaredMimeType) && !declaredMimeType.startsWith('audio/') && !(extension === 'webm' && declaredMimeType === 'video/webm')) {
    throw new AudioAttachmentError('上传内容不是受支持的音频文件。', 415);
  }
  const mimeType = extensionMime || MIME_BY_EXTENSION[mimeExtension];
  const resolvedExtension = extension || MIME_EXTENSIONS[mimeType] || 'mp3';
  const stem = extension ? name.slice(0, -(extension.length + 1)) : name;
  return { name: `${stem}.${resolvedExtension}`, mimeType };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
};

export async function uploadAudioAttachment(input: AudioAttachmentUpload, storage: AudioAttachmentStorage) {
  const name = safeName(input.name);
  const mimeType = normalizedMimeType(input.mimeType);
  const data = input.data;
  if (!data || data.byteLength === 0) throw new AudioAttachmentError('音频文件为空。', 400);
  if (data.byteLength > AUDIO_ATTACHMENT_MAX_BYTES) throw new AudioAttachmentError('音频文件不能超过 50MB。', 413);
  const normalized = resolveAudioFile(name, mimeType);
  const stored = await storage.save({ ...normalized, data });
  return {
    id: stored.id,
    name: stored.name,
    mimeType: stored.mimeType,
    size: stored.size,
    artifactId: stored.id,
    downloadUrl: stored.downloadUrl,
  };
}
