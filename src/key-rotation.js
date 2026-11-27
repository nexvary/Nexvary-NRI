import { createHash, createHmac, randomBytes } from 'node:crypto';
import { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openProviderKey, sealProviderKey } from './assistant-settings.js';
import { decryptDocument, encryptDocument } from './document-crypto.js';
import { backupWorkspace, newDirectory, validateWorkspace } from './recovery.js';
import { openWorkspaceStore } from './store.js';
import { readMfaRecoveryKey, writeMfaRecoveryKey } from './workspace-key-version.js';

const fileName = 'workspace.sqlite';
const derive = (key, label) => label ? createHmac('sha256', key).update(label).digest() : key;

function replaceRows(db, select, update, transform) {
  const query = db.prepare(select);
  const save = db.prepare(update);
  let cursor = 0;
  while (true) {
    const rows = query.all(cursor);
    if (!rows.length) return;
    for (const row of rows) {
      save.run(...transform(row), row.sequence);
      cursor = row.sequence;
    }
  }
}

function rekey(db, oldKey, newKey) {
  const records = [
    {
      table: 'document_versions',
      select: `SELECT v.rowid AS sequence, v.*, d.project_id AS scope, d.id AS identity
        FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.rowid > ? ORDER BY v.rowid LIMIT 8`,
    },
    {
      table: 'messages', label: 'nri-private-message-v1',
      select: `SELECT rowid AS sequence, *, conversation AS scope, crypto_id AS identity, 1 AS number
        FROM messages WHERE rowid > ? ORDER BY rowid LIMIT 8`,
    },
    {
      table: 'account_mfa', label: 'nri-mfa-encryption-v1',
      select: `SELECT rowid AS sequence, *, account_id AS scope, 'totp' AS identity, 1 AS number
        FROM account_mfa WHERE rowid > ? ORDER BY rowid LIMIT 8`,
    },
  ];
  for (const { table, label, select } of records) {
    const oldDomain = derive(oldKey, label);
    const newDomain = derive(newKey, label);
    replaceRows(db, select, `UPDATE ${table} SET nonce = ?, ciphertext = ?, tag = ? WHERE rowid = ?`, (row) => {
      const bytes = decryptDocument(oldDomain, row.scope, row.identity, row);
      const sealed = encryptDocument(newDomain, row.scope, row.identity, row.number, bytes);
      const verified = decryptDocument(newDomain, row.scope, row.identity, { ...sealed, number: row.number });
      if (!verified.equals(bytes)) throw new Error('Workspace encryption integrity check failed.');
      return [sealed.nonce, sealed.ciphertext, sealed.tag];
    });
  }
  const oldProvider = derive(oldKey, 'nri-assistant-settings-v1');
  const newProvider = derive(newKey, 'nri-assistant-settings-v1');
  replaceRows(db, `SELECT rowid AS sequence, account_id, api_key FROM assistant_settings
    WHERE rowid > ? AND api_key IS NOT NULL ORDER BY rowid LIMIT 8`,
  'UPDATE assistant_settings SET api_key = ? WHERE rowid = ?', (row) => {
    const bytes = openProviderKey(oldProvider, row.account_id, row.api_key);
    const sealed = sealProviderKey(newProvider, row.account_id, bytes);
    if (!openProviderKey(newProvider, row.account_id, sealed).equals(bytes)) throw new Error('Provider credential integrity check failed.');
    return [sealed];
  });

  // Recovery digests cannot be decrypted. Rewrap their purpose-specific HMAC key.
  const recoveryKey = readMfaRecoveryKey(db, oldKey);
  writeMfaRecoveryKey(db, newKey, recoveryKey);
  if (!readMfaRecoveryKey(db, newKey).equals(recoveryKey)) throw new Error('MFA recovery integrity check failed.');
  db.prepare('UPDATE document_key SET fingerprint = ? WHERE id = 1')
    .run(createHash('sha256').update(newKey).digest('hex'));
  const { generation } = db.prepare('SELECT COALESCE(MAX(generation), 1) + 1 AS generation FROM workspace_key_rotations').get();
  db.prepare('INSERT INTO workspace_key_rotations VALUES (?, ?)').run(generation, Date.now());
  return generation;
}

export async function rotateWorkspaceKey(source, destination, { beforePublish } = {}) {
  if (!(await stat(source)).isFile()) throw new Error('Workspace source must be an existing database file.');
  const staging = await mkdtemp(join(dirname(destination), '.nri-rotation-'));
  let lock;
  try {
    // The CLI is used offline. This lock also rejects concurrent SQLite writers during the snapshot and publication.
    lock = new DatabaseSync(source, { timeout: 3000 });
    lock.exec('BEGIN IMMEDIATE');
    const snapshot = join(staging, 'snapshot');
    await backupWorkspace(source, snapshot);
    const database = join(snapshot, fileName);
    const keyPath = database + '.key';
    openWorkspaceStore(database).close();
    const oldKey = await readFile(keyPath);
    const newKey = randomBytes(32);
    const db = new DatabaseSync(database);
    let generation;
    try {
      db.exec('PRAGMA secure_delete = ON; BEGIN IMMEDIATE');
      try {
        generation = rekey(db, oldKey, newKey);
        if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Workspace relationships are invalid.');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      db.exec('VACUUM');
    } finally {
      db.close();
    }
    await writeFile(keyPath, newKey, { mode: 0o600, flush: true });
    await validateWorkspace(database, keyPath);
    await beforePublish?.();
    const output = await newDirectory(destination, async (directory) => {
      const target = join(directory, fileName);
      await link(keyPath, target + '.key');
      await link(database, target);
      return target;
    });
    return { database: output, generation };
  } finally {
    lock?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
