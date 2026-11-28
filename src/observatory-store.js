import { randomUUID } from 'node:crypto';

export const observatorySchema = `
  CREATE TABLE observatory_topics (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL, query TEXT NOT NULL
  ) STRICT;
  CREATE INDEX observatory_owner ON observatory_topics(owner_id, title);
  CREATE TABLE observatory_updates (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES observatory_topics(id) ON DELETE CASCADE,
    note TEXT NOT NULL, event_date TEXT NOT NULL, recorded_at INTEGER NOT NULL,
    source TEXT NOT NULL
  ) STRICT;
  CREATE INDEX observatory_updates_topic ON observatory_updates(topic_id, event_date DESC, recorded_at DESC);
  PRAGMA user_version = 9;
`;

export function observatoryStore(db, now) {
  const topics = db.prepare('SELECT id, title, query FROM observatory_topics WHERE owner_id=? ORDER BY title, id');
  const topic = db.prepare('SELECT id, title, query FROM observatory_topics WHERE owner_id=? AND id=?');
  const create = db.prepare('INSERT INTO observatory_topics VALUES (?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM observatory_topics WHERE owner_id=? AND id=?');
  const updates = db.prepare(`
    SELECT event_date, recorded_at, note, source FROM observatory_updates u
    JOIN observatory_topics t ON t.id=u.topic_id
    WHERE t.owner_id=? AND t.id=? AND (?='' OR instr(lower(u.note || ' ' || u.source), lower(?))>0)
    ORDER BY u.event_date DESC, u.recorded_at DESC, u.id LIMIT 100
  `);
  const add = db.prepare(`
    INSERT INTO observatory_updates
    SELECT ?, t.id, ?, ?, ?, json_object('identifier', r.doi, 'provider', r.provider,
      'retrievedAt', r.checked_at, 'metadata', json(r.metadata))
    FROM observatory_topics t JOIN projects p ON p.owner_id=t.owner_id
    JOIN project_references r ON r.project_id=p.id
    WHERE t.owner_id=? AND t.id=? AND p.id=? AND r.doi=? AND r.provider=?
      AND r.state='found' AND r.provider NOT IN ('orcid', 'agency')
  `);
  return {
    topics: (owner) => topics.all(owner),
    get: (owner, id) => topic.get(owner, id),
    create(owner, title, query) {
      const id = randomUUID();
      create.run(id, owner, title, query);
      return id;
    },
    remove: (owner, id) => remove.run(owner, id).changes === 1,
    updates: (owner, id, filter) => updates.all(owner, id, filter, filter).map((row) => ({
      date: row.event_date, recordedAt: row.recorded_at, note: row.note, source: JSON.parse(row.source),
    })),
    add: (owner, id, { note, date, project, doi, provider }) =>
      add.run(randomUUID(), note, date, now(), owner, id, project, doi, provider).changes === 1,
  };
}
