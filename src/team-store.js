import { normalizeDoi } from './crossref.js';
import { randomUUID } from 'node:crypto';

export const teamSchema = `
  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('administrator','researcher','reviewer','read-only')),
    state TEXT NOT NULL CHECK(state IN ('pending','accepted','declined','revoked')),
    PRIMARY KEY(project_id, account_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS project_members_account ON project_members(account_id, state);
  CREATE TABLE IF NOT EXISTS team_events (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    subject TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL, target TEXT, recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS team_events_project ON team_events(project_id, id DESC);
  CREATE TABLE IF NOT EXISTS team_manuscripts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS team_manuscripts_project ON team_manuscripts(project_id);
  CREATE TABLE IF NOT EXISTS team_manuscript_versions (
    id INTEGER PRIMARY KEY, manuscript_id TEXT NOT NULL REFERENCES team_manuscripts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, author TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    body TEXT NOT NULL, recorded_at INTEGER NOT NULL, UNIQUE(manuscript_id, version)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS team_reviews (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    manuscript_version INTEGER REFERENCES team_manuscript_versions(id) ON DELETE CASCADE,
    evidence_id TEXT REFERENCES evidence_items(id) ON DELETE CASCADE,
    reviewer TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('accepted','changes-requested')),
    note TEXT NOT NULL, recorded_at INTEGER NOT NULL,
    CHECK((manuscript_version IS NULL) <> (evidence_id IS NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS team_reviews_project ON team_reviews(project_id, id DESC);
  PRAGMA user_version = 18;
`;

export const teamWorkSchema = `
  CREATE TABLE IF NOT EXISTS team_notes (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author TEXT REFERENCES accounts(id) ON DELETE SET NULL, body TEXT NOT NULL, recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS team_notes_project ON team_notes(project_id, id DESC);
  CREATE TABLE IF NOT EXISTS team_tasks (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','done')),
    author TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    updated_by TEXT REFERENCES accounts(id) ON DELETE SET NULL, recorded_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS team_tasks_project ON team_tasks(project_id, id DESC);
  PRAGMA user_version = 20;
`;

export const manuscriptCatalogSchema = `
  CREATE TABLE IF NOT EXISTS manuscript_metadata (
    id INTEGER PRIMARY KEY, manuscript_id TEXT NOT NULL REFERENCES team_manuscripts(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, editor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    authors TEXT NOT NULL, tags TEXT NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('draft','submitted','published')),
    doi TEXT, recorded_at INTEGER NOT NULL, UNIQUE(manuscript_id, revision)
  ) STRICT;
  PRAGMA user_version = 21;
`;

export const publicationStages = ['draft', 'submitted', 'published'];

export const teamRoles = ['administrator', 'researcher', 'reviewer', 'read-only'];
const rights = {
  owner: ['manage', 'write', 'review', 'audit'],
  administrator: ['manage', 'write', 'review', 'audit'],
  researcher: ['write'],
  reviewer: ['review'],
  'read-only': [],
};

