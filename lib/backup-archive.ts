import { createHash } from 'node:crypto';
import { createGunzip, createGzip, gunzipSync } from 'node:zlib';

export type BackupArchiveEntry = { name: string; data: Buffer };

/** 单次 hash/cipher update 的入参超过 INT_MAX 会抛 ERR_OUT_OF_RANGE，必须分块。 */
const HASH_CHUNK_BYTES = 32 * 1024 * 1024;

function writeText(target: Buffer, offset: number, length: number, value: string) {
  target.write(value.slice(0, length), offset, length, 'utf8');
}

function writeOctal(target: Buffer, offset: number, length: number, value: number) {
  const text = Math.max(0, value).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  writeText(target, offset, length, `${text}\0`);
}

/** ustar 允许把过长路径的目录部分放进 prefix 字段，避免文件名被静默截断。 */
function tarNameFields(name: string) {
  if (Buffer.byteLength(name, 'utf8') <= 100) return { name, prefix: '' };
  for (let index = name.lastIndexOf('/'); index > 0; index = name.lastIndexOf('/', index - 1)) {
    const prefix = name.slice(0, index);
    const rest = name.slice(index + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(rest, 'utf8') <= 100) return { name: rest, prefix };
  }
  throw new Error('备份文件名过长');
}

function tarHeader(name: string, size: number) {
  const header = Buffer.alloc(512, 0);
  const fields = tarNameFields(name);
  writeText(header, 0, 100, fields.name);
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
  if (fields.prefix) writeText(header, 345, 155, fields.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

/**
 * 同步 gzip 会占满事件循环：实测 2GB 快照让整个服务冻结 42 秒，期间所有接口和
 * 媒体流一起停摆。这里把 tar 片段直接写进异步 gzip 流（压缩在 libuv 线程池里跑），
 * 既不再冻结服务，也省掉了“先拼完整 tar 再压缩”的那一整份拷贝。
 */
function gzipChunks(chunks: Buffer[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const gzip = createGzip({ level: 6, chunkSize: 1024 * 1024 });
    const parts: Buffer[] = [];
    gzip.on('data', (chunk: Buffer) => parts.push(chunk));
    gzip.on('error', reject);
    gzip.on('end', () => resolve(parts.length === 1 ? parts[0] : Buffer.concat(parts)));
    for (const chunk of chunks) gzip.write(chunk);
    gzip.end();
  });
}

export function sha256(data: Buffer) {
  const hash = createHash('sha256');
  for (let offset = 0; offset < data.length; offset += HASH_CHUNK_BYTES) {
    hash.update(data.subarray(offset, offset + HASH_CHUNK_BYTES));
  }
  return hash.digest('hex');
}

export async function createBackupArchive(entries: BackupArchiveEntry[]) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.split('/').includes('..')) throw new Error('备份文件名无效');
    // 逐段入列：不再为每个条目复制一份带填充的数据（2GB 素材曾因此多占 2GB 内存）。
    chunks.push(tarHeader(name, entry.data.length));
    if (entry.data.length) chunks.push(entry.data);
    const padding = (512 - (entry.data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipChunks(chunks);
}

export function extractBackupArchive(archive: Buffer) {
  const tar = gunzipSync(archive);
  const entries: BackupArchiveEntry[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const shortName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefixText = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const name = prefixText ? prefixText + '/' + shortName : shortName;
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!name || !Number.isSafeInteger(size) || size < 0 || name.startsWith('/') || name.split('/').includes('..')) throw new Error('备份归档内容无效');
    offset += 512;
    if (offset + size > tar.length) throw new Error('备份归档内容不完整');
    // 直接返回 tar 上的视图。归档可能超过 2GB，再整卷拷一份会让恢复峰值翻倍；
    // 调用方只读取、不修改条目内容，视图与切片等价。
    entries.push({ name, data: tar.subarray(offset, offset + size) });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * Streaming counterpart used by restore paths. It keeps the encrypted input
 * and each extracted file, but does not materialize a second Buffer for the
 * complete uncompressed tar archive. This is intentionally additive so older
 * callers and backup files retain their synchronous compatibility API.
 */
export async function extractBackupArchiveStreaming(archive: Buffer) {
  const gunzip = createGunzip({ chunkSize: 1024 * 1024 });
  const entries: BackupArchiveEntry[] = [];
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let current: { name: string; size: number; parts: Buffer[]; remaining: number; padding: number } | null = null;
  let finished = false;

  const consume = (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) as Buffer : chunk;
    while (pending.length) {
      if (current) {
        if (current.remaining > 0) {
          const take = Math.min(current.remaining, pending.length);
          current.parts.push(pending.subarray(0, take));
          current.remaining -= take;
          pending = pending.subarray(take);
          if (current.remaining > 0) continue;
        }
        if (pending.length < current.padding) return;
        if (current.padding) pending = pending.subarray(current.padding);
        entries.push({ name: current.name, data: current.parts.length === 1 ? current.parts[0] : Buffer.concat(current.parts, current.size) });
        current = null;
        continue;
      }
      if (pending.length < 512) return;
      const header = pending.subarray(0, 512);
      pending = pending.subarray(512);
      if (header.every((byte) => byte === 0)) { finished = true; return; }
      const shortName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
      const prefixText = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
      const name = prefixText ? prefixText + '/' + shortName : shortName;
      const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
      const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
      if (!name || !Number.isSafeInteger(size) || size < 0 || name.startsWith('/') || name.split('/').includes('..')) throw new Error('备份归档内容无效');
      current = { name, size, parts: [], remaining: size, padding: (512 - (size % 512)) % 512 };
    }
  };

  const error = await new Promise<Error | null>((resolve) => {
    gunzip.on('data', (chunk: Buffer) => {
      try { consume(chunk); } catch (cause) { gunzip.destroy(cause as Error); }
    });
    gunzip.on('error', (cause) => resolve(cause instanceof Error ? cause : new Error(String(cause))));
    gunzip.on('end', () => resolve(null));
    gunzip.end(archive);
  });
  if (error) throw error;
  if (current || !finished) throw new Error('备份归档内容不完整');
  return entries;
}

/**
 * 完整备份的导出与恢复都是整卷进内存，恢复端还有硬上限。导出时必须边收集边
 * 结算，超限立刻停下——否则只会生成一个"导出成功、恢复失败"的静默陷阱。
 */
export function createArchiveBudget(limitBytes: number, label: string) {
  let total = 0;
  return {
    add(bytes: number, name: string) {
      total += Math.max(0, bytes);
      if (total > limitBytes) throw new Error(`备份体积超过恢复上限 ${label}（已到 ${name}），请先清理素材或分批导出`);
    },
    used: () => total,
  };
}
