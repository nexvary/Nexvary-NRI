import { randomUUID } from 'node:crypto';
import { encryptDocument, decryptDocument } from './document-crypto.js';

export const documentSchema = `
  CREATE TABLE document_key (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    fingerprint TEXT NOT NULL
  ) STRICT;

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL
  ) STRICT;

  CREATE INDEX documents_project ON documents(project_id, id);

  CREATE TABLE document_versions (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number > 0),
    filename TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    size INTEGER NOT NULL CHECK(size > 0),
    nonce BLOB NOT NULL UNIQUE CHECK(length(nonce) = 12),
    ciphertext BLOB NOT NULL CHECK(length(ciphertext) = size),
    tag BLOB NOT NULL CHECK(length(tag) = 16),
    PRIMARY KEY(document_id, number)
  ) STRICT;
`;

function appendVersion(insert, key, now, projectId, documentId, number, file) {
  const { nonce, ciphertext, tag } = encryptDocument(key, projectId, documentId, number, file.bytes);
  insert.run(documentId, number, file.name, now(), file.bytes.length, nonce, ciphertext, tag);
}

export function documentStore(db, key, now, transact, canStore = () => true) {
  const ownedProject = db.prepare('SELECT id, title FROM projects WHERE owner_id = ? AND id = ?');
  const list = db.prepare(`
    SELECT documents.id, documents.title, COUNT(document_versions.number) AS versionCount
    FROM documents JOIN projects ON projects.id = documents.project_id
    JOIN document_versions ON document_versions.document_id = documents.id
    WHERE projects.owner_id = ? AND projects.id = ?
    GROUP BY documents.id ORDER BY MAX(document_versions.created_at) DESC, documents.id
  `);
  const ownedDocument = db.prepare(`
    SELECT documents.title FROM documents JOIN projects ON projects.id = documents.project_id
    WHERE projects.owner_id = ? AND projects.id = ? AND documents.id = ?
  `);
  const insertDocument = db.prepare('INSERT INTO documents VALUES (?, ?, ?)');
  const insertVersion = db.prepare('INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const nextNumber = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM document_versions WHERE document_id = ?');
  const versions = db.prepare(`
    SELECT version.number, version.filename, version.created_at, version.size
    FROM document_versions AS version JOIN documents ON documents.id = version.document_id
    JOIN projects ON projects.id = documents.project_id
    WHERE projects.owner_id = ? AND projects.id = ? AND documents.id = ?
    ORDER BY version.number DESC
  `);
  const exportable = db.prepare(`
    SELECT p.id AS project_id, p.title AS project_title, d.id AS document_id, v.number, v.filename
    FROM projects p JOIN documents d ON d.project_id=p.id
    JOIN document_versions v ON v.document_id=d.id
    WHERE p.owner_id=? ORDER BY p.id,d.id,v.number DESC LIMIT 51 OFFSET ?
  `);
  const download = db.prepare(`
    SELECT version.number, version.filename, version.nonce, version.ciphertext, version.tag
    FROM document_versions AS version JOIN documents ON documents.id = version.document_id
    JOIN projects ON projects.id = documents.project_id
    WHERE projects.owner_id = ? AND projects.id = ? AND documents.id = ? AND version.number = ?
  `);
  const remove = db.prepare(`
    DELETE FROM documents WHERE id = ? AND project_id = (
      SELECT id FROM projects WHERE owner_id = ? AND id = ?
    )
  `);

  return {
    exportable(owner, offset) {
      return exportable.all(owner, offset);
    },
    list(owner, projectId) {
      return list.all(owner, projectId);
    },
    get(owner, projectId, documentId) {
      return ownedDocument.get(owner, projectId, documentId);
    },
    versions(owner, projectId, documentId) {
      return versions.all(owner, projectId, documentId);
    },
    create(owner, projectId, file) {
      return transact(db, () => {
        if (!ownedProject.get(owner, projectId)) return;
        if (!canStore(owner,file.bytes.length)) throw Object.assign(new Error('PDF storage limit'),{ code:'NRI_STORAGE_LIMIT' });
        const documentId = randomUUID();
        insertDocument.run(documentId, projectId, file.name);
        appendVersion(insertVersion, key, now, projectId, documentId, 1, file);
        return documentId;
      });
    },
    append(owner, projectId, documentId, file) {
      return transact(db, () => {
        if (!ownedDocument.get(owner, projectId, documentId)) return false;
        if (!canStore(owner,file.bytes.length)) throw Object.assign(new Error('PDF storage limit'),{ code:'NRI_STORAGE_LIMIT' });
        const { number } = nextNumber.get(documentId);
        appendVersion(insertVersion, key, now, projectId, documentId, number, file);
        return true;
      });
    },
    download(owner, projectId, documentId, number) {
      const row = download.get(owner, projectId, documentId, number);
      if (!row) return;
      return { name: row.filename, bytes: decryptDocument(key, projectId, documentId, row) };
    },
    delete(owner, projectId, documentId) {
      return remove.run(documentId, owner, projectId).changes === 1;
    },
  };
}