export function teamStore(db, now, transact) {
  const project = db.prepare('SELECT id, owner_id, title FROM projects WHERE id = ?');
  const member = db.prepare('SELECT role, state FROM project_members WHERE project_id = ? AND account_id = ?');
  const blocked = db.prepare(`SELECT 1 FROM researcher_links WHERE kind = 'block'
    AND ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))`);
  const discoverable = db.prepare('SELECT 1 FROM researcher_profiles WHERE account_id = ? AND discoverable = 1');
  const invite = db.prepare(`INSERT INTO project_members VALUES (?, ?, ?, 'pending')
    ON CONFLICT(project_id,account_id) DO UPDATE SET role = excluded.role, state = 'pending'
    WHERE project_members.role <> excluded.role OR project_members.state IN ('revoked','declined')`);
  const transition = db.prepare('UPDATE project_members SET state = ? WHERE project_id = ? AND account_id = ?');
  const inviteId = db.prepare(`SELECT id FROM team_events WHERE project_id = ? AND subject = ? AND action = 'invited' ORDER BY id DESC LIMIT 1`);
  const inbox = db.prepare(`SELECT p.id, p.title, m.role, m.state,
    (SELECT max(id) FROM team_events WHERE project_id = p.id AND subject = m.account_id AND action = 'invited') AS invitation FROM project_members m JOIN projects p ON p.id = m.project_id
    WHERE m.account_id = ? AND m.state IN ('pending', 'accepted') ORDER BY p.title, p.id`);
  const members = db.prepare(`SELECT m.account_id, m.role, m.state, CASE WHEN r.discoverable = 1 THEN r.name END AS name
    FROM project_members m LEFT JOIN researcher_profiles r ON r.account_id = m.account_id WHERE m.project_id = ?
    ORDER BY m.role, m.account_id`);
  const event = db.prepare('INSERT INTO team_events(project_id,actor,subject,action,target,recorded_at) VALUES (?,?,?,?,?,?)');
  const audit = db.prepare('SELECT actor,subject,action,target,recorded_at FROM team_events WHERE project_id = ? ORDER BY id DESC LIMIT 50');
  const pending = db.prepare("SELECT count(*) AS total FROM project_members WHERE account_id = ? AND state = 'pending'");
  const notes = db.prepare('SELECT * FROM team_notes WHERE project_id = ? ORDER BY id DESC LIMIT 50 OFFSET ?');
  const tasks = db.prepare('SELECT * FROM team_tasks WHERE project_id = ? ORDER BY id DESC LIMIT 50 OFFSET ?');
  const addNote = db.prepare('INSERT INTO team_notes(project_id,author,body,recorded_at) VALUES (?,?,?,?)');
  const addTask = db.prepare(`INSERT INTO team_tasks(project_id,title,state,author,updated_by,recorded_at,updated_at)
    VALUES (?,?,'open',?,?,?,?)`);
  const changeTask = db.prepare(`UPDATE team_tasks SET state = ?, updated_by = ?, updated_at = ?
    WHERE project_id = ? AND id = ? AND state = ?`);
  const blockedGrants = db.prepare(`SELECT m.project_id, m.account_id FROM project_members m JOIN projects p ON p.id = m.project_id
    WHERE m.state IN ('pending','accepted') AND ((p.owner_id = ? AND m.account_id = ?) OR (p.owner_id = ? AND m.account_id = ?))`);
  const addManuscript = db.prepare('INSERT INTO team_manuscripts VALUES (?, ?, ?)');
  const manuscripts = db.prepare(`SELECT m.id, m.title, max(v.version) AS version,
      COALESCE(x.stage,'draft') AS stage, x.authors,x.tags,x.doi
    FROM team_manuscripts m JOIN team_manuscript_versions v ON v.manuscript_id=m.id
    LEFT JOIN manuscript_metadata x ON x.id=(SELECT id FROM manuscript_metadata WHERE manuscript_id=m.id ORDER BY revision DESC LIMIT 1)
    WHERE m.project_id=:project AND (:stage='' OR COALESCE(x.stage,'draft')=:stage) AND
      (:query='' OR instr(lower(m.title),lower(:query))>0 OR instr(lower(COALESCE(x.authors,'')),lower(:query))>0 OR
        instr(lower(COALESCE(x.tags,'')),lower(:query))>0 OR instr(lower(COALESCE(x.doi,'')),lower(:query))>0)
    GROUP BY m.id ORDER BY m.title,m.id LIMIT 50 OFFSET :offset`);
  const metadata = db.prepare(`SELECT x.revision,x.editor,x.authors,x.tags,x.stage,x.doi,x.recorded_at
    FROM manuscript_metadata x JOIN team_manuscripts m ON m.id=x.manuscript_id
    WHERE m.project_id=? AND m.id=? ORDER BY x.revision DESC LIMIT 20`);
  const addMetadata = db.prepare(`INSERT INTO manuscript_metadata(manuscript_id,revision,editor,authors,tags,stage,doi,recorded_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const versions = db.prepare(`SELECT v.id, v.version, v.author, v.body, v.recorded_at FROM team_manuscript_versions v
    JOIN team_manuscripts m ON m.id=v.manuscript_id WHERE m.project_id=? AND m.id=? ORDER BY v.version DESC LIMIT 50`);
  const latest = db.prepare(`SELECT max(v.version) AS version FROM team_manuscript_versions v
    JOIN team_manuscripts m ON m.id=v.manuscript_id WHERE m.project_id=? AND m.id=?`);
  const addVersion = db.prepare('INSERT INTO team_manuscript_versions(manuscript_id,version,author,body,recorded_at) VALUES (?,?,?,?,?)');
  const evidence = db.prepare(`SELECT e.id,c.statement,e.relation,e.source_snapshot FROM evidence_items e
    JOIN claims c ON c.id=e.claim_id WHERE c.project_id=? ORDER BY e.created_at DESC,e.id LIMIT 100`);
  const validEvidence = db.prepare(`SELECT 1 FROM evidence_items e JOIN claims c ON c.id=e.claim_id WHERE c.project_id=? AND e.id=?`);
  const validVersion = db.prepare(`SELECT 1 FROM team_manuscript_versions v JOIN team_manuscripts m ON m.id=v.manuscript_id
    WHERE m.project_id=? AND v.id=?`);
  const addReview = db.prepare(`INSERT INTO team_reviews(project_id,manuscript_version,evidence_id,reviewer,outcome,note,recorded_at)
    VALUES (?,?,?,?,?,?,?)`);
  const reviews = db.prepare(`SELECT r.id,r.manuscript_version,r.evidence_id,r.reviewer,r.outcome,r.note,r.recorded_at,
    m.id AS manuscript_id,m.title AS manuscript_title,v.version
    FROM team_reviews r LEFT JOIN team_manuscript_versions v ON v.id=r.manuscript_version
    LEFT JOIN team_manuscripts m ON m.id=v.manuscript_id WHERE r.project_id=? ORDER BY r.id DESC LIMIT 100`);

  const reviewableReadiness = db.prepare(`
    SELECT r.revision, r.assessment_id, r.intended_use, r.reviewer AS author, r.recorded_at, r.dimensions, r.safety, r.authorization
    FROM readiness_revisions r WHERE r.project_id = ?
      AND r.revision = (SELECT MAX(v.revision) FROM readiness_revisions v WHERE v.assessment_id = r.assessment_id AND v.project_id = r.project_id)
    ORDER BY r.revision DESC LIMIT 100
  `);
  const readinessRevision = db.prepare(`
    SELECT r.reviewer AS author, r.revision = (SELECT MAX(v.revision) FROM readiness_revisions v
      WHERE v.assessment_id = r.assessment_id AND v.project_id = r.project_id) AS latest
    FROM readiness_revisions r WHERE r.project_id = ? AND r.revision = ?
  `);
  const insertReadinessReview = db.prepare(`
    INSERT INTO readiness_reviews VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(revision, reviewer) DO NOTHING
  `);
  const readinessHistory = db.prepare(`
    SELECT x.*, r.intended_use FROM readiness_reviews x JOIN readiness_revisions r ON r.revision = x.revision
    WHERE r.project_id = ? ORDER BY x.recorded_at DESC, x.rowid DESC LIMIT 100
  `);

  const isBlocked = (first, second) => Boolean(blocked.get(first, second, second, first));
  function access(actor, id) {
    const row = project.get(id);
    if (!row) return undefined;
    if (actor === row.owner_id) return { ...row, role: 'owner', rights: rights.owner };
    const grant = member.get(id, actor);
    if (grant?.state !== 'accepted' || isBlocked(row.owner_id, actor)) return undefined;
    return { ...row, role: grant.role, rights: rights[grant.role], invitation: inviteId.get(id,actor)?.id };
  }

  function record(id, actor, subject, action, target = null) {
    event.run(id, actor, subject, action, target, now());
  }

  return {
    access,
    activeMembers(owner, project) {
      if (access(owner,project)?.role !== 'owner') return [];
      return members.all(project).filter((member) => member.state === 'accepted' && access(member.account_id,project));
    },
    inbox: (actor) => inbox.all(actor),
    pending: (actor) => pending.get(actor).total,
    work(actor, id, offset) {
      const current = access(actor, id);
      if (!current) return undefined;
      return { ...current, notes: notes.all(id, offset), tasks: tasks.all(id, offset) };
    },
    addWork(actor, id, kind, text) {
      return transact(db, () => {
        if (!access(actor, id)?.rights.includes('write')) return 403;
        if (!['note','task'].includes(kind) || !text || (kind === 'note' ? text.length > 2000 : text.length > 150)) return 422;
        const at = now();
        const inserted = kind === 'note' ? addNote.run(id, actor, text, at) : addTask.run(id, text, actor, actor, at, at);
        record(id, actor, null, kind, String(inserted.lastInsertRowid));
        return 303;
      });
    },
    changeTask(actor, id, task, from, to) {
      return transact(db, () => {
        if (!access(actor, id)?.rights.includes('write')) return 403;
        if (!['open','done'].includes(from) || !['open','done'].includes(to) || from === to) return 422;
        if (!changeTask.run(to, actor, now(), id, task, from).changes) return 409;
        record(id, actor, null, 'task-' + to, String(task));
        return 303;
      });
    },
    revokeOnBlock(first, second) {
      for (const grant of blockedGrants.all(first, second, second, first)) {
        transition.run('revoked', grant.project_id, grant.account_id);
        record(grant.project_id, first, grant.account_id, 'blocked');
      }
    },
    grant(actor, id, subject, role) {
      return transact(db, () => {
        const current = access(actor, id);
        if (!current?.rights.includes('manage') || !teamRoles.includes(role) || subject === actor || subject === current.owner_id) return false;
        if (current.role !== 'owner' && (role === 'administrator' || member.get(id, subject)?.role === 'administrator')) return false;
        if (!discoverable.get(subject) || isBlocked(actor, subject) || isBlocked(current.owner_id, subject)) return false;
        if (!invite.run(id, subject, role).changes) return false;
        record(id, actor, subject, 'invited', role);
        return true;
      });
    },
    revoke(actor, id, subject) {
      return transact(db, () => {
        const current = access(actor, id);
        const grant = member.get(id, subject);
        if (!current?.rights.includes('manage') || !grant || !['pending','accepted'].includes(grant.state)) return false;
        if (current.role !== 'owner' && grant.role === 'administrator') return false;
        transition.run('revoked', id, subject);
        record(id, actor, subject, 'revoked', grant.role);
        return true;
      });
    },
    decide(actor, id, role, invitation, state) {
      return transact(db, () => {
        const grant = member.get(id, actor);
        const row = project.get(id);
        if (grant?.state !== 'pending' || grant.role !== role || inviteId.get(id, actor)?.id !== invitation || !row || isBlocked(row.owner_id, actor) ||
            !['accepted','declined'].includes(state)) return false;
        transition.run(state, id, actor);
        record(id, actor, actor, state, role);
        return true;
      });
    },
    view(actor, id, manuscript, { query = '', stage = '', offset = 0 } = {}) {
      const current = access(actor, id);
      if (!current) return undefined;
      return {
        ...current, manuscripts: manuscripts.all({ project: id, query, stage, offset }),
        versions: manuscript ? versions.all(id, manuscript) : [],
        metadata: manuscript ? metadata.all(id, manuscript) : [],
        evidence: evidence.all(id), reviews: reviews.all(id),
        readiness: reviewableReadiness.all(id), readinessHistory: readinessHistory.all(id),
        members: current.rights.includes('manage') ? members.all(id) : [],
        events: current.rights.includes('audit') ? audit.all(id) : [],
      };
    },
    updateMetadata(actor, id, { manuscript, base, authors, tags, stage, doi }) {
      return transact(db, () => {
        if (!access(actor, id)?.rights.includes('write')) return 403;
        if (latest.get(id, manuscript).version === null) return 404;
        const previous = metadata.get(id, manuscript)?.revision ?? 0;
        if (previous !== base) return 409;
        const identifier = doi ? normalizeDoi(doi) : null;
        if (!publicationStages.includes(stage) || (doi && !identifier) ||
            authors.length > 20 || tags.length > 20 || authors.some((name) => name.length > 100) || tags.some((tag) => tag.length > 40)) return 422;
        addMetadata.run(manuscript, previous + 1, actor, JSON.stringify(authors), JSON.stringify(tags), stage, identifier, now());
        record(id, actor, null, 'metadata', manuscript + ':' + (previous + 1));
        return 303;
      });
    },
    save(actor, id, { manuscript, title, body, base }) {
      return transact(db, () => {
        if (!access(actor, id)?.rights.includes('write')) return 403;
        if (!body || body.length > 12_000) return 422;
        let version = 1;
        if (manuscript) {
          const previous = latest.get(id, manuscript).version;
          if (previous === null) return 404;
          if (previous !== base) return 409;
          version = previous + 1;
        } else {
          if (!title || title.length > 150) return 422;
          manuscript = randomUUID();
          addManuscript.run(manuscript, id, title);
        }
        addVersion.run(manuscript, version, actor, body, now());
        record(id, actor, null, 'version', manuscript + ':' + version);
        return manuscript;
      });
    },
    reviewReadiness(actor, id, { revision, decision, note, independence }) {
      return transact(db, () => {
        if (access(actor, id)?.role !== 'reviewer') return 403;
        if (!Number.isSafeInteger(revision) || revision <= 0 || independence !== 'declared' ||
            !['accepted', 'changes-requested'].includes(decision) || !note || note.length > 2000) return 422;
        const target = readinessRevision.get(id, revision);
        if (!target) return 404;
        if (target.author === actor) return 403;
        if (!target.latest) return 409;
        if (!insertReadinessReview.run(revision, actor, decision, note, now()).changes) return 409;
        record(id, actor, null, 'review', 'readiness:' + revision);
        return 303;
      });
    },
    review(actor, id, { version, item, outcome, note }) {
      return transact(db, () => {
        if (!access(actor, id)?.rights.includes('review')) return 403;
        if (!['accepted','changes-requested'].includes(outcome) || !note || note.length > 2000 || Boolean(version) === Boolean(item)) return 422;
        if (version ? !validVersion.get(id, version) : !validEvidence.get(id, item)) return 404;
        const result = addReview.run(id, version || null, item || null, actor, outcome, note, now());
        record(id, actor, null, 'review', String(result.lastInsertRowid));
        return 303;
      });
    },
  };
}
