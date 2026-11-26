import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16);
const dummyHash = randomBytes(32);

export function normalizeAddress(input) {
  const address = input.trim().toLowerCase();
  return address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address) ? address : null;
}

export async function hashPassword(password) {
  if (password.length < 15 || password.length > 128) {
    throw new Error('Use a password of 15 to 128 characters.');
  }
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, options);
  return { salt, hash };
}

export async function verifyPassword(password, credentials) {
  const salt = credentials?.salt ?? dummySalt;
  const expectedHash = credentials?.hash ?? dummyHash;
  const hash = await derive(password, salt, 32, options);
  return timingSafeEqual(hash, expectedHash) && Boolean(credentials);
}
