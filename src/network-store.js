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

export const networkContentSchema = `
  CREATE TABLE IF NOT EXISTS researcher_posts (
    id INTEGER PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
    state TEXT NOT NULL DEFAULT 'visible' CHECK(state IN ('visible','hidden')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS researcher_posts_recent ON researcher_posts(state,created_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS researcher_post_comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES researcher_posts(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
    state TEXT NOT NULL DEFAULT 'visible' CHECK(state IN ('visible','hidden')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS researcher_post_comments_post ON researcher_post_comments(post_id,state,created_at,id);
  CREATE TABLE IF NOT EXISTS researcher_post_reactions (
    post_id INTEGER NOT NULL REFERENCES researcher_posts(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    reaction TEXT NOT NULL CHECK(reaction IN ('like','insightful','support')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(post_id,account_id,reaction)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS researcher_content_events (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS researcher_content_events_account ON researcher_content_events(account_id,created_at);
  CREATE TABLE IF NOT EXISTS researcher_content_reports (
    id INTEGER PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES researcher_profiles(account_id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
    post_id INTEGER REFERENCES researcher_posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES researcher_post_comments(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK(reason IN ('spam','impersonation','harassment','other')),
    state TEXT NOT NULL CHECK(state IN ('pending','actioned','dismissed')),
    created_at INTEGER NOT NULL,
    reviewed_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    reviewed_at INTEGER,
    CHECK(reporter_id <> subject_id),
    CHECK((target_type='post' AND post_id IS NOT NULL AND comment_id IS NULL) OR
      (target_type='comment' AND comment_id IS NOT NULL AND post_id IS NULL))
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS researcher_content_post_report_pending
    ON researcher_content_reports(reporter_id,post_id) WHERE state='pending' AND post_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS researcher_content_comment_report_pending
    ON researcher_content_reports(reporter_id,comment_id) WHERE state='pending' AND comment_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS researcher_content_report_queue ON researcher_content_reports(state,created_at,id);
  CREATE TABLE IF NOT EXISTS researcher_content_moderation_events (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES researcher_content_reports(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK(action IN ('actioned','dismissed')),
    created_at INTEGER NOT NULL
  ) STRICT;
  PRAGMA user_version = 49;
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
  const postVisible = db.prepare(`SELECT p.id,p.author_id FROM researcher_posts p JOIN researcher_profiles r ON r.account_id=p.author_id
    WHERE p.id=? AND p.state='visible' AND (p.author_id=? OR r.discoverable=1) AND NOT EXISTS (
      SELECT 1 FROM researcher_links b WHERE b.kind='block' AND
        ((b.sender=? AND b.recipient=p.author_id) OR (b.sender=p.author_id AND b.recipient=?)))`);
  const visiblePosts = db.prepare(`SELECT p.id,p.author_id AS authorId,r.name AS authorName,p.body,p.created_at AS createdAt,
      (SELECT count(*) FROM researcher_post_reactions x WHERE x.post_id=p.id AND x.reaction='like') AS likes,
      (SELECT count(*) FROM researcher_post_reactions x WHERE x.post_id=p.id AND x.reaction='insightful') AS insightful,
      (SELECT count(*) FROM researcher_post_reactions x WHERE x.post_id=p.id AND x.reaction='support') AS support,
      EXISTS(SELECT 1 FROM researcher_post_reactions x WHERE x.post_id=p.id AND x.account_id=? AND x.reaction='like') AS liked
    FROM researcher_posts p JOIN researcher_profiles r ON r.account_id=p.author_id
    WHERE p.state='visible' AND (p.author_id=? OR r.discoverable=1) AND NOT EXISTS (
      SELECT 1 FROM researcher_links b WHERE b.kind='block' AND
        ((b.sender=? AND b.recipient=p.author_id) OR (b.sender=p.author_id AND b.recipient=?)))
    ORDER BY p.created_at DESC,p.id DESC LIMIT 30`);
  const visibleComments = db.prepare(`SELECT c.id,c.author_id AS authorId,r.name AS authorName,c.body,c.created_at AS createdAt
    FROM researcher_post_comments c JOIN researcher_profiles r ON r.account_id=c.author_id
    WHERE c.post_id=? AND c.state='visible' AND (c.author_id=? OR r.discoverable=1) AND NOT EXISTS (
      SELECT 1 FROM researcher_links b WHERE b.kind='block' AND
        ((b.sender=? AND b.recipient=c.author_id) OR (b.sender=c.author_id AND b.recipient=?)))
    ORDER BY c.created_at,c.id LIMIT 50`);
  const addPost = db.prepare("INSERT INTO researcher_posts(author_id,body,state,created_at) VALUES (?,?,'visible',?)");
  const addComment = db.prepare("INSERT INTO researcher_post_comments(post_id,author_id,body,state,created_at) VALUES (?,?,?,'visible',?)");
  const addReaction = db.prepare('INSERT OR IGNORE INTO researcher_post_reactions VALUES (?,?,?,?)');
  const removeReaction = db.prepare('DELETE FROM researcher_post_reactions WHERE post_id=? AND account_id=? AND reaction=?');
  const contentEventCount = db.prepare('SELECT count(*) AS total FROM researcher_content_events WHERE account_id=? AND created_at>?');
  const addContentEvent = db.prepare('INSERT INTO researcher_content_events VALUES (?,?)');
  const pruneContentEvents = db.prepare('DELETE FROM researcher_content_events WHERE account_id=? AND created_at<=?');
  const getTarget = db.prepare(`SELECT p.author_id AS subjectId,p.id AS postId,NULL AS commentId,p.body FROM researcher_posts p
    WHERE p.id=? AND p.state='visible' UNION ALL
    SELECT c.author_id AS subjectId,c.post_id AS postId,c.id AS commentId,c.body FROM researcher_post_comments c
    JOIN researcher_posts p ON p.id=c.post_id WHERE c.id=? AND c.state='visible' AND p.state='visible'`);
  const pendingContentReport = db.prepare(`SELECT 1 FROM researcher_content_reports WHERE reporter_id=? AND state='pending'
    AND ((?='post' AND post_id=?) OR (?='comment' AND comment_id=?))`);
  const contentReportsToday = db.prepare('SELECT count(*) AS total FROM researcher_content_reports WHERE reporter_id=? AND created_at>?');
  const addContentReport = db.prepare(`INSERT INTO researcher_content_reports(reporter_id,subject_id,target_type,post_id,comment_id,reason,state,created_at)
    VALUES (?,?,?,?,?,?, 'pending',?)`);
  const contentReportQueue = db.prepare(`SELECT r.id,r.target_type AS targetType,r.post_id AS postId,r.comment_id AS commentId,
      r.reason,r.created_at AS createdAt,p.account_id AS subjectId,p.name AS subjectName,substr(r.reporter_id,1,8) AS reporterRef,
      substr(CASE WHEN r.target_type='post' THEN post.body ELSE comment.body END,1,240) AS excerpt
    FROM researcher_content_reports r JOIN researcher_profiles p ON p.account_id=r.subject_id
    LEFT JOIN researcher_posts post ON post.id=r.post_id LEFT JOIN researcher_post_comments comment ON comment.id=r.comment_id
    WHERE r.state='pending' ORDER BY r.created_at,r.id LIMIT 100`);
  const resolveContentReport = db.prepare(`UPDATE researcher_content_reports SET state=?,reviewed_by=?,reviewed_at=?
    WHERE id=? AND state='pending' RETURNING target_type AS targetType,post_id AS postId,comment_id AS commentId`);
  const pendingReportsForPost = db.prepare("SELECT id FROM researcher_content_reports WHERE post_id=? AND state='pending'");
  const pendingReportsForComment = db.prepare("SELECT id FROM researcher_content_reports WHERE comment_id=? AND state='pending'");
  const resolveOtherContentReport = db.prepare("UPDATE researcher_content_reports SET state='actioned',reviewed_by=?,reviewed_at=? WHERE id=? AND state='pending'");
  const hidePost = db.prepare("UPDATE researcher_posts SET state='hidden' WHERE id=? AND state='visible'");
  const hideComment = db.prepare("UPDATE researcher_post_comments SET state='hidden' WHERE id=? AND state='visible'");
  const recordContentModeration = db.prepare('INSERT INTO researcher_content_moderation_events(report_id,reviewer_id,action,created_at) VALUES (?,?,?,?)');
  const contentModerationEvents = db.prepare('SELECT report_id AS reportId,reviewer_id AS reviewerId,action,created_at AS createdAt FROM researcher_content_moderation_events ORDER BY id DESC LIMIT 100');

  function consumeContentSlot(owner,timestamp) {
    const cutoff=timestamp-3_600_000;
    pruneContentEvents.run(owner,cutoff);
    if(contentEventCount.get(owner,cutoff).total>=20)return false;
    addContentEvent.run(owner,timestamp);
    return true;
  }

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
    reports: () => [
      ...reportQueue.all().map((item) => ({ ...item, reportType: 'profile' })),
      ...contentReportQueue.all().map((item) => ({ ...item, reportType: 'content' })),
    ].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).slice(0, 100),
    moderationEvents: () => moderationEvents.all(),
    contentModerationEvents: () => contentModerationEvents.all(),
    posts: (owner) => visiblePosts.all(owner, owner, owner, owner),
    comments: (owner, postId) => Number.isSafeInteger(postId) && postVisible.get(postId, owner, owner, owner)
      ? visibleComments.all(postId, owner, owner, owner) : [],
    publishPost(owner, body) {
      const text = typeof body === 'string' ? body.trim() : '';
      if (!text || text.length > 2000) return false;
      return transact(db, () => profile.get(owner)?.discoverable === 1 && consumeContentSlot(owner, now())
        && addPost.run(owner, text, now()).changes === 1);
    },
    comment(owner, postId, body) {
      const text = typeof body === 'string' ? body.trim() : '';
      if (!text || text.length > 1000 || !Number.isSafeInteger(postId)) return false;
      return transact(db, () => !!profile.get(owner)?.discoverable && !!postVisible.get(postId, owner, owner, owner)
        && consumeContentSlot(owner, now()) && addComment.run(postId, owner, text, now()).changes === 1);
    },
    react(owner, postId, reaction) {
      if (!Number.isSafeInteger(postId) || !['like','insightful','support'].includes(reaction)) return false;
      return transact(db, () => {
        if (!profile.get(owner)?.discoverable || !postVisible.get(postId, owner, owner, owner) || !consumeContentSlot(owner, now())) return false;
        const existing = db.prepare('SELECT 1 FROM researcher_post_reactions WHERE post_id=? AND account_id=? AND reaction=?').get(postId, owner, reaction);
        if (existing) return removeReaction.run(postId, owner, reaction).changes === 1;
        return addReaction.run(postId, owner, reaction, now()).changes === 1;
      });
    },
    reportContent(owner, targetType, targetId, reason) {
      if (!Number.isSafeInteger(targetId) || !['post','comment'].includes(targetType)
        || !['spam','impersonation','harassment','other'].includes(reason)) return false;
      return transact(db, () => {
        const timestamp=now(), cutoff=timestamp-86_400_000;
        if (!profile.get(owner)?.discoverable || contentReportsToday.get(owner,cutoff).total>=5) return false;
        const targetRow=getTarget.get(targetType==='post'?targetId:-1,targetType==='comment'?targetId:-1);
        if (!targetRow || targetRow.subjectId===owner || !postVisible.get(targetRow.postId,owner,owner,owner)
          || pendingContentReport.get(owner,targetType,targetId,targetType,targetId)) return false;
        if (!consumeContentSlot(owner,timestamp)) return false;
        return addContentReport.run(owner,targetRow.subjectId,targetType,targetType==='post'?targetId:null,
          targetType==='comment'?targetId:null,reason,timestamp).changes===1;
      });
    },
    reviewContentReport(reviewer, reportId, decision) {
      if (!Number.isSafeInteger(reportId) || !['actioned','dismissed'].includes(decision)) return false;
      return transact(db, () => {
        const timestamp=now();
        const result=resolveContentReport.get(decision,reviewer,timestamp,reportId);
        if (!result) return false;
        if (decision==='actioned') {
          if (result.targetType==='post') {
            hidePost.run(result.postId);
            for (const { id } of pendingReportsForPost.all(result.postId)) {
              resolveOtherContentReport.run(reviewer,timestamp,id);
              recordContentModeration.run(id,reviewer,'actioned',timestamp);
            }
          } else {
            hideComment.run(result.commentId);
            for (const { id } of pendingReportsForComment.all(result.commentId)) {
              resolveOtherContentReport.run(reviewer,timestamp,id);
              recordContentModeration.run(id,reviewer,'actioned',timestamp);
            }
          }
        }
        recordContentModeration.run(reportId,reviewer,decision,timestamp);
        return true;
      });
    },
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
