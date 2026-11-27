import { randomUUID } from 'node:crypto';

export const resourceSchema = `
  CREATE TABLE IF NOT EXISTS resource_grants (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    invitation INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('document','reference','readiness','report')),
    resource_key TEXT NOT NULL, title TEXT NOT NULL, snapshot TEXT NOT NULL,
    granted_by TEXT REFERENCES accounts(id) ON DELETE SET NULL, granted_at INTEGER NOT NULL,
    revoked_by TEXT REFERENCES accounts(id) ON DELETE SET NULL, revoked_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS resource_grants_project ON resource_grants(project_id, granted_at DESC);
  CREATE INDEX IF NOT EXISTS resource_grants_recipient ON resource_grants(recipient, project_id);
  PRAGMA user_version = 24;
`;

export function resourceStore(db, now, transact, teams) {
  const find = db.prepare('SELECT * FROM resource_grants WHERE id=? AND project_id=? AND revoked_at IS NULL');
  const record = db.prepare(`INSERT INTO resource_grants
    (id,project_id,recipient,invitation,kind,resource_key,title,snapshot,granted_by,granted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const current = db.prepare(`SELECT id FROM resource_grants WHERE project_id=? AND recipient=? AND invitation=? AND
    kind=? AND resource_key=? AND revoked_at IS NULL LIMIT 1`);
  const history = db.prepare(`SELECT id,recipient,invitation,kind,title,granted_by,granted_at,revoked_by,revoked_at FROM resource_grants
    WHERE project_id=? ORDER BY granted_at DESC,id LIMIT 51 OFFSET ?`);
  const received = db.prepare(`SELECT id,kind,title,granted_at FROM resource_grants
    WHERE project_id=? AND recipient=? AND invitation=? AND revoked_at IS NULL ORDER BY granted_at DESC,id LIMIT 51 OFFSET ?`);
  const revoke = db.prepare(`UPDATE resource_grants SET revoked_by=?,revoked_at=? WHERE id=? AND project_id=? AND revoked_at IS NULL`);

  return {
    list(actor, project, offset) {
      const member = teams.access(actor,project);
      if (!member) return undefined;
      return { ...member, grants: member.role === 'owner'
        ? history.all(project,offset).map((grant) => ({ ...grant,
          effective: !grant.revoked_at && teams.access(grant.recipient,project)?.invitation === grant.invitation }))
        : received.all(project,actor,member.invitation,offset) };
    },
    get(actor, project, id) {
      const member = teams.access(actor,project);
      if (!member) return undefined;
      const row = find.get(id,project);
      if (!row || (member.role !== 'owner' && (row.recipient !== actor || row.invitation !== member.invitation))) return undefined;
      return { ...row, owner: member.owner_id, data: JSON.parse(row.snapshot) };
    },
    grant(owner, project, recipient, resource) {
      return transact(db, () => {
        const membership = teams.access(recipient,project);
        if (teams.access(owner,project)?.role !== 'owner' || !membership?.invitation) return undefined;
        const { invitation } = membership;
        const previous = current.get(project,recipient,invitation,resource.kind,resource.key);
        if (previous) return previous.id;
        const data = JSON.stringify(resource.data);
        if (Buffer.byteLength(data) > 1024 * 1024) return undefined;
        const id = randomUUID();
        record.run(id,project,recipient,invitation,resource.kind,resource.key,resource.title,data,owner,now());
        return id;
      });
    },
    revoke(owner, project, id) {
      return transact(db, () => teams.access(owner,project)?.role === 'owner' &&
        Boolean(revoke.run(owner,now(),id,project).changes));
    },
  };
}
