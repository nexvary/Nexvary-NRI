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
