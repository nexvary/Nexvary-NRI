import { operationsAdminSchema, operationsSchema, operationsSessionSchema, operationsStore } from './admin-operations.js';
import { billingAccessSchema, billingDiscountSchema, billingReconciliationSchema, billingSchema, billingStore } from './billing-store.js';
import { resourceSchema, resourceStore } from './resource-store.js';
import { citationSchema, citationStore } from './citation-store.js';
import { folderSchema, organizationSchema, organizationStore } from './library-organization.js';
import { institutionalSeatSchema, institutionalSubscriptionSchema, licenseSchema, lifecycleScheduleSchema, licensingStore, moduleEntitlementSchema, planAudienceSchema, planPricingSchema, quotaSchema, subscriptionSchema } from './licensing-store.js';
import { manuscriptCatalogSchema, teamSchema, teamStore, teamWorkSchema } from './team-store.js';
import { privacyStore } from './privacy-store.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mfaSchema, mfaStore } from './mfa.js';
import { messageSchema, messageStore, moderationSchema } from './message-store.js';
import { assistantUsageSchema, assistantUsageStore } from './assistant-usage.js';
import { assistantSettingsSchema, assistantSettingsStore } from './assistant-settings.js';
import { workspaceKeyVersionSchema } from './workspace-key-version.js';
import { bindDocumentKey } from './document-crypto.js';
import { documentSchema, documentStore } from './document-store.js';
import { educationSchema, educationStore } from './education.js';
import { sharingSchema, sharingStore } from './sharing-store.js';
import { passwordRecoverySchema, profilePreferencesSchema, settingsSchema, settingsStore } from './settings.js';
import { observatorySchema, observatoryStore } from './observatory-store.js';
import { networkSchema, networkStore } from './network-store.js';
import { libraryStore } from './library.js';
import { economicsSchema, economicsStore } from './economics.js';
import { readinessReviewSchema, readinessSchema, readinessStore } from './readiness-store.js';
import { evidenceSchema, evidenceStore } from './evidence-store.js';
import { referenceSchema, referenceMigrationV4, referenceStore } from './reference-store.js';

export const sessionLifetime = 8 * 60 * 60;
export const sessionIdle = 30 * 60_000;
const schemaVersion = 45;
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
    if (version < 8) db.exec(networkSchema);
    if (version < 9) db.exec(observatorySchema);
    if (version < 10) db.exec(settingsSchema);
    if (version < 11) db.exec(sharingSchema);
    if (version < 12) db.exec(educationSchema);
    if (version < 13) db.exec(assistantSettingsSchema);
    if (version < 14) db.exec(assistantUsageSchema);
    if (version < 15) db.exec(messageSchema);
    if (version < 16) db.exec(mfaSchema);
    if (version < 17) db.exec(moderationSchema);
    if (version < 18) db.exec(teamSchema);
    if (version < 19) db.exec(licenseSchema);
    if (version < 20) db.exec(teamWorkSchema);
    if (version < 21) db.exec(manuscriptCatalogSchema);
    if (version < 22) db.exec(organizationSchema);
    if (version < 23) db.exec(citationSchema);
    if (version < 24) db.exec(resourceSchema);
    if (version < 25) db.exec(`
      CREATE TABLE IF NOT EXISTS session_activity (
        token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
        seen_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS session_activity_seen ON session_activity(seen_at);
      INSERT OR IGNORE INTO session_activity SELECT token_hash,expires_at - ${sessionLifetime * 1000} FROM sessions;
      PRAGMA user_version = 25;
    `);
    if (version < 26) db.exec(quotaSchema);
    if (version < 27) db.exec(passwordRecoverySchema);
    if (version < 28) db.exec(workspaceKeyVersionSchema);
    if (version < 29) db.exec(readinessReviewSchema);
    if (version < 30) db.exec(subscriptionSchema);
    if (version < 31) db.exec(billingSchema);
    if (version < 32) db.exec(moduleEntitlementSchema);
    if (version < 33) db.exec(institutionalSeatSchema);
    if (version < 34) db.exec(institutionalSubscriptionSchema);
    if (version < 35) db.exec(planPricingSchema);
    if (version < 36) db.exec(billingAccessSchema);
    if (version < 37) db.exec(billingReconciliationSchema);
    if (version < 38) db.exec(lifecycleScheduleSchema);
    if (version < 39) db.exec(billingDiscountSchema);
    if (version < 40) db.exec(planAudienceSchema);
    if (version < 41) db.exec(operationsSchema);
    if (version < 42) db.exec(folderSchema);
    if (version < 43) db.exec(operationsAdminSchema);
    if (version < 44) db.exec(operationsSessionSchema);
    if (version < 45) db.exec(profilePreferencesSchema);
    return bindDocumentKey(db, path);
  });
}

