import { createHmac } from 'node:crypto';
import { decryptDocument, encryptDocument } from './document-crypto.js';

export const workspaceKeyVersionSchema = `
  CREATE TABLE IF NOT EXISTS workspace_key_rotations (
    generation INTEGER PRIMARY KEY CHECK(generation >= 2),
    rotated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workspace_recovery_key (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    nonce BLOB NOT NULL CHECK(length(nonce) = 12),
    ciphertext BLOB NOT NULL CHECK(length(ciphertext) = 32),
    tag BLOB NOT NULL CHECK(length(tag) = 16)
  ) STRICT;
  PRAGMA user_version = 28;
`;

const domain = 'nri-recovery-key-wrap-v1';
const wrapKey = (workspaceKey) => createHmac('sha256', workspaceKey).update(domain).digest();

export function readMfaRecoveryKey(db, workspaceKey) {
  const saved = db.prepare('SELECT nonce, ciphertext, tag FROM workspace_recovery_key WHERE id = 1').get();
  if (!saved) return createHmac('sha256', workspaceKey).update('nri-mfa-recovery-v1').digest();
  return decryptDocument(wrapKey(workspaceKey), domain, 'mfa', { ...saved, number: 1 });
}

export function writeMfaRecoveryKey(db, workspaceKey, recoveryKey) {
  const { nonce, ciphertext, tag } = encryptDocument(wrapKey(workspaceKey), domain, 'mfa', 1, recoveryKey);
  db.prepare('INSERT OR REPLACE INTO workspace_recovery_key VALUES (1, ?, ?, ?)').run(nonce, ciphertext, tag);
}
