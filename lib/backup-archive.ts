import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createGunzip, createGzip, gunzipSync } from 'node:zlib';

export type BackupArchiveEntry = { name: string; data: Buffer };
export type BackupArchiveSource = BackupArchiveEntry | { name: string; filePath: string; size: number };
export type BackupArchiveFileEntry = { name: string; filePath: string; size: number; sha256: string };
export type ExtractedBackupArchiveEntry = BackupArchiveEntry | BackupArchiveFileEntry;

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
export function sha256(data: Buffer) {
  const hash = createHash('sha256');
  for (let offset = 0; offset < data.length; offset += HASH_CHUNK_BYTES) {
    hash.update(data.subarray(offset, offset + HASH_CHUNK_BYTES));
  }
  return hash.digest('hex');
}

export async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    for (let offset = 0; offset < chunk.length; offset += HASH_CHUNK_BYTES) {
      hash.update(chunk.subarray(offset, offset + HASH_CHUNK_BYTES));
    }
  }
  return hash.digest('hex');
}

export async function describeBackupSource(source: BackupArchiveSource) {
  if ('data' in source) return { bytes: source.data.byteLength, sha256: sha256(source.data) };
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new Error('备份文件大小无效');
  return { bytes: source.size, sha256: await sha256File(source.filePath) };
}

function writeChunk(stream: ReturnType<typeof createGzip>, chunk: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { stream.off('drain', onDrain); reject(error); };
    const onDrain = () => { stream.off('error', onError); resolve(); };
    stream.once('error', onError);
    if (stream.write(chunk)) {
      stream.off('error', onError);
      resolve();
    } else stream.once('drain', onDrain);
  });
}

async function writeFileSource(stream: ReturnType<typeof createGzip>, filePath: string) {
  let bytes = 0;
  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    await writeChunk(stream, value);
  }
  return bytes;
}

export async function createBackupArchive(entries: BackupArchiveSource[]) {
  const gzip = createGzip({ level: 6, chunkSize: 1024 * 1024 });
  const parts: Buffer[] = [];
  gzip.on('data', (chunk: Buffer) => parts.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    gzip.on('error', reject);
    gzip.on('end', () => resolve(parts.length === 1 ? parts[0] : Buffer.concat(parts)));
  });
  try {
    for (const entry of entries) {
      const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!name || name.split('/').includes('..')) throw new Error('备份文件名无效');
      const size = 'data' in entry ? entry.data.length : entry.size;
      await writeChunk(gzip, tarHeader(name, size));
      if (size) {
        if ('data' in entry) await writeChunk(gzip, entry.data);
        else if (await writeFileSource(gzip, entry.filePath) !== size) throw new Error(`备份文件在读取期间发生变化：${name}`);
      }
      const padding = (512 - (size % 512)) % 512;
      if (padding) await writeChunk(gzip, Buffer.alloc(padding));
    }
    await writeChunk(gzip, Buffer.alloc(1024));
    gzip.end();
    return await finished;
  } catch (error) {
    gzip.destroy(error as Error);
    await finished.catch(() => undefined);
    throw error;
  }
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
 * Extract an archive directly to a staging directory. The tar parser only keeps
 * one input chunk and writes each entry to disk, so restore no longer needs a
 * second in-memory copy of a large media archive. The returned file paths are
 * private staging files and must be removed by the caller after restore.
 */
export async function extractBackupArchiveFile(archivePath: string, stagingDir: string): Promise<BackupArchiveFileEntry[]> {
  await mkdir(stagingDir, { recursive: true });
  const gunzip = createGunzip({ chunkSize: 1024 * 1024 });
  const input = createReadStream(archivePath, { highWaterMark: 1024 * 1024 });
  input.pipe(gunzip);
  const entries: BackupArchiveFileEntry[] = [];
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let current: {
    name: string;
    size: number;
    remaining: number;
    padding: number;
    filePath: string;
    output: ReturnType<typeof createWriteStream>;
    hash: ReturnType<typeof createHash>;
  } | null = null;
  let finished = false;
  let index = 0;

  const finishEntry = async () => {
    if (!current) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { current?.output.off('finish', onFinish); reject(error); };
      const onFinish = () => { current?.output.off('error', onError); resolve(); };
      current!.output.once('error', onError);
      current!.output.once('finish', onFinish);
      current!.output.end();
    });
    entries.push({ name: current.name, filePath: current.filePath, size: current.size, sha256: current.hash.digest('hex') });
    current = null;
  };

  const writeEntryChunk = async (chunk: Buffer) => {
    if (!current || chunk.length === 0) return;
    current.hash.update(chunk);
    if (current.output.write(chunk)) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { current?.output.off('drain', onDrain); reject(error); };
      const onDrain = () => { current?.output.off('error', onError); resolve(); };
      current!.output.once('error', onError);
      current!.output.once('drain', onDrain);
    });
  };

  const consume = async (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) as Buffer<ArrayBufferLike> : chunk;
    while (pending.length) {
      if (current) {
        if (current.remaining > 0) {
          const take = Math.min(current.remaining, pending.length);
          await writeEntryChunk(pending.subarray(0, take));
          current.remaining -= take;
          pending = pending.subarray(take);
          if (current.remaining > 0) continue;
        }
        if (pending.length < current.padding) return;
        if (current.padding) pending = pending.subarray(current.padding);
        await finishEntry();
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
      if (entries.some((entry) => entry.name === name)) throw new Error(`备份归档包含重复文件：${name}`);
      const filePath = path.join(stagingDir, `${index++}.entry`);
      current = { name, size, remaining: size, padding: (512 - (size % 512)) % 512, filePath, output: createWriteStream(filePath, { flags: 'wx' }), hash: createHash('sha256') };
    }
  };

  try {
    for await (const chunk of gunzip) await consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (current || !finished) throw new Error('备份归档内容不完整');
    return entries;
  } catch (error) {
    input.destroy();
    gunzip.destroy(error as Error);
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * 完整备份的恢复端还有硬上限。导出时必须边收集边结算，超限立刻停下——否则
 * 只会生成一个"导出成功、恢复失败"的静默陷阱。
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
