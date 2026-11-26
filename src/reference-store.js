const successTtl = 24 * 60 * 60 * 1000;
const missingTtl = 15 * 60 * 1000;

export const referenceSchema = `
  CREATE TABLE reference_cache (
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    doi TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('found', 'not-found')),
    checked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    PRIMARY KEY(owner_id, doi)
  ) STRICT;

  CREATE TABLE project_references (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doi TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('found', 'not-found')),
    checked_at INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    PRIMARY KEY(project_id, doi)
  ) STRICT;
`;

function snapshot(row) {
  return { doi: row.doi, status: row.state, checkedAt: row.checked_at, metadata: JSON.parse(row.metadata) };
}

export function referenceStore(db, now, transact) {
  const cached = db.prepare(`
    SELECT doi, state, checked_at, metadata FROM reference_cache WHERE owner_id = ? AND doi = ? AND expires_at > ?
  `);
  const cache = db.prepare(`
    INSERT INTO reference_cache VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, doi) DO UPDATE SET state = excluded.state, checked_at = excluded.checked_at,
      expires_at = excluded.expires_at, metadata = excluded.metadata
  `);
  const prune = db.prepare(`
    DELETE FROM reference_cache WHERE owner_id = ? AND (
      expires_at <= ? OR doi IN (
        SELECT doi FROM reference_cache WHERE owner_id = ? ORDER BY checked_at DESC, doi LIMIT -1 OFFSET 250
      )
    )
  `);
  const list = db.prepare(`
    SELECT record.doi, record.state, record.checked_at, record.metadata
    FROM project_references AS record JOIN projects ON projects.id = record.project_id
    WHERE projects.owner_id = ? AND projects.id = ? ORDER BY record.checked_at DESC, record.doi
  `);
  const upsert = db.prepare(`
    INSERT INTO project_references
    SELECT projects.id, ?, ?, ?, ? FROM projects WHERE owner_id = ? AND id = ?
    ON CONFLICT(project_id, doi) DO UPDATE SET state = excluded.state, checked_at = excluded.checked_at,
      metadata = excluded.metadata
    WHERE excluded.checked_at >= project_references.checked_at
  `);
  const project = db.prepare('SELECT id FROM projects WHERE owner_id = ? AND id = ?');
  const remove = db.prepare(`
    DELETE FROM project_references WHERE doi = ? AND project_id = (
      SELECT id FROM projects WHERE owner_id = ? AND id = ?
    )
  `);

  return {
    cached(owner, doi) {
      const row = cached.get(owner, doi, now());
      return row ? snapshot(row) : null;
    },
    list(owner, projectId) {
      return list.all(owner, projectId).map(snapshot);
    },
    save(owner, projectId, { doi, status, checkedAt, metadata }, fresh) {
      return transact(db, () => {
        if (!project.get(owner, projectId)) return false;
        const json = JSON.stringify(metadata);
        upsert.run(doi, status, checkedAt, json, owner, projectId);
        if (fresh) {
          const ttl = status === 'found' ? successTtl : missingTtl;
          cache.run(owner, doi, status, checkedAt, checkedAt + ttl, json);
          prune.run(owner, now(), owner);
        }
        return true;
      });
    },
    remove(owner, projectId, doi) {
      return remove.run(doi, owner, projectId).changes === 1;
    },
  };
}
