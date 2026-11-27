export const licenseSchema = `
  CREATE TABLE IF NOT EXISTS license_operators (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS license_plans (
    code TEXT PRIMARY KEY,
    project_limit INTEGER NOT NULL CHECK(project_limit BETWEEN 0 AND 10000),
    daily_ai_tokens INTEGER NOT NULL CHECK(daily_ai_tokens BETWEEN 0 AND 1000000000)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS license_assignments (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    plan TEXT NOT NULL REFERENCES license_plans(code),
    expires_at INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS license_events (
    id INTEGER PRIMARY KEY,
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    subject TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    plan TEXT NOT NULL REFERENCES license_plans(code),
    action TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  ) STRICT;
  PRAGMA user_version = 19;
`;

export function licensingStore(db, now, transact) {
  const isOperator = db.prepare('SELECT 1 FROM license_operators WHERE account_id = ?');
  const authorized = db.prepare(`SELECT 1 FROM license_operators o JOIN account_mfa m ON m.account_id=o.account_id
    WHERE o.account_id = ? AND m.pending_until = 0`);
  const grant = db.prepare('INSERT OR IGNORE INTO license_operators VALUES (?)');
  const revoke = db.prepare('DELETE FROM license_operators WHERE account_id = ?');
  const plans = db.prepare('SELECT * FROM license_plans ORDER BY code');
  const plan = db.prepare('SELECT * FROM license_plans WHERE code = ?');
  const save = db.prepare(`INSERT INTO license_plans VALUES (?,?,?)
    ON CONFLICT(code) DO UPDATE SET project_limit=excluded.project_limit,daily_ai_tokens=excluded.daily_ai_tokens`);
  const lookup = db.prepare('SELECT id FROM accounts WHERE email = ?');
  const entitlement = db.prepare(`SELECT p.code,p.project_limit,p.daily_ai_tokens,a.expires_at
    FROM license_assignments a JOIN license_plans p ON p.code=a.plan WHERE a.account_id = ?`);
  const assign = db.prepare(`INSERT INTO license_assignments VALUES (?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET plan=excluded.plan,expires_at=excluded.expires_at`);
  const events = db.prepare('SELECT actor,subject,plan,action,recorded_at FROM license_events ORDER BY id DESC LIMIT 50');
  const record = db.prepare('INSERT INTO license_events(actor,subject,plan,action,recorded_at) VALUES (?,?,?,?,?)');
  const metrics = db.prepare(`SELECT (SELECT count(*) FROM accounts) AS accounts,
    (SELECT count(*) FROM projects) AS projects,
    (SELECT count(*) FROM license_assignments WHERE expires_at IS NULL OR expires_at > ?) AS active`);
  const ownedProjects = db.prepare('SELECT count(*) AS total FROM projects WHERE owner_id = ?');
  function limits(account) {
    const current = entitlement.get(account);
    if (!current) return { projectLimit: Infinity, aiTokens: Infinity };
    if (current.expires_at !== null && current.expires_at <= now()) return { projectLimit: 0, aiTokens: 0 };
    return { projectLimit: current.project_limit, aiTokens: current.daily_ai_tokens };
  }

  return {
    isOperator: (owner) => Boolean(isOperator.get(owner)),
    setOperator(owner, enabled) {
      return enabled ? grant.run(owner) : revoke.run(owner);
    },
    dashboard(actor) {
      if (!authorized.get(actor)) return undefined;
      return { plans: plans.all(), metrics: metrics.get(now()), recent: events.all() };
    },
    save(actor, code, projectLimit, aiTokens) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        if (!/^[a-z][a-z0-9-]{1,30}$/.test(code) || !Number.isInteger(projectLimit) || projectLimit < 0 || projectLimit > 10000 ||
            !Number.isInteger(aiTokens) || aiTokens < 0 || aiTokens > 1_000_000_000) return 422;
        save.run(code, projectLimit, aiTokens);
        record.run(actor, null, code, 'plan-saved', now());
        return 303;
      });
    },
    assign(actor, email, code, expiresAt) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const account = lookup.get(email);
        if (!account || !plan.get(code) || (expiresAt !== null && !Number.isSafeInteger(expiresAt))) return 422;
        assign.run(account.id, code, expiresAt);
        record.run(actor, account.id, code, 'assigned', now());
        return 303;
      });
    },
    canCreateProject(owner) {
      return ownedProjects.get(owner).total < limits(owner).projectLimit;
    },
    aiTokens(owner) {
      return limits(owner).aiTokens;
    },
  };
}
