import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;

function configuredRoot() {
  return path.resolve(process.env.SANMAO_AUDIO_STORAGE_PATH || path.join(dataDir, 'audio'));
}

export function getDefaultAudioStoragePath() { return configuredRoot(); }

function extensionFromContentType(contentType: string) {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  if (mime === 'audio/ogg' || mime === 'audio/oga') return 'ogg';
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/aac') return 'aac';
  if (mime === 'audio/flac') return 'flac';
  if (mime === 'audio/webm') return 'webm';
  return 'bin';
}

export function audioContentType(file: string) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.opus')) return 'audio/opus';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/mpeg';
}

export async function persistAudioBuffer(buffer: Buffer, contentType = 'audio/mpeg', configuredPath?: string) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0) throw new Error('没有返回有效的音频数据');
  if (buffer.byteLength > MAX_AUDIO_BYTES) throw new Error('音频超过 1GB，无法保存');
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const name = `${Date.now()}-${randomUUID()}.${extensionFromContentType(contentType)}`;
  await writeFile(path.join(root, name), buffer, { flag: 'wx' });
  return { url: `/api/storage/audio?name=${encodeURIComponent(name)}`, path: root, name, bytes: buffer.byteLength, contentType: audioContentType(name) };
}

export function resolveStoredAudioFile(root: string, name: string) {
  const base = path.resolve(root || configuredRoot());
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

export function isStoredAudio(root: string, name: string) {
  const file = resolveStoredAudioFile(root, name);
  return Boolean(file && existsSync(file));
}

export async function readStoredAudio(root: string, name: string) {
  const file = resolveStoredAudioFile(root, name);
  if (!file) return null;
  try { return { file, data: await readFile(file) }; } catch { return null; }
}
