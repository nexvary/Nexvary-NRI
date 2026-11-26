export const sharingSchema = `
  CREATE TABLE project_shares (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role='summary-reader'),
    state TEXT NOT NULL CHECK(state IN ('pending','accepted','declined','revoked')),
    PRIMARY KEY(project_id, recipient)
  ) STRICT;
  CREATE INDEX project_shares_recipient ON project_shares(recipient, state, project_id);
  CREATE TABLE project_share_events (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('pending','accepted','declined','revoked')),
    recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX project_share_events_project ON project_share_events(project_id, id DESC);
  PRAGMA user_version = 11;
`;

export function sharingStore(db, now, transact) {
  const canCommunicate = `NOT EXISTS (SELECT 1 FROM researcher_links b WHERE b.kind='block'
    AND ((b.sender=p.owner_id AND b.recipient=s.recipient) OR (b.sender=s.recipient AND b.recipient=p.owner_id)))`;
  const candidate = db.prepare(`
    SELECT r.account_id FROM projects p JOIN researcher_profiles r ON r.account_id=?
    WHERE p.owner_id=? AND p.id=? AND r.account_id<>p.owner_id AND r.discoverable=1
      AND NOT EXISTS (SELECT 1 FROM researcher_links b WHERE b.kind='block'
        AND ((b.sender=p.owner_id AND b.recipient=r.account_id) OR (b.sender=r.account_id AND b.recipient=p.owner_id)))
  `);
  const invite = db.prepare(`
    INSERT INTO project_shares VALUES (?, ?, 'summary-reader', 'pending')
    ON CONFLICT(project_id,recipient) DO UPDATE SET state='pending'
    WHERE state='revoked'
  `);
  const revoke = db.prepare(`
    UPDATE project_shares SET state='revoked' WHERE project_id=? AND recipient=?
      AND state IN ('pending','accepted') AND project_id IN (SELECT id FROM projects WHERE owner_id=?)
  `);
  const decide = db.prepare(`
    UPDATE project_shares AS s SET state=? WHERE s.project_id=? AND s.recipient=? AND s.state='pending'
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id=s.project_id AND ${canCommunicate})
  `);
  const access = db.prepare(`
    SELECT p.id, p.title, p.description FROM project_shares s JOIN projects p ON p.id=s.project_id
    WHERE s.project_id=? AND s.recipient=? AND s.state='accepted' AND ${canCommunicate}
  `);
  const inbox = db.prepare(`
    SELECT p.id, p.title, s.state, s.role FROM project_shares s JOIN projects p ON p.id=s.project_id
    WHERE s.recipient=? AND s.state IN ('pending','accepted') AND ${canCommunicate} ORDER BY p.title, p.id
  `);
  const outbox = db.prepare(`
    SELECT s.recipient, s.state, s.role,
      CASE WHEN r.discoverable=1 AND ${canCommunicate} THEN r.name ELSE '' END AS name
    FROM project_shares s JOIN projects p ON p.id=s.project_id
    LEFT JOIN researcher_profiles r ON r.account_id=s.recipient
    WHERE p.owner_id=? AND p.id=? ORDER BY s.state,s.recipient
  `);
  const event = db.prepare('INSERT INTO project_share_events(project_id,recipient,actor,state,recorded_at) VALUES (?,?,?,?,?)');
  const recordBlocked = db.prepare(`
    INSERT INTO project_share_events(project_id,recipient,actor,state,recorded_at)
    SELECT s.project_id,s.recipient,?,'revoked',?
    FROM project_shares s JOIN projects p ON p.id=s.project_id
    WHERE s.state IN ('pending','accepted') AND ((p.owner_id=? AND s.recipient=?) OR (p.owner_id=? AND s.recipient=?))
  `);
  const revokeBlocked = db.prepare(`
    UPDATE project_shares SET state='revoked' WHERE state IN ('pending','accepted')
    AND ((recipient=? AND project_id IN (SELECT id FROM projects WHERE owner_id=?))
      OR (recipient=? AND project_id IN (SELECT id FROM projects WHERE owner_id=?)))
  `);
  const history = db.prepare(`
    SELECT e.state, e.recorded_at AS recordedAt FROM project_share_events e JOIN projects p ON p.id=e.project_id
    WHERE p.owner_id=? AND p.id=? ORDER BY e.id DESC LIMIT 50
  `);

  return {
    access: (recipient, project) => access.get(project, recipient),
    inbox: (recipient) => inbox.all(recipient),
    outbox: (owner, project) => outbox.all(owner, project),
    history: (owner, project) => history.all(owner, project),
    revokeOnBlock(owner, peer) {
      recordBlocked.run(owner, now(), owner, peer, peer, owner);
      revokeBlocked.run(peer, owner, owner, peer);
    },
    invite(owner, project, recipient) {
      return transact(db, () => {
        if (!candidate.get(recipient, owner, project) || invite.run(project, recipient).changes !== 1) return false;
        event.run(project, recipient, owner, 'pending', now());
        return true;
      });
    },
    revoke(owner, project, recipient) {
      return transact(db, () => {
        if (revoke.run(project, recipient, owner).changes !== 1) return false;
        event.run(project, recipient, owner, 'revoked', now());
        return true;
      });
    },
    decide(recipient, project, state) {
      return transact(db, () => {
        if (!['accepted','declined'].includes(state) || decide.run(state, project, recipient).changes !== 1) return false;
        event.run(project, recipient, recipient, state, now());
        return true;
      });
    },
  };
}
