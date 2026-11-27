import { createHmac } from 'node:crypto';
import { decryptDocument } from './document-crypto.js';

const maxExportBytes = 64 * 1024 * 1024;

export function privacyStore(db, workspaceKey, now) {
  const messageKey = createHmac('sha256', workspaceKey).update('nri-private-message-v1').digest();
  const account = db.prepare('SELECT id, email FROM accounts WHERE id = ?');
  const remove = db.prepare('DELETE FROM accounts WHERE id = ?');
  const queries = {
    projects: 'SELECT id, title, description, updated_at FROM projects WHERE owner_id = ? ORDER BY id',
    documents: `SELECT d.id, d.project_id, d.title, v.number, v.filename, v.created_at, v.size, v.nonce, v.tag, v.ciphertext
      FROM document_versions v JOIN documents d ON d.id = v.document_id JOIN projects p ON p.id = d.project_id
      WHERE p.owner_id = ? ORDER BY d.id, v.number`,
    references: 'SELECT r.* FROM project_references r JOIN projects p ON p.id = r.project_id WHERE p.owner_id = ?',
    claims: 'SELECT c.* FROM claims c JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ?',
    evidence: `SELECT e.* FROM evidence_items e JOIN claims c ON c.id = e.claim_id
      JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ?`,
    readiness: 'SELECT r.* FROM readiness_revisions r JOIN projects p ON p.id = r.project_id WHERE p.owner_id = ?',
    economics: 'SELECT e.* FROM economic_scenarios e JOIN projects p ON p.id = e.project_id WHERE p.owner_id = ?',
    watchlists: 'SELECT id, title, query FROM observatory_topics WHERE owner_id = ?',
    watchlistUpdates: 'SELECT u.* FROM observatory_updates u JOIN observatory_topics t ON t.id = u.topic_id WHERE t.owner_id = ?',
    profile: 'SELECT name, interests, orcid, discoverable FROM researcher_profiles WHERE account_id = ?',
    learning: 'SELECT lesson, attempts, passed_at FROM lesson_progress WHERE account_id = ?',
    assistant: 'SELECT provider, model FROM assistant_settings WHERE account_id = ?',
    usage: `SELECT day, model, token_reservation, cost_reservation, observed_input,
      observed_output, observed_cost FROM assistant_usage WHERE account_id = ?`,
    sentMessages: `SELECT id, conversation, created_at, crypto_id, nonce, tag, ciphertext
      FROM messages WHERE sender = ? ORDER BY id`,
    messagePreferences: 'SELECT notifications FROM message_preferences WHERE account_id = ?',
    reports: 'SELECT message, category, created_at FROM message_reports WHERE reporter = ?',
    securityActivity: 'SELECT action, recorded_at FROM security_events WHERE account_id = ?',
    roles: 'SELECT role FROM account_roles WHERE account_id = ?',
  };
  const sections = Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]);

  function publicRecord(name, row) {
    if (name === 'documents') {
      const { nonce, tag, ciphertext, ...metadata } = row;
      const content = decryptDocument(workspaceKey, row.project_id, row.id, row);
      return { ...metadata, encoding: 'base64', content: content.toString('base64') };
    }
    if (name === 'sentMessages') {
      const { nonce, tag, ciphertext, crypto_id: cryptoId, ...metadata } = row;
      return { ...metadata, text: decryptDocument(messageKey, row.conversation, cryptoId, { ...row, number: 1 }).toString('utf8') };
    }
    return row;
  }

  return {
    export(owner) {
      const identity = account.get(owner);
      if (!identity) return { status: 403 };
      const chunks = [JSON.stringify({ formatVersion: 1, exportedAt: now(), account: identity }).slice(0, -1)];
      let size = Buffer.byteLength(chunks[0]) + 1;
      for (const [name, statement] of sections) {
        const heading = ',' + JSON.stringify(name) + ':[';
        chunks.push(heading);
        size += Buffer.byteLength(heading) + 1;
        let delimiter = '';
        for (const row of statement.iterate(owner)) {
          const item = delimiter + JSON.stringify(publicRecord(name, row));
          size += Buffer.byteLength(item);
          if (size > maxExportBytes) return { status: 413 };
          chunks.push(item);
          delimiter = ',';
        }
        chunks.push(']');
      }
      return { status: 200, body: chunks.join('') + '}' };
    },
    delete(owner) {
      return remove.run(owner).changes === 1;
    },
  };
}
