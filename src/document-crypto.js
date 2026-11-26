import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function bindDocumentKey(db, databasePath) {
  const previous = db.prepare('SELECT fingerprint FROM document_key WHERE id = 1').get();
  let key;
  if (databasePath === ':memory:') {
    key = randomBytes(32);
  } else {
    const keyPath = `${databasePath}.key`;
    try {
      key = readFileSync(keyPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (previous) throw new Error('The existing document encryption key file is missing.');
      key = randomBytes(32);
      writeFileSync(keyPath, key, { flag: 'wx', mode: 0o600, flush: true });
    }
  }
  if (key.length !== 32) throw new Error('The document encryption key must contain 32 bytes.');
  const fingerprint = createHash('sha256').update(key).digest('hex');
  if (previous && previous.fingerprint !== fingerprint) {
    throw new Error('The document encryption key does not match this database.');
  }
  if (!previous) db.prepare('INSERT INTO document_key VALUES (1, ?)').run(fingerprint);
  return key;
}

function context(projectId, documentId, number) {
  return Buffer.from(JSON.stringify(['nri-pdf-v1', projectId, documentId, number]));
}

export function encryptDocument(key, projectId, documentId, number, bytes) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(context(projectId, documentId, number));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

export function decryptDocument(key, projectId, documentId, version) {
  const decipher = createDecipheriv('aes-256-gcm', key, version.nonce, { authTagLength: 16 });
  decipher.setAAD(context(projectId, documentId, version.number));
  decipher.setAuthTag(version.tag);
  return Buffer.concat([decipher.update(version.ciphertext), decipher.final()]);
}
