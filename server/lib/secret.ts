import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

let cachedKey: Buffer | null = null;

/**
 * Application secret for encrypting local credentials at rest.
 *
 * OPSITE_SECRET is preferred so the key can live outside the data volume.
 * Otherwise a random key is generated once under data/.secret. Losing that
 * file only invalidates stored SMTP passwords; it never touches other data.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (process.env.OPSITE_SECRET) {
    cachedKey = crypto.createHash('sha256').update(process.env.OPSITE_SECRET).digest();
    return cachedKey;
  }

  const file = path.join(dataDir, '.secret');
  try {
    const existing = fs.readFileSync(file);
    if (existing.length >= 32) {
      cachedKey = existing.subarray(0, 32);
      return cachedKey;
    }
  } catch {
    // file does not exist yet
  }

  const generated = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, generated, { mode: 0o600 });
  cachedKey = generated;
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivRaw, tagRaw, dataRaw] = payload.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) {
    throw new Error('不支持的凭据存储格式');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
