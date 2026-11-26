import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

/** Stored as scrypt$<salt hex>$<hash hex>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, PARAMS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only a hash of the session token is stored, so a database leak doesn't hand out live sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
