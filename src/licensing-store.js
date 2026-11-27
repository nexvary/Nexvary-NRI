import { configurableModules } from './entitlements.js';

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

export const quotaSchema = `
  CREATE TABLE IF NOT EXISTS license_plan_quotas (
    code TEXT PRIMARY KEY REFERENCES license_plans(code) ON DELETE CASCADE,
    storage_mib INTEGER CHECK(storage_mib BETWEEN 0 AND 1048576),
    daily_reports INTEGER CHECK(daily_reports BETWEEN 0 AND 10000)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS report_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS report_reservations_account ON report_reservations(account_id,day);
  CREATE INDEX IF NOT EXISTS report_reservations_day ON report_reservations(day);
  PRAGMA user_version = 26;
`;

export const subscriptionSchema = `
  ALTER TABLE license_assignments ADD COLUMN state TEXT NOT NULL DEFAULT 'active'
    CHECK(state IN ('trial','active','grace','past_due','expired','suspended','cancelled','revoked'));
  PRAGMA user_version = 30;
`;

export const moduleEntitlementSchema = `
  CREATE TABLE IF NOT EXISTS license_plan_modules (
    plan TEXT NOT NULL REFERENCES license_plans(code) ON DELETE CASCADE,
    module INTEGER NOT NULL CHECK(module BETWEEN 1 AND 15),
    PRIMARY KEY(plan,module)
  ) STRICT;
  PRAGMA user_version = 32;
`;

export const institutionalSeatSchema = `
  CREATE TABLE IF NOT EXISTS license_plan_seats (
    code TEXT PRIMARY KEY REFERENCES license_plans(code) ON DELETE CASCADE,
    institutional_seats INTEGER CHECK(institutional_seats BETWEEN 1 AND 10000)
  ) STRICT;
  PRAGMA user_version = 33;
`;

export const institutionalSubscriptionSchema = `
  CREATE TABLE IF NOT EXISTS license_organizations (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS license_organization_subscriptions (
    organization TEXT PRIMARY KEY REFERENCES license_organizations(code),
    plan TEXT NOT NULL REFERENCES license_plans(code),
    expires_at INTEGER,
    state TEXT NOT NULL CHECK(state IN ('trial','active','grace','past_due','expired','suspended','cancelled','revoked'))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS license_organization_members (
    organization TEXT NOT NULL REFERENCES license_organizations(code),
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY(organization,account_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS license_organization_seats (
    organization TEXT NOT NULL,
    account_id TEXT PRIMARY KEY,
    FOREIGN KEY(organization,account_id) REFERENCES license_organization_members(organization,account_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS license_seats_organization ON license_organization_seats(organization);
  CREATE TABLE IF NOT EXISTS license_institutional_events (
    id INTEGER PRIMARY KEY,
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    organization TEXT NOT NULL REFERENCES license_organizations(code),
    subject TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  ) STRICT;
  PRAGMA user_version = 34;
`;

export const planPricingSchema = `
  CREATE TABLE IF NOT EXISTS license_plan_prices (
    plan TEXT PRIMARY KEY REFERENCES license_plans(code) ON DELETE CASCADE,
    currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]'),
    monthly_minor INTEGER CHECK(monthly_minor BETWEEN 0 AND 9999999999),
    annual_minor INTEGER CHECK(annual_minor BETWEEN 0 AND 9999999999),
    CHECK(monthly_minor IS NOT NULL OR annual_minor IS NOT NULL)
  ) STRICT;
  PRAGMA user_version = 35;
`;

const currencies = new Set(Intl.supportedValuesOf('currency'));
export const lifecycleScheduleSchema = `
  CREATE INDEX IF NOT EXISTS license_assignment_expiry
    ON license_assignments(expires_at);
  CREATE INDEX IF NOT EXISTS license_institution_expiry
    ON license_organization_subscriptions(expires_at) WHERE state IN ('trial','active','grace');
  PRAGMA user_version = 38;
`;

