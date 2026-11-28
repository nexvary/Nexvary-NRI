import { randomUUID } from 'node:crypto';

export const readinessSchema = `
  CREATE TABLE readiness_revisions (
    revision INTEGER PRIMARY KEY,
    assessment_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    intended_use TEXT NOT NULL,
    dimensions TEXT NOT NULL,
    safety TEXT NOT NULL CHECK(safety IN ('unresolved', 'unsafe', 'documented')),
    authorization TEXT NOT NULL CHECK(authorization IN ('unknown', 'missing', 'documented')),
    reviewer TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX readiness_project_revision ON readiness_revisions(project_id, assessment_id, revision DESC);
  PRAGMA user_version = 6;
`;

export const readinessReviewSchema = `
  CREATE TABLE IF NOT EXISTS readiness_reviews (
    revision INTEGER NOT NULL REFERENCES readiness_revisions(revision) ON DELETE CASCADE,
    reviewer TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    decision TEXT NOT NULL CHECK(decision IN ('accepted', 'changes-requested')),
    note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 2000),
    recorded_at INTEGER NOT NULL,
    UNIQUE(revision, reviewer)
  ) STRICT;
  PRAGMA user_version = 29;
`;

export function readinessStore(db, now) {
  const list = db.prepare(`
    SELECT r.* FROM readiness_revisions r JOIN projects p ON r.project_id = p.id
    WHERE p.owner_id = ? AND p.id = ? ORDER BY r.revision DESC
  `);
  const reviews = db.prepare(`
    SELECT x.* FROM readiness_reviews x JOIN readiness_revisions r ON r.revision = x.revision
    JOIN projects p ON p.id = r.project_id
    WHERE p.owner_id = ? AND p.id = ? ORDER BY x.recorded_at DESC, x.rowid DESC
  `);
  const insert = db.prepare(`
    INSERT INTO readiness_revisions
      (assessment_id, project_id, intended_use, dimensions, safety, authorization, reviewer, recorded_at)
    SELECT ?, id, ?, ?, ?, ?, ?, ? FROM projects WHERE owner_id = ? AND id = ?
  `);
  const revise = db.prepare(`
    INSERT INTO readiness_revisions
      (assessment_id, project_id, intended_use, dimensions, safety, authorization, reviewer, recorded_at)
    SELECT r.assessment_id, r.project_id, r.intended_use, ?, ?, ?, ?, ?
    FROM readiness_revisions r JOIN projects p ON r.project_id = p.id
    WHERE p.owner_id = ? AND p.id = ? AND r.assessment_id = ? AND r.revision = ?
      AND r.revision = (SELECT MAX(revision) FROM readiness_revisions WHERE assessment_id = r.assessment_id)
  `);
  return {
    reviews(owner, project) { return reviews.all(owner, project); },
    list(owner, project) {
      return list.all(owner, project).map((r) => ({
        id: r.assessment_id, revision: r.revision, intendedUse: r.intended_use,
        dimensions: JSON.parse(r.dimensions), safety: r.safety, authorization: r.authorization,
        reviewer: r.reviewer, recordedAt: r.recorded_at,
      }));
    },
    save(owner, project, assessment) {
      const { id, revision, intendedUse, dimensions, safety, authorization } = assessment;
      const encoded = JSON.stringify(dimensions);
      return (id
        ? revise.run(encoded, safety, authorization, owner, now(), owner, project, id, revision)
        : insert.run(randomUUID(), intendedUse, encoded, safety, authorization, owner, now(), owner, project)
      ).changes === 1;
    },
  };
}
