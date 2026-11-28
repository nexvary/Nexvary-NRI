export const networkSchema = `
  CREATE TABLE researcher_profiles (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, interests TEXT NOT NULL, orcid TEXT NOT NULL,
    discoverable INTEGER NOT NULL CHECK(discoverable IN (0, 1))
  ) STRICT;
  CREATE TABLE researcher_links (
    sender TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    recipient TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('follow','request','block')),
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(sender, recipient, kind),
    CHECK(sender <> recipient),
    CHECK((kind='request' AND state IN ('pending','accepted','declined')) OR (kind <> 'request' AND state='active'))
  ) STRICT;
  CREATE INDEX researcher_links_recipient ON researcher_links(recipient, kind, sender);
  CREATE TABLE researcher_request_events (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX researcher_request_events_account ON researcher_request_events(account_id, created_at);
  PRAGMA user_version = 8;
`;

export const networkModerationSchema = `
  CREATE TABLE IF NOT EXISTS researcher_reports (
    id INTEGER PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK(reason IN ('spam','impersonation','harassment','other')),
    state TEXT NOT NULL CHECK(state IN ('pending','actioned','dismissed')),
    created_at INTEGER NOT NULL,
    reviewed_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    reviewed_at INTEGER,
    CHECK(reporter_id <> subject_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS researcher_reports_queue ON researcher_reports(state,created_at,id);
  CREATE TABLE IF NOT EXISTS researcher_moderation_events (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES researcher_reports(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK(action IN ('actioned','dismissed')),
    created_at INTEGER NOT NULL
  ) STRICT;
  PRAGMA user_version = 46;
`;

