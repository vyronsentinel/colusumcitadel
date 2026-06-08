import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM field-level encryption for sensitive PII (TIN, bank, gov't IDs).
const KEY = Buffer.from(config.fieldEncryptionKey, 'hex');
if (KEY.length !== 32) {
  // Surface a clear error early rather than failing per-request.
  console.warn('[crypto] FIELD_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Encryption disabled until fixed.');
}

export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  if (KEY.length !== 32) return String(plain); // dev fallback
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(blob) {
  if (blob == null || blob === '') return null;
  if (KEY.length !== 32) return blob;
  try {
    const raw = Buffer.from(blob, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