const subscriptionTransitions = Object.freeze({
  trial: ['active', 'expired', 'suspended', 'cancelled', 'revoked'],
  active: ['grace', 'past_due', 'expired', 'suspended', 'cancelled', 'revoked'],
  grace: ['active', 'past_due', 'expired', 'suspended', 'cancelled', 'revoked'],
  past_due: ['active', 'grace', 'expired', 'suspended', 'cancelled', 'revoked'],
  expired: ['active', 'cancelled', 'revoked'],
  suspended: ['active', 'cancelled', 'revoked'],
  cancelled: ['revoked'],
  revoked: [],
});

const usableStates = new Set(['trial', 'active', 'grace']);

const dayMs = 86_400_000;
const optionalLimit = (value, max) => value === null || (Number.isInteger(value) && value >= 0 && value <= max);

export function licensingStore(db, now, transact) {
  const isOperator = db.prepare('SELECT 1 FROM license_operators WHERE account_id = ?');
  const authorized = db.prepare(`SELECT 1 FROM license_operators o JOIN account_mfa m ON m.account_id=o.account_id
    WHERE o.account_id = ? AND m.pending_until = 0`);
  const grant = db.prepare('INSERT OR IGNORE INTO license_operators VALUES (?)');
  const revoke = db.prepare('DELETE FROM license_operators WHERE account_id = ?');
  const plans = db.prepare(`SELECT p.*,q.storage_mib,q.daily_reports,s.institutional_seats,price.currency,price.monthly_minor,price.annual_minor
    FROM license_plans p LEFT JOIN license_plan_quotas q ON q.code=p.code
    LEFT JOIN license_plan_seats s ON s.code=p.code
    LEFT JOIN license_plan_prices price ON price.plan=p.code ORDER BY p.code`);
  const plan = db.prepare('SELECT * FROM license_plans WHERE code = ?');
  const save = db.prepare(`INSERT INTO license_plans VALUES (?,?,?)
    ON CONFLICT(code) DO UPDATE SET project_limit=excluded.project_limit,daily_ai_tokens=excluded.daily_ai_tokens`);
  const savePrice = db.prepare(`INSERT INTO license_plan_prices VALUES (?,?,?,?)
    ON CONFLICT(plan) DO UPDATE SET currency=excluded.currency,
      monthly_minor=excluded.monthly_minor,annual_minor=excluded.annual_minor`);
  const clearPrice = db.prepare('DELETE FROM license_plan_prices WHERE plan=?');
  const lookup = db.prepare('SELECT id FROM accounts WHERE email = ?');
  const individual = db.prepare('SELECT plan,state,expires_at FROM license_assignments WHERE account_id = ?');
  const effectiveAssignment = `
    SELECT plan,state,expires_at FROM license_assignments WHERE account_id = :account
    UNION ALL
    SELECT s.plan,s.state,s.expires_at FROM license_organization_subscriptions s
    JOIN license_organization_seats seats ON seats.organization=s.organization
    JOIN license_organization_members m ON m.organization=seats.organization AND m.account_id=seats.account_id
    WHERE seats.account_id=:account AND NOT EXISTS (SELECT 1 FROM license_assignments WHERE account_id=:account)
  `;
  const entitlement = db.prepare(`SELECT p.code,p.project_limit,p.daily_ai_tokens,a.expires_at,a.state,q.storage_mib,q.daily_reports
    FROM (${effectiveAssignment}) a JOIN license_plans p ON p.code=a.plan
    LEFT JOIN license_plan_quotas q ON q.code=a.plan`);
  const assign = db.prepare(`INSERT INTO license_assignments(account_id,plan,expires_at,state) VALUES (?,?,?,'active')
    ON CONFLICT(account_id) DO UPDATE SET plan=excluded.plan,expires_at=excluded.expires_at`);
  const events = db.prepare('SELECT actor,subject,plan,action,recorded_at FROM license_events ORDER BY id DESC LIMIT 50');
  const record = db.prepare('INSERT INTO license_events(actor,subject,plan,action,recorded_at) VALUES (?,?,?,?,?)');
  const metrics = db.prepare(`SELECT (SELECT count(*) FROM accounts) AS accounts,
    (SELECT count(*) FROM projects) AS projects,
    (SELECT count(*) FROM license_assignments WHERE state IN ('trial','active','grace') AND (expires_at IS NULL OR expires_at > ?)) AS active`);
  const ownedProjects = db.prepare('SELECT count(*) AS total FROM projects WHERE owner_id = ?');
  const saveQuotas = db.prepare(`INSERT INTO license_plan_quotas VALUES (?,?,?)
    ON CONFLICT(code) DO UPDATE SET storage_mib=excluded.storage_mib,daily_reports=excluded.daily_reports`);
  const saveSeats = db.prepare(`INSERT INTO license_plan_seats VALUES (?,?)
    ON CONFLICT(code) DO UPDATE SET institutional_seats=excluded.institutional_seats`);
  const bytes = db.prepare(`SELECT COALESCE(SUM(v.size),0) AS total FROM document_versions v
    JOIN documents d ON d.id=v.document_id JOIN projects p ON p.id=d.project_id WHERE p.owner_id=?`);
  const reports = db.prepare('SELECT count(*) AS total FROM report_reservations WHERE account_id=? AND day=?');
  const reserve = db.prepare('INSERT INTO report_reservations(account_id,day) VALUES (?,?)');
  const release = db.prepare('DELETE FROM report_reservations WHERE id=? AND account_id=?');
  const prune = db.prepare('DELETE FROM report_reservations WHERE day<?');
  const subscriptions = db.prepare(`SELECT a.email,s.plan,s.state,s.expires_at FROM license_assignments s
    JOIN accounts a ON a.id=s.account_id ORDER BY a.email LIMIT 50`);
  const accountModules = db.prepare(`SELECT a.state,a.expires_at,m.module FROM (${effectiveAssignment}) a
    LEFT JOIN license_plan_modules m ON m.plan=a.plan`);
  const organization = db.prepare('SELECT 1 FROM license_organizations WHERE code=?');
  const createOrganization = db.prepare('INSERT OR IGNORE INTO license_organizations VALUES (?,?)');
  const organizationSubscription = db.prepare(`SELECT a.*,p.institutional_seats FROM license_organization_subscriptions a
    LEFT JOIN license_plan_seats p ON p.code=a.plan WHERE a.organization=?`);
  const organizationList = db.prepare(`SELECT o.code,o.name,s.plan,s.state,s.expires_at,p.institutional_seats,
    (SELECT count(*) FROM license_organization_seats WHERE organization=o.code) AS seats
    FROM license_organizations o LEFT JOIN license_organization_subscriptions s ON s.organization=o.code
    LEFT JOIN license_plan_seats p ON p.code=s.plan ORDER BY o.code LIMIT 100`);
  const institutionPlan = db.prepare('SELECT institutional_seats FROM license_plan_seats WHERE code=?');
  const insertInstitutionalSubscription = db.prepare(`INSERT INTO license_organization_subscriptions VALUES (?,?,?,?)
    ON CONFLICT(organization) DO UPDATE SET plan=excluded.plan,expires_at=excluded.expires_at`);
  const setInstitutionalState = db.prepare('UPDATE license_organization_subscriptions SET state=?,expires_at=? WHERE organization=?');
  const member = db.prepare('SELECT 1 FROM license_organization_members WHERE organization=? AND account_id=?');
  const addMember = db.prepare('INSERT OR IGNORE INTO license_organization_members VALUES (?,?)');
  const removeMember = db.prepare('DELETE FROM license_organization_members WHERE organization=? AND account_id=?');
  const allocateSeat = db.prepare('INSERT OR IGNORE INTO license_organization_seats VALUES (?,?)');
  const revokeSeat = db.prepare('DELETE FROM license_organization_seats WHERE organization=? AND account_id=?');
  const seatCount = db.prepare('SELECT count(*) AS total FROM license_organization_seats WHERE organization=?');
  const maxSeatsInUse = db.prepare(`SELECT COALESCE(MAX(total),0) AS total FROM (
    SELECT count(*) AS total FROM license_organization_seats seats
    JOIN license_organization_subscriptions s USING(organization) WHERE s.plan=? GROUP BY seats.organization
  )`);
  const institutionalAudit = db.prepare(`INSERT INTO license_institutional_events
    (actor,organization,subject,action,recorded_at) VALUES (?,?,?,?,?)`);
  const institutionalHistory = db.prepare('SELECT * FROM license_institutional_events ORDER BY id DESC LIMIT 50');
  const planModules = db.prepare('SELECT module FROM license_plan_modules WHERE plan=? ORDER BY module');
  const clearModules = db.prepare('DELETE FROM license_plan_modules WHERE plan=?');
  const addModule = db.prepare('INSERT INTO license_plan_modules VALUES (?,?)');
  const updateSubscription = db.prepare('UPDATE license_assignments SET state=?,expires_at=? WHERE account_id=?');
  const dueAccounts = db.prepare(`SELECT account_id,plan,state,expires_at FROM license_assignments
    WHERE state IN ('trial','active','grace') AND expires_at<=? ORDER BY expires_at,account_id LIMIT 500`);
  const dueInstitutions = db.prepare(`SELECT organization,state,expires_at FROM license_organization_subscriptions
    WHERE state IN ('trial','active','grace') AND expires_at<=? ORDER BY expires_at,organization LIMIT 500`);
  const accountExpiry = db.prepare(`SELECT state,expires_at FROM (${effectiveAssignment})`);

  function stateAt(current, timestamp) {
    if (usableStates.has(current.state) && current.expires_at !== null && current.expires_at <= timestamp) return 'expired';
    return current.state;
  }

  function validateTransition(current, expected, next, expiresAt, timestamp) {
    if (!current || !Object.hasOwn(subscriptionTransitions, expected) || !Object.hasOwn(subscriptionTransitions, next)) return 422;
    const previous = stateAt(current, timestamp);
    if (previous !== expected || !subscriptionTransitions[previous].includes(next)) return 409;
    if ((expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= timestamp || !usableStates.has(next))) ||
        (next === 'grace' && expiresAt === null)) return 422;
    return 303;
  }

  function limits(account) {
    const current = entitlement.get({ account });
    if (!current) return { projectLimit: Infinity, aiTokens: Infinity, storage: Infinity, reports: Infinity };
    if (!usableStates.has(stateAt(current, now()))) return { projectLimit: 0, aiTokens: 0, storage: 0, reports: 0 };
    return { projectLimit: current.project_limit, aiTokens: current.daily_ai_tokens,
      storage: (current.storage_mib ?? Infinity) * 1024 * 1024, reports: current.daily_reports ?? Infinity };
  }

  return {
    allowsModules(account, required) {
      if (required.length === 0) return true;
      const rows = accountModules.all({ account });
      if (!rows.length || !usableStates.has(stateAt(rows[0], now()))) return false;
      const granted = new Set(rows.map(({ module }) => module));
      return required.every((module) => granted.has(module));
    },
    saveModules(actor, code, modules, previous) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        if (!plan.get(code) || modules.length > configurableModules.length ||
            modules.some((module) => !configurableModules.includes(module)) ||
            new Set(modules).size !== modules.length) return 422;
        if (planModules.all(code).map(({ module }) => module).join(',') !== previous) return 409;
        clearModules.run(code);
        for (const module of modules) addModule.run(code, module);
        record.run(actor, null, code, 'modules:' + [...modules].sort((a, b) => a - b).join(','), now());
        return 303;
      });
    },
    isOperator: (owner) => Boolean(isOperator.get(owner)),
    setOperator(owner, enabled) {
      return enabled ? grant.run(owner) : revoke.run(owner);
    },
    dashboard(actor) {
      if (!authorized.get(actor)) return undefined;
      const timestamp = now();
      return { plans: plans.all().map((plan) => ({ ...plan, modules: planModules.all(plan.code).map(({ module }) => module) })), metrics: metrics.get(timestamp), recent: events.all(),
        organizations: organizationList.all().map((current) => ({ ...current, state: stateAt(current, timestamp) })),
        institutionalHistory: institutionalHistory.all(), subscriptions: subscriptions.all().map((current) => ({ ...current, state: stateAt(current, timestamp) })) };
    },
    save(actor, code, projectLimit, aiTokens, storage = null, dailyReports = null, institutionalSeats = null) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        if (!/^[a-z][a-z0-9-]{1,30}$/.test(code) || !Number.isInteger(projectLimit) || projectLimit < 0 || projectLimit > 10000 ||
            !Number.isInteger(aiTokens) || aiTokens < 0 || aiTokens > 1_000_000_000 ||
            !optionalLimit(storage,1048576) || !optionalLimit(dailyReports,10000) ||
            !optionalLimit(institutionalSeats,10000) || institutionalSeats === 0) return 422;
        if ((institutionalSeats ?? 0) < maxSeatsInUse.get(code).total) return 409;
        save.run(code, projectLimit, aiTokens);
        saveQuotas.run(code, storage, dailyReports);
        saveSeats.run(code, institutionalSeats);
        record.run(actor, null, code, 'plan-saved', now());
        return 303;
      });
    },
    setPricing(actor, code, currency, monthly, annual) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        if (!plan.get(code)) return 422;
        if (currency === '' && monthly === null && annual === null) {
          if (clearPrice.run(code).changes) record.run(actor, null, code, 'pricing-cleared', now());
          return 303;
        }
        if (!currencies.has(currency) || (monthly === null && annual === null) ||
            !optionalLimit(monthly, 9_999_999_999) || !optionalLimit(annual, 9_999_999_999)) return 422;
        savePrice.run(code, currency, monthly, annual);
        record.run(actor, null, code, 'pricing-saved', now());
        return 303;
      });
    },
    assign(actor, email, code, expiresAt, initialState = 'active') {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const account = lookup.get(email);
        if (!account || !plan.get(code) || (expiresAt !== null && !Number.isSafeInteger(expiresAt))) return 422;
        const timestamp = now();
        if (initialState !== 'active' && (initialState !== 'trial' || expiresAt === null || expiresAt <= timestamp)) return 422;
        const current = individual.get(account.id);
        if (current && (stateAt(current, timestamp) !== 'active' || initialState !== 'active')) return 409;
        assign.run(account.id, code, expiresAt);
        if (initialState === 'trial') updateSubscription.run('trial', expiresAt, account.id);
        record.run(actor, account.id, code, initialState === 'trial' ? 'trial-started' : 'assigned', timestamp);
        return 303;
      });
    },
    transition(actor, email, expected, next, expiresAt) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const account = lookup.get(email);
        const current = account && individual.get(account.id);
        const timestamp = now();
        const status = validateTransition(current, expected, next, expiresAt, timestamp);
        if (status !== 303) return status;
        updateSubscription.run(next, expiresAt, account.id);
        record.run(actor, account.id, current.plan, `subscription:${expected}:${next}`, timestamp);
        return 303;
      });
    },
    createOrganization(actor, code, name) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        if (!/^[a-z][a-z0-9-]{1,30}$/.test(code) || !name || name.length > 100) return 422;
        if (!createOrganization.run(code, name).changes) return 409;
        institutionalAudit.run(actor, code, null, 'organization-created', now());
        return 303;
      });
    },
    assignInstitution(actor, code, planCode, expiresAt, initialState) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const seats = institutionPlan.get(planCode)?.institutional_seats;
        const timestamp = now();
        if (!organization.get(code) || !seats || (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= timestamp)) ||
            (initialState !== 'active' && (initialState !== 'trial' || expiresAt === null))) return 422;
        const current = organizationSubscription.get(code);
        if ((current && (stateAt(current, timestamp) !== 'active' || initialState !== 'active')) ||
            seatCount.get(code).total > seats) return 409;
        insertInstitutionalSubscription.run(code, planCode, expiresAt, initialState);
        institutionalAudit.run(actor, code, null, 'subscription:' + initialState + ':' + planCode, timestamp);
        return 303;
      });
    },
    transitionInstitution(actor, code, expected, next, expiresAt) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const current = organizationSubscription.get(code);
        const timestamp = now();
        const status = validateTransition(current, expected, next, expiresAt, timestamp);
        if (status !== 303) return status;
        setInstitutionalState.run(next, expiresAt, code);
        institutionalAudit.run(actor, code, null, 'subscription:' + expected + ':' + next, timestamp);
        return 303;
      });
    },
    changeInstitutionMember(actor, code, email, add) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const account = lookup.get(email);
        if (!organization.get(code) || !account) return 422;
        const operation = add ? addMember : removeMember;
        if (!operation.run(code, account.id).changes) return 409;
        institutionalAudit.run(actor, code, account.id, add ? 'member-added' : 'member-removed', now());
        return 303;
      });
    },
    changeInstitutionSeat(actor, code, email, allocate) {
      return transact(db, () => {
        if (!authorized.get(actor)) return 403;
        const account = lookup.get(email);
        if (!account || !member.get(code, account.id)) return 422;
        const timestamp = now();
        if (allocate) {
          const current = organizationSubscription.get(code);
          if (!current?.institutional_seats || !usableStates.has(stateAt(current, timestamp)) ||
              seatCount.get(code).total >= current.institutional_seats) return 409;
        }
        const operation = allocate ? allocateSeat : revokeSeat;
        if (!operation.run(code, account.id).changes) return 409;
        institutionalAudit.run(actor, code, account.id, allocate ? 'seat-allocated' : 'seat-revoked', timestamp);
        return 303;
      });
    },
    reconcileExpirations() {
      return transact(db, () => {
        const timestamp = now();
        const accounts = dueAccounts.all(timestamp);
        const organizations = dueInstitutions.all(timestamp);
        for (const current of accounts) {
          updateSubscription.run('expired', current.expires_at, current.account_id);
          record.run(null, current.account_id, current.plan, 'expiry:' + current.state + ':expired', timestamp);
        }
        for (const current of organizations) {
          setInstitutionalState.run('expired', current.expires_at, current.organization);
          institutionalAudit.run(null, current.organization, null, 'expiry:' + current.state + ':expired', timestamp);
        }
        return { accounts: accounts.length, organizations: organizations.length };
      });
    },
    renewalNotice(account) {
      const current = accountExpiry.get({ account });
      if (!current || current.expires_at === null) return undefined;
      const timestamp = now();
      const state = stateAt(current, timestamp);
      if (state === 'expired') return { expired: true, at: current.expires_at };
      if (usableStates.has(state) && current.expires_at <= timestamp + 7 * dayMs) {
        return { expired: false, at: current.expires_at };
      }
      return undefined;
    },
    canDeliverReport(owner) {
      return limits(owner).reports > 0;
    },
    canCreateProject(owner) {
      return ownedProjects.get(owner).total < limits(owner).projectLimit;
    },
    canStore(owner, amount) {
      const maximum = limits(owner).storage;
      return maximum > 0 && (maximum === Infinity || bytes.get(owner).total + amount <= maximum);
    },
    reserveReport(owner) {
      return transact(db, () => {
        const day = Math.floor(now() / dayMs);
        if (reports.get(owner,day).total >= limits(owner).reports) return undefined;
        prune.run(day - 89);
        return reserve.run(owner,day).lastInsertRowid;
      });
    },
    releaseReport(owner, id) {
      release.run(id,owner);
    },
    aiTokens(owner) {
      return limits(owner).aiTokens;
    },
  };
}

export async function renderLicensedReport(licensing, actor, render, authorized) {
  const reservation = licensing.reserveReport(actor);
  if (reservation === undefined) return { status:429 };
  let delivered = false;
  try {
    const file = await render();
    if (!authorized()) return { status:404 };
    if (!licensing.canDeliverReport(actor)) return { status:429 };
    delivered = true;
    return { status:200,file };
  } catch {
    return { status:503 };
  } finally {
    if (!delivered) licensing.releaseReport(actor,reservation);
  }
}
