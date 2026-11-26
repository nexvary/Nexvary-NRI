import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bindDocumentKey } from './document-crypto.js';
import { documentSchema, documentStore } from './document-store.js';
import { economicsSchema, economicsStore } from './economics.js';
import { readinessSchema, readinessStore } from './readiness-store.js';
import { evidenceSchema, evidenceStore } from './evidence-store.js';
import { referenceSchema, referenceMigrationV4, referenceStore } from './reference-store.js';

export const sessionLifetime = 8 * 60 * 60;
const schemaVersion = 7;
const schema = `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    salt BLOB NOT NULL CHECK(length(salt) = 16),
    hash BLOB NOT NULL CHECK(length(hash) = 32)
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX projects_owner_updated ON projects(owner_id, updated_at DESC, id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
`;

function transact(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function initialize(db, path) {
  return transact(db, () => {
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    if (version > schemaVersion) throw new Error('The workspace database requires a newer NRI version.');
    if (version === 0) db.exec(schema);
    if (version < 2) db.exec(documentSchema);
    if (version < 3) db.exec(referenceSchema + 'PRAGMA user_version = 3;');
    if (version === 3) db.exec(referenceMigrationV4);
    if (version < 5) db.exec(evidenceSchema);
    if (version < 6) db.exec(readinessSchema);
    if (version < 7) db.exec(economicsSchema);
    return bindDocumentKey(db, path);
  });
}

export function workspaceDatabasePath() {
  return resolve(process.env.NRI_DB_PATH ?? '.nri/workspace.sqlite');
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function openWorkspaceStore(path = ':memory:', now = Date.now) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    closeSync(openSync(path, 'a', 0o600));
  }

  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 3000 });
  let documents;
  let references;
  let evidence;
  let readiness;
  let economics;
  try {
    documents = documentStore(db, initialize(db, path), now, transact);
    references = referenceStore(db, now, transact);
    evidence = evidenceStore(db, now, transact);
    readiness = readinessStore(db, now);
    economics = economicsStore(db, now);
  } catch (error) {
    db.close();
    throw error;
  }

  const insertAccount = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)');
  const findAccount = db.prepare('SELECT id, salt, hash FROM accounts WHERE email = ?');
  const insertSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
  const clearExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const getSession = db.prepare(`
    SELECT accounts.id, accounts.email FROM sessions JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const insertProject = db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)');
  const listProjects = db.prepare('SELECT id, title FROM projects WHERE owner_id = ? ORDER BY updated_at DESC, id');
  const getProject = db.prepare('SELECT id, title, description FROM projects WHERE owner_id = ? AND id = ?');
  const updateProject = db.prepare('UPDATE projects SET title = ?, description = ?, updated_at = ? WHERE owner_id = ? AND id = ?');
  const deleteProject = db.prepare('DELETE FROM projects WHERE owner_id = ? AND id = ?');

  return {
    documents,
    references,
    evidence,
    readiness,
    economics,
    close() {
      db.close();
    },
    addAccount(email, { salt, hash }) {
      return insertAccount.run(randomUUID(), email, salt, hash);
    },
    credentials(email) {
      return findAccount.get(email);
    },
    newSession(accountId) {
      const token = randomBytes(32).toString('base64url');
      const issuedAt = now();
      clearExpired.run(issuedAt);
      insertSession.run(tokenHash(token), accountId, issuedAt + sessionLifetime * 1000);
      return token;
    },
    session(token) {
      return token ? getSession.get(tokenHash(token), now()) : undefined;
    },
    revokeSession(token) {
      if (token) removeSession.run(tokenHash(token));
    },
    listProjects(owner) {
      return listProjects.all(owner);
    },
    getProject(owner, id) {
      return getProject.get(owner, id);
    },
    createProject(owner, { title, description }) {
      const id = randomUUID();
      insertProject.run(id, owner, title, description, now());
      return id;
    },
    updateProject(owner, id, { title, description }) {
      return updateProject.run(title, description, now(), owner, id).changes === 1;
    },
    deleteProject(owner, id) {
      return deleteProject.run(owner, id).changes === 1;
    },
  };
}
