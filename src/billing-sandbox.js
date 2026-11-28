import { createHmac, timingSafeEqual } from 'node:crypto';

const toleranceMs = 5 * 60_000;
const maximumBodyBytes = 32 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function createSandboxBillingAdapter(provider, key) {
  if (!Buffer.isBuffer(key) || key.length < 32) throw new TypeError('Use a sandbox key of at least 32 bytes.');
  const secret = Buffer.from(key);
  return Object.freeze({
    mode: 'sandbox',
    provider,
    verify(envelope, now) {
      const { body, signature, timestamp } = envelope ?? {};
      if (!Buffer.isBuffer(body) || body.length > maximumBodyBytes || !Number.isSafeInteger(timestamp) ||
          Math.abs(now - timestamp) > toleranceMs ||
          typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return undefined;
      const digest = createHmac('sha256', secret).update(String(timestamp) + '.').update(body).digest();
      if (!timingSafeEqual(digest, Buffer.from(signature, 'hex'))) return undefined;
      try {
        return JSON.parse(utf8.decode(body));
      } catch {
        return undefined;
      }
    },
  });
}
