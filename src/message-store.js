import { createHmac, randomUUID } from 'node:crypto';
import { decryptDocument, encryptDocument } from './document-crypto.js';

export const messageSchema = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    first TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    second TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    first_read INTEGER NOT NULL DEFAULT 0,
    second_read INTEGER NOT NULL DEFAULT 0,
    UNIQUE(first, second), CHECK(first < second)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversations_second ON conversations(second);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    crypto_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation, id);
  CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender, created_at);
  CREATE TABLE IF NOT EXISTS message_reports (
    message INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    reporter TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK(category IN ('spam','harassment','other')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(message, reporter)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_reports_reporter ON message_reports(reporter, created_at);
  CREATE TABLE IF NOT EXISTS message_preferences (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    notifications INTEGER NOT NULL CHECK(notifications IN (0, 1))
  ) STRICT;
  PRAGMA user_version = 15;
`;

export function messageStore(db, workspaceKey, now, transact) {
  const key = createHmac('sha256', workspaceKey).update('nri-private-message-v1').digest();
  const peers = db.prepare(`
    SELECT r.account_id AS id, r.name FROM researcher_profiles r
    JOIN researcher_profiles self ON self.account_id = :owner AND self.discoverable = 1
    WHERE r.discoverable = 1 AND EXISTS (
      SELECT 1 FROM researcher_links l WHERE l.kind = 'request' AND l.state = 'accepted'
      AND ((l.sender = :owner AND l.recipient = r.account_id) OR (l.recipient = :owner AND l.sender = r.account_id))
    ) ORDER BY r.name, r.account_id LIMIT 100
  `);
  const eligible = db.prepare(`
    SELECT 1 FROM researcher_links l
    JOIN researcher_profiles a ON a.account_id = l.sender AND a.discoverable = 1
    JOIN researcher_profiles b ON b.account_id = l.recipient AND b.discoverable = 1
    WHERE l.kind = 'request' AND l.state = 'accepted'
    AND ((l.sender = ? AND l.recipient = ?) OR (l.sender = ? AND l.recipient = ?))
  `);
  const blocked = db.prepare(`
    SELECT 1 FROM researcher_links l WHERE kind = 'block'
    AND ((l.sender = ? AND l.recipient = ?) OR (l.sender = ? AND l.recipient = ?))
  `);
  const ownBlock = db.prepare("SELECT 1 FROM researcher_links WHERE kind = 'block' AND sender = ? AND recipient = ?");
  const profile = db.prepare('SELECT name FROM researcher_profiles WHERE account_id = ? AND discoverable = 1');
  const insertConversation = db.prepare('INSERT OR IGNORE INTO conversations(id, first, second) VALUES (?, ?, ?)');
  const pair = db.prepare('SELECT id FROM conversations WHERE first = ? AND second = ?');
  const conversation = db.prepare(`
    SELECT id, first, second FROM conversations
    WHERE id = :id AND (:owner = first OR :owner = second)
  `);
  const unread = `(SELECT count(*) FROM messages m WHERE m.conversation = c.id AND m.sender <> :owner
    AND m.id > CASE WHEN c.first = :owner THEN c.first_read ELSE c.second_read END)`;
  const inbox = db.prepare(`
    SELECT c.id, ${unread} AS unread,
      CASE WHEN r.discoverable = 1 THEN r.name ELSE '' END AS name
    FROM conversations c LEFT JOIN researcher_profiles r
      ON r.account_id = CASE WHEN c.first = :owner THEN c.second ELSE c.first END
    WHERE c.first = :owner OR c.second = :owner
    ORDER BY (SELECT MAX(m.id) FROM messages m WHERE m.conversation = c.id) DESC, c.id
    LIMIT 50 OFFSET :offset
  `);
  const totalUnread = db.prepare(`
    SELECT COALESCE(SUM(${unread}), 0) AS total FROM conversations c
    WHERE c.first = :owner OR c.second = :owner
  `);
  const list = db.prepare(`
    SELECT m.*, EXISTS (SELECT 1 FROM message_reports r WHERE r.message=m.id AND r.reporter=?) AS reported
    FROM messages m WHERE m.conversation = ? AND (? IS NULL OR m.id < ?) ORDER BY m.id DESC LIMIT 51
  `);
  const insert = db.prepare(`
    INSERT INTO messages(conversation, sender, crypto_id, created_at, nonce, ciphertext, tag)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const countSent = db.prepare('SELECT count(*) AS total FROM messages WHERE sender = ? AND created_at > ?');
  const countReports = db.prepare('SELECT count(*) AS total FROM message_reports WHERE reporter = ? AND created_at > ?');
  const message = db.prepare('SELECT id, sender FROM messages WHERE conversation = ? AND id = ?');
  const report = db.prepare('INSERT OR IGNORE INTO message_reports VALUES (?, ?, ?, ?)');
  const mark = db.prepare(`
    UPDATE conversations SET
      first_read = CASE WHEN first = :owner THEN max(first_read, :read) ELSE first_read END,
      second_read = CASE WHEN second = :owner THEN max(second_read, :read) ELSE second_read END
    WHERE id = :id AND (first = :owner OR second = :owner)
  `);
  const getPreference = db.prepare('SELECT notifications FROM message_preferences WHERE account_id = ?');
  const setPreference = db.prepare(`
    INSERT INTO message_preferences VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET notifications=excluded.notifications
  `);

  function thread(owner, id) {
    const row = conversation.get({ owner, id });
    if (!row) return undefined;
    const peer = row.first === owner ? row.second : row.first;
    return {
      peer, name: profile.get(peer)?.name ?? '',
      blocked: Boolean(blocked.get(owner, peer, peer, owner)), ownBlock: Boolean(ownBlock.get(owner, peer)),
    };
  }

  return {
    peers: (owner) => peers.all({ owner }),
    inbox: (owner, offset) => inbox.all({ owner, offset }),
    unread: (owner) => totalUnread.get({ owner }).total,
    notifications: (owner) => Boolean(getPreference.get(owner)?.notifications ?? 1),
    setNotifications: (owner, enabled) => setPreference.run(owner, Number(enabled)),
    open(owner, peer) {
      return transact(db, () => {
        if (blocked.get(owner, peer, peer, owner) || !eligible.get(owner, peer, peer, owner)) return undefined;
        const [first, second] = [owner, peer].sort();
        insertConversation.run(randomUUID(), first, second);
        return pair.get(first, second).id;
      });
    },
    thread(owner, id) {
      return thread(owner, id);
    },
    list(owner, id, before) {
      if (!thread(owner, id)) return undefined;
      return list.all(owner, id, before, before).map(({ id: sequence, sender, crypto_id: cryptoId, created_at: createdAt, nonce, ciphertext, tag, reported }) => ({
        id: sequence, mine: sender === owner, createdAt, reported,
        text: decryptDocument(key, id, cryptoId, { number: 1, nonce, ciphertext, tag }).toString('utf8'),
      }));
    },
    send(owner, id, text) {
      return transact(db, () => {
        const current = thread(owner, id);
        if (!current) return 404;
        if (current.blocked) return 403;
        const timestamp = now();
        if (countSent.get(owner, timestamp - 60_000).total >= 20) return 429;
        const cryptoId = randomUUID();
        const { nonce, ciphertext, tag } = encryptDocument(key, id, cryptoId, 1, Buffer.from(text));
        insert.run(id, owner, cryptoId, timestamp, nonce, ciphertext, tag);
        return 303;
      });
    },
    mark(owner, id, read) {
      if (!thread(owner, id) || !message.get(id, read)) return false;
      return mark.run({ owner, id, read }).changes === 1;
    },
    report(owner, id, sequence, category) {
      return transact(db, () => {
        if (!thread(owner, id)) return 404;
        const target = message.get(id, sequence);
        if (!target || target.sender === owner) return 404;
        const timestamp = now();
        if (countReports.get(owner, timestamp - 86_400_000).total >= 10) return 429;
        return report.run(sequence, owner, category, timestamp).changes ? 303 : 422;
      });
    },
  };
}
