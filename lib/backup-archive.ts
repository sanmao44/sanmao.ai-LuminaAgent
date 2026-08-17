import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export type BackupArchiveEntry = { name: string; data: Buffer };

function writeText(target: Buffer, offset: number, length: number, value: string) {
  target.write(value.slice(0, length), offset, length, 'utf8');
}

function writeOctal(target: Buffer, offset: number, length: number, value: number) {
  const text = Math.max(0, value).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  writeText(target, offset, length, `${text}\0`);
}

function tarHeader(name: string, size: number) {
  const header = Buffer.alloc(512, 0);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeText(header, 257, 6, 'ustar\0');
  writeText(header, 263, 2, '00');
  writeText(header, 265, 32, 'SANMAO.AI');
  writeText(header, 297, 32, 'SANMAO.AI');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function padded(data: Buffer) {
  const padding = (512 - (data.length % 512)) % 512;
  return padding ? Buffer.concat([data, Buffer.alloc(padding)]) : data;
}

export function sha256(data: Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

export function createBackupArchive(entries: BackupArchiveEntry[]) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.includes('..')) throw new Error('备份文件名无效');
    chunks.push(tarHeader(name, entry.data.length), padded(entry.data));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 6 });
}

export function extractBackupArchive(archive: Buffer) {
  const tar = gunzipSync(archive);
  const entries: BackupArchiveEntry[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!name || !Number.isSafeInteger(size) || size < 0 || name.startsWith('/') || name.split('/').includes('..')) throw new Error('备份归档内容无效');
    offset += 512;
    if (offset + size > tar.length) throw new Error('备份归档内容不完整');
    entries.push({ name, data: Buffer.from(tar.subarray(offset, offset + size)) });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}
