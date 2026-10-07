import { createCipheriv, createDecipheriv, randomBytes, scryptSync, type Cipher, type DecipherGCM } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';

const MAGIC = 'SANMAO-ENCRYPTED-BACKUP';
const VERSION = 1;
const PASSWORD_MIN_LENGTH = 12;
/**
 * Node 的 cipher/decipher.update 只接受 INT_MAX(2^31-1) 以内的入参，超过会抛
 * ERR_OUT_OF_RANGE: data is too long。备份归档包含全部素材，体积已经突破 2GB，
 * 必须分块喂入；分块不改变 GCM 的密文与认证标签，磁盘格式保持完全一致。
 */
const CIPHER_CHUNK_BYTES = 32 * 1024 * 1024;

type Envelope = {
  format: typeof MAGIC;
  version: number;
  kdf: 'scrypt';
  salt: string;
  iv: string;
  tag: string;
};

export function validateBackupPassword(password: string) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`备份密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`);
  }
}

function deriveKey(password: string, salt: Buffer) {
  return scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/**
 * GCM 是流式模式，密文与明文长度完全相等，因此可以一次分配结果缓冲区再边算
 * 边拷。备份动辄 2GB 以上，这样能省掉一整份拷贝（加密、解密各少 1 份）。
 */
function cipherUpdate(stream: Cipher | DecipherGCM, data: Buffer) {
  const output = Buffer.allocUnsafe(data.length);
  let written = 0;
  for (let offset = 0; offset < data.length; offset += CIPHER_CHUNK_BYTES) {
    const part = stream.update(data.subarray(offset, offset + CIPHER_CHUNK_BYTES));
    part.copy(output, written);
    written += part.length;
  }
  const tail = stream.final();
  if (written !== output.length || tail.length !== 0) throw new Error('备份加密输出长度异常');
  return output;
}

export function encryptBackupPayload(payload: Buffer, password: string) {
  validateBackupPassword(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const encrypted = cipherUpdate(cipher, payload);
  const envelope: Envelope = {
    format: MAGIC,
    version: VERSION,
    kdf: 'scrypt',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
  return Buffer.concat([Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8'), encrypted]);
}

/** Encrypt a disk-backed archive without retaining ciphertext in memory. */
export async function encryptBackupFile(inputPath: string, outputPath: string, password: string) {
  validateBackupPassword(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const placeholder = '0'.repeat(22);
  const envelope = { format: MAGIC, version: VERSION, kdf: 'scrypt' as const, salt: salt.toString('base64url'), iv: iv.toString('base64url'), tag: placeholder };
  const header = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
  const input = createReadStream(inputPath, { highWaterMark: 1024 * 1024 });
  const output = createWriteStream(outputPath, { flags: 'wx' });
  try {
    await writeCryptoChunk(output, header);
    for await (const raw of input) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      for (let offset = 0; offset < chunk.length; offset += CIPHER_CHUNK_BYTES) {
        const part = cipher.update(chunk.subarray(offset, offset + CIPHER_CHUNK_BYTES));
        if (part.length) await writeCryptoChunk(output, part);
      }
    }
    const tail = cipher.final();
    if (tail.length) await writeCryptoChunk(output, tail);
    await endCryptoOutput(output);
    const tag = cipher.getAuthTag().toString('base64url');
    const finalHeader = Buffer.from(`${JSON.stringify({ ...envelope, tag })}\n`, 'utf8');
    if (finalHeader.length !== header.length) throw new Error('Backup encryption header length changed');
    const handle = await open(outputPath, 'r+');
    try { await handle.write(finalHeader, 0, finalHeader.length, 0); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) {
    input.destroy();
    output.destroy();
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function isEncryptedBackup(payload: Buffer) {
  const newline = payload.indexOf(0x0a);
  if (newline <= 0) return false;
  try {
    const envelope = JSON.parse(payload.subarray(0, newline).toString('utf8')) as Partial<Envelope>;
    return envelope.format === MAGIC && envelope.version === VERSION;
  } catch {
    return false;
  }
}

export async function isEncryptedBackupFile(filePath: string) {
  const input = createReadStream(filePath, { start: 0, end: 64 * 1024 - 1 });
  let data = Buffer.alloc(0);
  for await (const raw of input) {
    data = Buffer.concat([data, Buffer.isBuffer(raw) ? raw : Buffer.from(raw)]);
    if (data.includes(0x0a) || data.length >= 64 * 1024) break;
  }
  return isEncryptedBackup(data);
}

export function decryptBackupPayload(payload: Buffer, password: string) {
  validateBackupPassword(password);
  const newline = payload.indexOf(0x0a);
  if (newline <= 0) throw new Error('备份加密头无效');
  let envelope: Envelope;
  try { envelope = JSON.parse(payload.subarray(0, newline).toString('utf8')) as Envelope; } catch { throw new Error('备份加密头无效'); }
  if (envelope.format !== MAGIC || envelope.version !== VERSION || envelope.kdf !== 'scrypt') throw new Error('不支持的备份加密版本');
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, Buffer.from(envelope.salt, 'base64url')), Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return cipherUpdate(decipher, payload.subarray(newline + 1));
  } catch {
    throw new Error('备份密码错误或备份文件已被篡改');
  }
}

/** Decrypt the v1 envelope without materialising the ciphertext or plaintext. */
export async function decryptBackupFile(inputPath: string, outputPath: string, password: string) {
  validateBackupPassword(password);
  const input = createReadStream(inputPath, { highWaterMark: 1024 * 1024 });
  const output = createWriteStream(outputPath, { flags: 'wx' });
  let headerBuffer = Buffer.alloc(0);
  let decipher: DecipherGCM | null = null;
  let headerRead = false;
  try {
    for await (const raw of input) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let ciphertext = chunk;
      if (!headerRead) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const newline = headerBuffer.indexOf(0x0a);
        if (newline < 0) {
          if (headerBuffer.length > 16 * 1024) throw new Error('备份加密头无效');
          continue;
        }
        let envelope: Envelope;
        try { envelope = JSON.parse(headerBuffer.subarray(0, newline).toString('utf8')) as Envelope; } catch { throw new Error('备份加密头无效'); }
        if (envelope.format !== MAGIC || envelope.version !== VERSION || envelope.kdf !== 'scrypt') throw new Error('不支持的备份加密版本');
        decipher = createDecipheriv('aes-256-gcm', deriveKey(password, Buffer.from(envelope.salt, 'base64url')), Buffer.from(envelope.iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
        headerRead = true;
        ciphertext = headerBuffer.subarray(newline + 1);
      }
      if (ciphertext.length && decipher) {
        for (let offset = 0; offset < ciphertext.length; offset += CIPHER_CHUNK_BYTES) {
          const part = decipher.update(ciphertext.subarray(offset, offset + CIPHER_CHUNK_BYTES));
          if (part.length) await writeCryptoChunk(output, part);
        }
      }
    }
    if (!headerRead || !decipher) throw new Error('备份加密头无效');
    const tail = decipher.final();
    if (tail.length) await writeCryptoChunk(output, tail);
    await endCryptoOutput(output);
  } catch {
    input.destroy();
    output.destroy();
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw new Error('备份密码错误或备份文件已被篡改');
  }
}

function writeCryptoChunk(output: ReturnType<typeof createWriteStream>, chunk: Buffer) {
  if (output.write(chunk)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { output.off('drain', onDrain); reject(error); };
    const onDrain = () => { output.off('error', onError); resolve(); };
    output.once('error', onError);
    output.once('drain', onDrain);
  });
}

function endCryptoOutput(output: ReturnType<typeof createWriteStream>) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { output.off('finish', onFinish); reject(error); };
    const onFinish = () => { output.off('error', onError); resolve(); };
    output.once('error', onError);
    output.once('finish', onFinish);
    output.end();
  });
}

