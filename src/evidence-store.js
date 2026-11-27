import { randomUUID } from 'node:crypto';

export const evidenceSchema = `
  CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    statement TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX claims_project ON claims(project_id, created_at, id);

  CREATE TABLE evidence_items (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    source_snapshot TEXT NOT NULL,
    relation TEXT NOT NULL CHECK(relation IN ('supports', 'conflicts', 'inconclusive')),
    study_type TEXT NOT NULL,
    limitations TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    review TEXT CHECK(review IN ('accepted', 'rejected')),
    review_note TEXT,
    reviewed_at INTEGER,
    reviewed_by TEXT
  ) STRICT;
  CREATE INDEX evidence_claim ON evidence_items(claim_id, created_at, id);
  PRAGMA user_version = 5;
`;

export function evidenceStore(db, now, transact) {
  const insertClaim = db.prepare(`
    INSERT INTO claims SELECT ?, id, ?, ? FROM projects WHERE owner_id = ? AND id = ?
  `);
  const selectClaims = db.prepare(`
    SELECT claims.id, statement, created_at FROM claims JOIN projects ON projects.id = claims.project_id
    WHERE projects.owner_id = ? AND projects.id = ? ORDER BY created_at, claims.id
  `);
  const selectItems = db.prepare(`
    SELECT item.* FROM evidence_items AS item JOIN claims ON claims.id = item.claim_id
    JOIN projects ON projects.id = claims.project_id
    WHERE projects.owner_id = ? AND projects.id = ? ORDER BY item.created_at, item.id
  `);
  const link = db.prepare(`
    INSERT INTO evidence_items (id, claim_id, source_snapshot, relation, study_type, limitations, created_at)
    SELECT ?, claims.id, json_object('identifier', ref.doi, 'provider', ref.provider,
      'retrievedAt', ref.checked_at, 'metadata', json(ref.metadata)), ?, ?, ?, ?
    FROM claims JOIN projects ON projects.id = claims.project_id
    JOIN project_references AS ref ON ref.project_id = projects.id
    WHERE projects.owner_id = ? AND projects.id = ? AND claims.id = ?
      AND ref.doi = ? AND ref.provider = ? AND ref.provider NOT IN ('orcid', 'agency') AND ref.state = 'found'
      AND NOT EXISTS (
        SELECT 1 FROM evidence_items
        WHERE claim_id = claims.id AND json_extract(source_snapshot, '$.identifier') = ref.doi
          AND json_extract(source_snapshot, '$.provider') = ref.provider
      )
  `);
  const review = db.prepare(`
    UPDATE evidence_items SET review = ?, review_note = ?, reviewed_at = ?, reviewed_by = ?
    WHERE id = ? AND review IS NULL AND claim_id IN (
      SELECT claims.id FROM claims JOIN projects ON projects.id = claims.project_id
      WHERE projects.owner_id = ? AND projects.id = ?
    )
  `);

  return {
    list(owner, project) {
      const claims = new Map(selectClaims.all(owner, project).map((claim) => [
        claim.id, { id: claim.id, statement: claim.statement, createdAt: claim.created_at, evidence: [] },
      ]));
      for (const row of selectItems.all(owner, project)) {
        claims.get(row.claim_id)?.evidence.push({
          id: row.id, source: JSON.parse(row.source_snapshot), relation: row.relation,
          studyType: row.study_type, limitations: row.limitations, createdAt: row.created_at,
          review: row.review && { decision: row.review, note: row.review_note, reviewedAt: row.reviewed_at, reviewer: row.reviewed_by },
        });
      }
      return [...claims.values()];
    },
    addClaim(owner, project, statement) {
      return insertClaim.run(randomUUID(), statement, now(), owner, project).changes === 1;
    },
    link(owner, project, { claim, doi, provider, relation, studyType, limitations }) {
      return transact(db, () => link.run(
        randomUUID(), relation, studyType, limitations, now(), owner, project, claim, doi, provider,
      ).changes === 1);
    },
    review(owner, project, { item, decision, note }) {
      return review.run(decision, note, now(), owner, item, owner, project).changes === 1;
    },
  };
}