export function networkStore(db, now, transact, revokeShares) {
  const profile = db.prepare('SELECT name, interests, orcid, discoverable FROM researcher_profiles WHERE account_id = ?');
  const save = db.prepare(`INSERT INTO researcher_profiles VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET name=excluded.name, interests=excluded.interests,
       orcid=excluded.orcid, discoverable=excluded.discoverable`);
  const unpublish = db.prepare(`DELETE FROM researcher_links WHERE kind <> 'block' AND (sender=? OR recipient=?)`);
  const collaborations = db.prepare(`SELECT count(DISTINCT CASE WHEN sender=:owner THEN recipient ELSE sender END) AS total
    FROM researcher_links WHERE kind='request' AND state='accepted' AND (sender=:owner OR recipient=:owner)`);
  const visible = `r.discoverable=1 AND r.account_id <> ? AND NOT EXISTS (
    SELECT 1 FROM researcher_links b WHERE b.kind='block'
      AND ((b.sender=? AND b.recipient=r.account_id) OR (b.sender=r.account_id AND b.recipient=?))
  )`;
  const discover = db.prepare(`
    SELECT r.account_id AS id, r.name, r.interests, r.orcid,
      EXISTS(SELECT 1 FROM researcher_links f WHERE f.sender=? AND f.recipient=r.account_id AND f.kind='follow') AS following,
      (SELECT state FROM researcher_links q WHERE q.sender=? AND q.recipient=r.account_id AND q.kind='request') AS request
    FROM researcher_profiles r WHERE ${visible}
      AND (? = '' OR instr(lower(r.name),lower(?)) > 0 OR instr(lower(r.interests),lower(?)) > 0)
    ORDER BY r.name, r.account_id LIMIT 40
  `);
  const target = db.prepare(`SELECT account_id FROM researcher_profiles r WHERE r.account_id=? AND ${visible}`);
  const insert = db.prepare('INSERT OR IGNORE INTO researcher_links VALUES (?, ?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM researcher_links WHERE sender=? AND recipient=? AND kind=?');
  const clearPair = db.prepare(`DELETE FROM researcher_links WHERE kind <> 'block'
    AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))`);
  const blocked = db.prepare(`
    SELECT r.account_id AS id, CASE WHEN r.discoverable=1 THEN r.name ELSE '' END AS name
    FROM researcher_links b JOIN researcher_profiles r ON r.account_id=b.recipient
    WHERE b.sender=? AND b.kind='block' ORDER BY b.created_at DESC
  `);
  const incoming = db.prepare(`
    SELECT r.account_id AS id, r.name, l.state FROM researcher_links l
    JOIN researcher_profiles r ON r.account_id=l.sender
    WHERE l.recipient=? AND l.kind='request' AND ${visible} ORDER BY l.created_at DESC LIMIT 40
  `);
  const decide = db.prepare(`UPDATE researcher_links SET state=?
    WHERE sender=? AND recipient=? AND kind='request' AND state='pending'`);
  const countRecent = db.prepare(`SELECT count(*) AS total FROM researcher_request_events
    WHERE account_id=? AND created_at>? `);

  const pruneEvents = db.prepare('DELETE FROM researcher_request_events WHERE account_id=? AND created_at <= ?');
  const requestEvent = db.prepare('INSERT INTO researcher_request_events VALUES (?, ?)');
  const pendingReport = db.prepare("SELECT 1 FROM researcher_reports WHERE reporter_id=? AND subject_id=? AND state='pending'");
  const reportableProfile = db.prepare('SELECT 1 FROM researcher_profiles WHERE account_id=? AND discoverable=1');
  const recentReports = db.prepare("SELECT count(*) AS total FROM researcher_reports WHERE reporter_id=? AND created_at>?");
  const insertReport = db.prepare("INSERT INTO researcher_reports(reporter_id,subject_id,reason,state,created_at) VALUES (?,?,?,'pending',?)");
  const reportQueue = db.prepare(`SELECT r.id,r.reason,r.created_at AS createdAt,p.account_id AS subjectId,p.name AS subjectName,
      substr(r.reporter_id,1,8) AS reporterRef FROM researcher_reports r
      JOIN researcher_profiles p ON p.account_id=r.subject_id
      WHERE r.state='pending' ORDER BY r.created_at,r.id LIMIT 100`);
  const resolveReport = db.prepare(`UPDATE researcher_reports SET state=?,reviewed_by=?,reviewed_at=? WHERE id=? AND state='pending' RETURNING subject_id AS subjectId`);
  const hideProfile = db.prepare('UPDATE researcher_profiles SET discoverable=0 WHERE account_id=?');
  const recordModeration = db.prepare('INSERT INTO researcher_moderation_events(report_id,reviewer_id,action,created_at) VALUES (?,?,?,?)');
  const moderationEvents = db.prepare('SELECT report_id AS reportId,reviewer_id AS reviewerId,action,created_at AS createdAt FROM researcher_moderation_events ORDER BY id DESC LIMIT 100');

  function block(owner, peer) {
    clearPair.run(owner, peer, peer, owner);
    revokeShares(owner, peer);
    return insert.run(owner, peer, 'block', 'active', now()).changes === 1;
  }

  return {
    blockParticipant: (owner, peer) => transact(db, () => block(owner, peer)),
    collaborations: (owner) => collaborations.get({ owner }).total,
    profile: (owner) => profile.get(owner),
    discover: (owner, search) => discover.all(owner, owner, owner, owner, owner, search, search, search),
    incoming: (owner) => incoming.all(owner, owner, owner, owner),
    blocked: (owner) => blocked.all(owner),
    reports: () => reportQueue.all(),
    moderationEvents: () => moderationEvents.all(),
    report(owner, subject, reason) {
      if (owner === subject || !['spam','impersonation','harassment','other'].includes(reason)) return false;
      return transact(db, () => {
        const timestamp=now(), cutoff=timestamp-86_400_000;
        if (!reportableProfile.get(subject) || pendingReport.get(owner,subject) || recentReports.get(owner,cutoff).total>=5) return false;
        return insertReport.run(owner,subject,reason,timestamp).changes===1;
      });
    },
    reviewReport(reviewer, reportId, decision) {
      if (!Number.isSafeInteger(reportId) || !['actioned','dismissed'].includes(decision)) return false;
      return transact(db, () => {
        const timestamp=now();
        const result=resolveReport.get(decision,reviewer,timestamp,reportId);
        if (!result) return false;
        if (decision==='actioned') {
          hideProfile.run(result.subjectId);
          unpublish.run(result.subjectId,result.subjectId);
        }
        recordModeration.run(reportId,reviewer,decision,timestamp);
        return true;
      });
    },
    save(owner, { name, interests, orcid, discoverable }) {
      return transact(db, () => {
        save.run(owner, name, interests, orcid, Number(discoverable));
        if (!discoverable) unpublish.run(owner, owner);
        return true;
      });
    },
    interact(owner, peer, action) {
      return transact(db, () => {
        if (action === 'unblock') return remove.run(owner, peer, 'block').changes === 1;
        if (!target.get(peer, owner, owner, owner) || !profile.get(owner)?.discoverable) return false;
        switch (action) {
          case 'follow': return insert.run(owner, peer, 'follow', 'active', now()).changes === 1;
          case 'unfollow': return remove.run(owner, peer, 'follow').changes === 1;
          case 'request': {
            const timestamp = now();
            const cutoff = timestamp - 86_400_000;
            pruneEvents.run(owner, cutoff);
            if (countRecent.get(owner, cutoff).total >= 10) return false;
            if (insert.run(owner, peer, 'request', 'pending', timestamp).changes !== 1) return false;
            requestEvent.run(owner, timestamp);
            return true;
          }
          case 'accept':
          case 'decline': return decide.run(action === 'accept' ? 'accepted' : 'declined', peer, owner).changes === 1;
          case 'block': return block(owner, peer);
          default: return false;
        }
      });
    },
  };
}