export function workspaceDatabasePath() {
  return resolve(process.env.NRI_DB_PATH ?? '.nri/workspace.sqlite');
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function openWorkspaceStore(path = ':memory:', now = Date.now, options = {}) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    closeSync(openSync(path, 'a', 0o600));
  }

  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 3000 });
  let workspaceKey;
  let assistantSettings;
  let documents;
  let licensing;
  let references;
  let evidence;
  let readiness;
  let economics;
  try {
    db.exec('PRAGMA secure_delete = ON');
    workspaceKey = initialize(db, path);
    licensing = licensingStore(db, now, transact);
    documents = documentStore(db, workspaceKey, now, transact, licensing.canStore);
    assistantSettings = assistantSettingsStore(db, workspaceKey);
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
  const replacePassword = db.prepare('UPDATE accounts SET salt = ?, hash = ? WHERE email = ? RETURNING id');
  const currentCredentials = db.prepare('SELECT 1 FROM accounts WHERE id = ? AND salt = ? AND hash = ?');
  const revokeAccountSessions = db.prepare('DELETE FROM sessions WHERE account_id = ?');
  const insertSession = db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at,user_agent) VALUES (?,?,?,?)');
  const initializeActivity = db.prepare('INSERT INTO session_activity VALUES (?,?)');
  const clearExpired = db.prepare(`DELETE FROM sessions WHERE expires_at<=? OR
    token_hash IN (SELECT token_hash FROM session_activity WHERE seen_at<=?)`);
  const touch = db.prepare(`UPDATE session_activity SET seen_at=:now WHERE token_hash=:key AND seen_at>:idle AND seen_at<=:refresh
    AND EXISTS (SELECT 1 FROM sessions WHERE token_hash=:key AND expires_at>:now)`);
  const getSession = db.prepare(`
    SELECT accounts.id, accounts.email FROM sessions JOIN accounts ON accounts.id = sessions.account_id
    JOIN session_activity a ON a.token_hash = sessions.token_hash
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND a.seen_at > ?
  `);
  const countOthers = db.prepare(`SELECT count(*) AS count FROM sessions s JOIN session_activity a ON a.token_hash=s.token_hash
    WHERE s.account_id=? AND s.token_hash<>? AND s.expires_at>? AND a.seen_at>?`);
  const removeOthers = db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ? AND expires_at > ?');
  const settings = settingsStore(db, now, transact);
  const sharing = sharingStore(db, now, transact);
  const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const insertProject = db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)');
  const listProjects = db.prepare('SELECT id, title FROM projects WHERE owner_id = ? ORDER BY updated_at DESC, id');
  const getProject = db.prepare('SELECT id, title, description FROM projects WHERE owner_id = ? AND id = ?');
  const updateProject = db.prepare('UPDATE projects SET title = ?, description = ?, updated_at = ? WHERE owner_id = ? AND id = ?');
  const deleteProject = db.prepare('DELETE FROM projects WHERE owner_id = ? AND id = ?');

  function revokeOthers(owner, token) {
    const removed = removeOthers.run(owner, tokenHash(token), now()).changes;
    if (removed) settings.record(owner, 'revoke-others');
    return removed;
  }

  function sessionFor(token) {
    const at = now();
    return token ? getSession.get(tokenHash(token), at, at - sessionIdle) : undefined;
  }

  function issueSession(accountId, userAgent = '') {
    const token = randomBytes(32).toString('base64url');
    const issuedAt = now();
    const key = tokenHash(token);
    clearExpired.run(issuedAt,issuedAt - sessionIdle);
    insertSession.run(key, accountId, issuedAt + sessionLifetime * 1000, typeof userAgent === 'string' ? userAgent.slice(0,300) : '');
    initializeActivity.run(key,issuedAt);
    return token;
  }

  const mfa = mfaStore(db, workspaceKey, now, transact, revokeOthers);
  const teams = teamStore(db, now, transact);
  const privacy = privacyStore(db, workspaceKey, now);
  return {
    privacyAction(owner, token, code, action) {
      if (action !== 'export' && action !== 'delete') return { status: 422 };
      return mfa.authorizePrivacy(owner, code, () => sessionFor(token)?.id === owner, () =>
        action === 'export' ? privacy.export(owner) : { status: privacy.delete(owner) ? 303 : 403 });
    },
    exportDocument(owner, token, code, project, document, version) {
      return mfa.authorizePrivacy(owner, code, () => sessionFor(token)?.id === owner, () => {
        const file = documents.download(owner, project, document, version);
        return file ? { status: 200, file } : { status: 404 };
      });
    },
    healthy: () => db.prepare('PRAGMA user_version').get().user_version === schemaVersion,
    licensing,
    operations: operationsStore(db, now, sessionIdle, options.backupDirectory),
    billing: billingStore(db, now, transact),
    teams,
    resources: resourceStore(db, now, transact, teams),
    assistantSettings,
    mfa,
    messages: messageStore(db, workspaceKey, now, transact),
    assistantUsage: assistantUsageStore(db, now, transact, licensing.aiTokens),
    documents,
    references,
    evidence,
    readiness,
    economics,
    library: libraryStore(db),
    citations: citationStore(db, now, transact),
    organization: organizationStore(db, now, transact),
    network: networkStore(db, now, transact, (first, second) => {
      sharing.revokeOnBlock(first, second);
      teams.revokeOnBlock(first, second);
    }),
    observatory: observatoryStore(db, now),
    settings,
    sharing,
    education: educationStore(db, now),
    close() {
      db.close();
    },
    addAccount(email, { salt, hash }) {
      return insertAccount.run(randomUUID(), email, salt, hash);
    },
    credentials(email) {
      return findAccount.get(email);
    },
    newSession: (account,userAgent) => transact(db, () => issueSession(account,userAgent)),
    resetPassword(email, { salt, hash }) {
      return transact(db, () => {
        const account = replacePassword.get(salt, hash, email);
        if (!account) return false;
        revokeAccountSessions.run(account.id);
        settings.record(account.id, 'password-reset');
        return true;
      });
    },
    signIn({ id: accountId, salt, hash }, previousToken, userAgent) {
      return transact(db, () => {
        if (!currentCredentials.get(accountId, salt, hash)) return undefined;
        const session = issueSession(accountId,userAgent);
        if (previousToken) removeSession.run(tokenHash(previousToken));
        settings.record(accountId, 'sign-in');
        return session;
      });
    },
    signOut(accountId, token) {
      return transact(db, () => {
        if (removeSession.run(tokenHash(token)).changes) settings.record(accountId, 'sign-out');
      });
    },
    session: sessionFor,
    touchSession(token) {
      if (!token) return;
      const at = now();
      touch.run({ key:tokenHash(token), now:at, idle:at-sessionIdle, refresh:at-60_000 });
    },
    otherSessions(owner, token) {
      const at = now();
      return countOthers.get(owner,tokenHash(token),at,at - sessionIdle).count;
    },
    revokeOtherSessions(owner, token) {
      return transact(db, () => revokeOthers(owner, token));
    },
    listProjects(owner) {
      return listProjects.all(owner);
    },
    getProject(owner, id) {
      return getProject.get(owner, id);
    },
    createProject(owner, { title, description }) {
      return transact(db, () => {
        if (!licensing.canCreateProject(owner)) return undefined;
        const id = randomUUID();
        insertProject.run(id, owner, title, description, now());
        return id;
      });
    },
    updateProject(owner, id, { title, description }) {
      return updateProject.run(title, description, now(), owner, id).changes === 1;
    },
    deleteProject(owner, id) {
      return deleteProject.run(owner, id).changes === 1;
    },
  };
}
