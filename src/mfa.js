import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decryptDocument, encryptDocument } from './document-crypto.js';

const step = 30_000;
const setupLifetime = 10 * 60_000;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const mfaSchema = `
  CREATE TABLE IF NOT EXISTS account_mfa (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL,
    pending_until INTEGER NOT NULL, last_counter INTEGER NOT NULL DEFAULT -1
  ) STRICT;
  CREATE TABLE IF NOT EXISTS mfa_recovery (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    digest BLOB NOT NULL, PRIMARY KEY(account_id, digest)
  ) STRICT;
  PRAGMA user_version = 16;
`;

export function formatSecret(bytes) {
  const bits = [...bytes].map((byte) => byte.toString(2).padStart(8, '0')).join('');
  return bits.match(/.{1,5}/g).map((part) => alphabet[parseInt(part.padEnd(5, '0'), 2)]).join('');
}

export function totp(secret, counter) {
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(time).digest();
  const offset = digest.at(-1) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function matchCounter(secret, code, at, last) {
  if (!/^\d{6}$/.test(code)) return undefined;
  const provided = Buffer.from(code);
  const current = Math.floor(at / step);
  return [current, current - 1, current + 1].find((counter) =>
    counter >= 0 && counter > last && timingSafeEqual(provided, Buffer.from(totp(secret, counter))));
}

export function mfaStore(db, workspaceKey, now, transact, revokeOthers) {
  const key = createHmac('sha256', workspaceKey).update('nri-mfa-encryption-v1').digest();
  const recoveryKey = createHmac('sha256', workspaceKey).update('nri-mfa-recovery-v1').digest();
  const get = db.prepare('SELECT * FROM account_mfa WHERE account_id = ?');
  const upsert = db.prepare(`
    INSERT INTO account_mfa(account_id, nonce, ciphertext, tag, pending_until) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET nonce=excluded.nonce, ciphertext=excluded.ciphertext,
      tag=excluded.tag, pending_until=excluded.pending_until, last_counter=-1
  `);
  const activate = db.prepare('UPDATE account_mfa SET pending_until = 0, last_counter = ? WHERE account_id = ?');
  const consume = db.prepare('UPDATE account_mfa SET last_counter = ? WHERE account_id = ? AND last_counter < ?');
  const addRecovery = db.prepare('INSERT INTO mfa_recovery VALUES (?, ?)');
  const useRecovery = db.prepare('DELETE FROM mfa_recovery WHERE account_id = ? AND digest = ?');
  const clearRecovery = db.prepare('DELETE FROM mfa_recovery WHERE account_id = ?');
  const clear = db.prepare('DELETE FROM account_mfa WHERE account_id = ?');
  const recoveryHash = (account, code) => createHmac('sha256', recoveryKey).update(account + ':' + code).digest();
  const secret = (account, row) => decryptDocument(key, account, 'totp', { ...row, number: 1 });

  function verify(account, row, input) {
    if (!row || row.pending_until !== 0) return false;
    const code = input.trim().toUpperCase();
    if (/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(code)) {
      return useRecovery.run(account, recoveryHash(account, code)).changes === 1;
    }
    const counter = matchCounter(secret(account, row), code, now(), row.last_counter);
    return counter !== undefined && consume.run(counter, account, counter).changes === 1;
  }

  return {
    enabled(account) {
      return get.get(account)?.pending_until === 0;
    },
    pending(account) {
      const row = get.get(account);
      return row?.pending_until > now() ? formatSecret(secret(account, row)) : undefined;
    },
    begin(account) {
      return transact(db, () => {
        if (get.get(account)?.pending_until === 0) return false;
        const { nonce, ciphertext, tag } = encryptDocument(key, account, 'totp', 1, randomBytes(20));
        upsert.run(account, nonce, ciphertext, tag, now() + setupLifetime);
        return true;
      });
    },
    confirm(account, code, token) {
      return transact(db, () => {
        const row = get.get(account);
        if (!row || row.pending_until <= now()) return undefined;
        const counter = matchCounter(secret(account, row), code.trim(), now(), -1);
        if (counter === undefined) return undefined;
        activate.run(counter, account);
        clearRecovery.run(account);
        revokeOthers(account, token);
        return Array.from({ length: 8 }, () => {
          const recovery = randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
          addRecovery.run(account, recoveryHash(account, recovery));
          return recovery;
        });
      });
    },
    authorizePrivacy(account, code, stillSignedIn, operation) {
      return transact(db, () => {
        if (!stillSignedIn()) return { status: 403 };
        const row = get.get(account);
        if (row?.pending_until === 0 && !verify(account, row, code)) return { status: 401 };
        return operation();
      });
    },
    verify(account, code) {
      return transact(db, () => verify(account, get.get(account), code));
    },
    disable(account, code, token) {
      return transact(db, () => {
        if (!verify(account, get.get(account), code)) return false;
        clearRecovery.run(account);
        clear.run(account);
        revokeOthers(account, token);
        return true;
      });
    },
  };
}
