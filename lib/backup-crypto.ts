import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = 'SANMAO-ENCRYPTED-BACKUP';
const VERSION = 1;
const PASSWORD_MIN_LENGTH = 12;

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

export function encryptBackupPayload(payload: Buffer, password: string) {
  validateBackupPassword(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
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
    return Buffer.concat([decipher.update(payload.subarray(newline + 1)), decipher.final()]);
  } catch {
    throw new Error('备份密码错误或备份文件已被篡改');
  }
}

