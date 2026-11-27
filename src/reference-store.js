const successTtl = 24 * 60 * 60 * 1000;
const missingTtl = 15 * 60 * 1000;

export const referenceSchema = `
  CREATE TABLE reference_cache (
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    doi TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('found', 'not-found')),
    checked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    PRIMARY KEY(owner_id, doi, provider)
  ) STRICT;

  CREATE TABLE project_references (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doi TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('found', 'not-found')),
    checked_at INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    PRIMARY KEY(project_id, doi, provider)
  ) STRICT;
`;

export const referenceMigrationV4 = `
  CREATE TABLE reference_cache_new (
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    doi TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('found', 'not-found')),
    checked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    PRIMARY KEY(owner_id, doi, provider)
  ) STRICT;
  INSERT INTO reference_cache_new SELECT owner_id, doi, 'crossref', state, checked_at, expires_at, metadata FROM reference_cache;
  DROP TABLE reference_cache;
  ALTER TABLE reference_cache_new RENAME TO reference_cache;

  CREATE TABLE project_references_new (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doi TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('found', 'not-found')),
    checked_at INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    PRIMARY KEY(project_id, doi, provider)
  ) STRICT;
  INSERT INTO project_references_new SELECT project_id, doi, 'crossref', state, checked_at, metadata FROM project_references;
  DROP TABLE project_references;
  ALTER TABLE project_references_new RENAME TO project_references;

  PRAGMA user_version = 4;
`;

function snapshot(row) {
  return {
    doi: row.doi,
    provider: row.provider,
    status: row.state,
    checkedAt: row.checked_at,
    metadata: JSON.parse(row.metadata),
  };
}

export function referenceStore(db, now, transact) {
  const cached = db.prepare(`
    SELECT doi, provider, state, checked_at, metadata
    FROM reference_cache WHERE owner_id = ? AND doi = ? AND provider = ? AND expires_at > ?
  `);
  const cache = db.prepare(`
    INSERT INTO reference_cache VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, doi, provider) DO UPDATE SET state = excluded.state,
      checked_at = excluded.checked_at, expires_at = excluded.expires_at, metadata = excluded.metadata
  `);
  const prune = db.prepare(`
    DELETE FROM reference_cache WHERE owner_id = ? AND provider = ? AND (
      expires_at <= ? OR doi IN (
        SELECT doi FROM reference_cache WHERE owner_id = ? AND provider = ?
        ORDER BY checked_at DESC, doi LIMIT -1 OFFSET 250
      )
    )
  `);
  const list = db.prepare(`
    SELECT record.doi, record.provider, record.state, record.checked_at, record.metadata
    FROM project_references AS record JOIN projects ON projects.id = record.project_id
    WHERE projects.owner_id = ? AND projects.id = ? AND (? OR record.provider <> 'agency') ORDER BY record.doi, record.provider, record.checked_at DESC
  `);
  const review = db.prepare(`
    SELECT r.doi, r.provider, r.state, r.checked_at, r.metadata
    FROM project_references r JOIN projects p ON p.id = r.project_id
    WHERE p.owner_id = ? AND p.id = ? AND r.provider NOT IN ('orcid', 'agency')
      AND (? = '' OR instr(lower(r.doi), lower(?)) > 0
        OR instr(lower(COALESCE(json_extract(r.metadata, '$.title'), '')), lower(?)) > 0)
    ORDER BY r.checked_at DESC, r.doi, r.provider LIMIT ?
  `);
  const upsert = db.prepare(`
    INSERT INTO project_references
    SELECT projects.id, ?, ?, ?, ?, ? FROM projects WHERE owner_id = ? AND id = ?
    ON CONFLICT(project_id, doi, provider) DO UPDATE SET state = excluded.state,
      checked_at = excluded.checked_at, metadata = excluded.metadata
    WHERE excluded.checked_at >= project_references.checked_at
  `);
  const project = db.prepare('SELECT id FROM projects WHERE owner_id = ? AND id = ?');
  const remove = db.prepare(`
    DELETE FROM project_references WHERE doi = ? AND provider = ? AND project_id = (
      SELECT id FROM projects WHERE owner_id = ? AND id = ?
    )
  `);

  return {
    cached(owner, doi, provider) {
      const row = cached.get(owner, doi, provider, now());
      return row ? snapshot(row) : null;
    },
    list(owner, projectId, { includeAgency = false } = {}) {
      return list.all(owner, projectId, Number(includeAgency)).map(snapshot);
    },
    review(owner, projectId, filter, limit) {
      return review.all(owner, projectId, filter, filter, filter, limit).map(snapshot);
    },
    save(owner, projectId, { doi, provider, status, checkedAt, metadata }, fresh) {
      return transact(db, () => {
        if (!project.get(owner, projectId)) return false;
        const json = JSON.stringify(metadata);
        upsert.run(doi, provider, status, checkedAt, json, owner, projectId);
        if (fresh) {
          const ttl = status === 'found' ? successTtl : missingTtl;
          cache.run(owner, doi, provider, status, checkedAt, checkedAt + ttl, json);
          prune.run(owner, provider, now(), owner, provider);
        }
        return true;
      });
    },
    remove(owner, projectId, doi, provider) {
      return remove.run(doi, provider, owner, projectId).changes === 1;
    },
  };
}
