import { unzipSync } from 'fflate';

export function readArchiveEntries(buffer: Buffer | Uint8Array) {
  return unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
}

export function assertArchiveParts(buffer: Buffer | Uint8Array, requiredParts: readonly string[], label: string) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = readArchiveEntries(buffer);
  } catch {
    throw new Error(`${label} 结构校验失败：生成结果不是有效的 ZIP/OOXML 文件`);
  }
  const names = new Set(Object.keys(entries));
  const missing = requiredParts.filter((part) => !names.has(part));
  if (missing.length) throw new Error(`${label} 结构校验失败，缺少：${missing.join('、')}`);
  return entries;
}

export function readArchiveText(buffer: Buffer | Uint8Array, part: string) {
  const entries = readArchiveEntries(buffer);
  const data = entries[part];
  return data ? new TextDecoder('utf-8').decode(data) : '';
}
