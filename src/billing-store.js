export const billingSchema = `
  CREATE TABLE IF NOT EXISTS billing_events (
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY(provider, event_id)
  ) STRICT;
  PRAGMA user_version = 31;
`;

export const billingAccessSchema = `
  CREATE TABLE IF NOT EXISTS control_center_roles (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role = 'billing'),
    PRIMARY KEY(account_id,role)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS billing_events_recent ON billing_events(recorded_at DESC,provider,event_id);
  PRAGMA user_version = 36;
`;

export const billingReconciliationSchema = `
  CREATE TABLE IF NOT EXISTS billing_invoices (
    provider TEXT NOT NULL, invoice TEXT NOT NULL, event_id TEXT NOT NULL,
    currency TEXT NOT NULL, total INTEGER NOT NULL CHECK(total>=0), issued_at INTEGER NOT NULL,
    PRIMARY KEY(provider,invoice), UNIQUE(provider,event_id),
    FOREIGN KEY(provider,event_id) REFERENCES billing_events(provider,event_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS billing_invoice_lines (
    provider TEXT NOT NULL, invoice TEXT NOT NULL, line INTEGER NOT NULL,
    description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
    unit_minor INTEGER NOT NULL CHECK(unit_minor>=0),
    PRIMARY KEY(provider,invoice,line),
    FOREIGN KEY(provider,invoice) REFERENCES billing_invoices(provider,invoice)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS billing_movements (
    provider TEXT NOT NULL, movement TEXT NOT NULL, event_id TEXT NOT NULL,
    invoice TEXT NOT NULL, payment TEXT, amount INTEGER NOT NULL CHECK(amount>0),
    PRIMARY KEY(provider,movement), UNIQUE(provider,event_id),
    FOREIGN KEY(provider,invoice) REFERENCES billing_invoices(provider,invoice),
    FOREIGN KEY(provider,event_id) REFERENCES billing_events(provider,event_id),
    FOREIGN KEY(provider,payment) REFERENCES billing_movements(provider,movement)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS billing_movements_invoice ON billing_movements(provider,invoice);
  CREATE INDEX IF NOT EXISTS billing_movements_payment ON billing_movements(provider,payment);
  INSERT OR IGNORE INTO billing_invoices
    SELECT provider,json_extract(payload,'$.objectId'),event_id,json_extract(payload,'$.currency'),
      json_extract(payload,'$.amountMinor'),json_extract(payload,'$.occurredAt')
    FROM billing_events WHERE json_extract(payload,'$.kind')='invoice.issued'
    ORDER BY recorded_at,event_id;
  INSERT OR IGNORE INTO billing_invoice_lines
    SELECT provider,invoice,1,'',1,total FROM billing_invoices;
  PRAGMA user_version = 37;
`;

export const billingDiscountSchema = `
  CREATE TABLE IF NOT EXISTS billing_discounts (
    code TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
    value INTEGER NOT NULL CHECK(value>0), currency TEXT,
    plan TEXT REFERENCES license_plans(code), expires_at INTEGER NOT NULL,
    redemption_limit INTEGER NOT NULL CHECK(redemption_limit>0), revoked_at INTEGER,
    CHECK((kind='percent' AND currency IS NULL AND value<=10000) OR (kind='fixed' AND currency IS NOT NULL))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS billing_discount_events (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL REFERENCES billing_discounts(code),
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK(action IN ('created','revoked')), recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS billing_discount_redemptions (
    provider TEXT NOT NULL, invoice TEXT NOT NULL, code TEXT NOT NULL REFERENCES billing_discounts(code),
    plan TEXT NOT NULL REFERENCES license_plans(code), amount INTEGER NOT NULL CHECK(amount>0),
    redeemed_at INTEGER NOT NULL,
    PRIMARY KEY(provider,invoice),
    FOREIGN KEY(provider,invoice) REFERENCES billing_invoices(provider,invoice)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS billing_redemption_code ON billing_discount_redemptions(code);
  PRAGMA user_version = 39;
`;

const discountCode = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const planCode = /^[a-z][a-z0-9-]{1,30}$/;
const currencies = new Set(Intl.supportedValuesOf('currency'));
const validAmount = (amount) => Number.isSafeInteger(amount) && amount >= 0;
const eventKinds = new Set([
  'invoice.issued', 'payment.recorded', 'payment.refunded', 'subscription.renewed', 'subscription.cancelled',
]);
const providerCode = /^[a-z][a-z0-9-]{1,30}$/;
const externalId = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || !eventKinds.has(event.kind) ||
      typeof event.id !== 'string' || !externalId.test(event.id) ||
      typeof event.objectId !== 'string' || !externalId.test(event.objectId) ||
      !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) return undefined;

  const fields = { id: event.id, kind: event.kind, objectId: event.objectId, occurredAt: event.occurredAt };
  if (event.kind === 'subscription.cancelled') return fields;
  if (event.kind === 'subscription.renewed') {
    if (!['monthly', 'annual'].includes(event.cycle)) return undefined;
    return { ...fields, cycle: event.cycle };
  }
  if (!validAmount(event.amountMinor) || !currencies.has(event.currency)) return undefined;
  const money = { ...fields, amountMinor: event.amountMinor, currency: event.currency };
  if (event.discountCode !== undefined) {
    if (event.kind !== 'invoice.issued' || typeof event.discountCode !== 'string' || !discountCode.test(event.discountCode) ||
        typeof event.planCode !== 'string' || !planCode.test(event.planCode)) return undefined;
    Object.assign(money, { discountCode: event.discountCode, planCode: event.planCode });
  }
  if (event.kind === 'invoice.issued' && event.lines !== undefined) {
    if (!Array.isArray(event.lines) || !event.lines.length || event.lines.length > 50) return undefined;
    let total = 0;
    const lines = [];
    for (const line of event.lines) {
      if (!line || typeof line.description !== 'string' || !line.description.trim() || line.description.length > 200 ||
          !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000 || !validAmount(line.unitMinor)) return undefined;
      total += line.quantity * line.unitMinor;
      if (!validAmount(total)) return undefined;
      lines.push({ description: line.description.trim(), quantity: line.quantity, unitMinor: line.unitMinor });
    }
    return total === event.amountMinor ? { ...money, lines } : undefined;
  }
  if (event.kind === 'payment.recorded' && event.invoiceId !== undefined) {
    return event.amountMinor && typeof event.invoiceId === 'string' && externalId.test(event.invoiceId)
      ? { ...money, invoiceId: event.invoiceId } : undefined;
  }
  if (event.kind === 'payment.refunded' && event.paymentId !== undefined) {
    return event.amountMinor && typeof event.paymentId === 'string' && externalId.test(event.paymentId)
      ? { ...money, paymentId: event.paymentId } : undefined;
  }
  return money;
}

export function billingStore(db, now, transact) {
  const add = db.prepare(`
    INSERT INTO billing_events VALUES (?,?,?,?)
  `);
  const existing = db.prepare('SELECT payload FROM billing_events WHERE provider=? AND event_id=?');

  const authorized = db.prepare(`SELECT 1 FROM account_mfa m WHERE m.account_id=:account AND m.pending_until=0
    AND (EXISTS(SELECT 1 FROM license_operators WHERE account_id=:account)
      OR EXISTS(SELECT 1 FROM control_center_roles WHERE account_id=:account AND role='billing'))`);
  const grantBilling = db.prepare("INSERT OR IGNORE INTO control_center_roles VALUES (?, 'billing')");
  const revokeBilling = db.prepare("DELETE FROM control_center_roles WHERE account_id=? AND role='billing'");
  const records = db.prepare(`SELECT provider,payload,recorded_at FROM billing_events
    ORDER BY recorded_at DESC,provider,event_id LIMIT 51 OFFSET ?`);
  const findInvoice = db.prepare(`SELECT i.*, i.total - COALESCE((
    SELECT SUM(CASE WHEN payment IS NULL THEN amount ELSE -amount END ORDER BY m.rowid)
    FROM billing_movements m WHERE m.provider=i.provider AND m.invoice=i.invoice
  ),0) AS outstanding FROM billing_invoices i WHERE provider=? AND invoice=?`);
  const insertInvoice = db.prepare('INSERT INTO billing_invoices VALUES (?,?,?,?,?,?)');
  const insertLine = db.prepare('INSERT INTO billing_invoice_lines VALUES (?,?,?,?,?,?)');
  const lines = db.prepare('SELECT description,quantity,unit_minor FROM billing_invoice_lines WHERE provider=? AND invoice=? ORDER BY line');
  const findMovement = db.prepare('SELECT * FROM billing_movements WHERE provider=? AND movement=?');
  const refunded = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM billing_movements WHERE provider=? AND payment=?');
  const insertMovement = db.prepare('INSERT INTO billing_movements VALUES (?,?,?,?,?,?)');

  const discountManager = db.prepare(`SELECT 1 FROM account_mfa m JOIN license_operators o ON o.account_id=m.account_id
    WHERE m.account_id=? AND m.pending_until=0`);
  const plans = db.prepare('SELECT 1 FROM license_plans WHERE code=?');
  const discounts = db.prepare(`SELECT d.*, (SELECT count(*) FROM billing_discount_redemptions r WHERE r.code=d.code) AS redeemed
    FROM billing_discounts d ORDER BY d.code LIMIT 100`);
  const findDiscount = db.prepare(`SELECT d.*, (SELECT count(*) FROM billing_discount_redemptions r WHERE r.code=d.code) AS redeemed
    FROM billing_discounts d WHERE d.code=?`);
  const addDiscount = db.prepare('INSERT OR IGNORE INTO billing_discounts VALUES (?,?,?,?,?,?,?,NULL)');
  const revokeDiscount = db.prepare('UPDATE billing_discounts SET revoked_at=? WHERE code=? AND revoked_at IS NULL');
  const auditDiscount = db.prepare('INSERT INTO billing_discount_events(code,actor,action,recorded_at) VALUES (?,?,?,?)');
  const redeem = db.prepare('INSERT INTO billing_discount_redemptions VALUES (?,?,?,?,?,?)');
  const redemption = db.prepare('SELECT code,amount,plan FROM billing_discount_redemptions WHERE provider=? AND invoice=?');

  function invoiceDiscount(event, timestamp) {
    const discount = findDiscount.get(event.discountCode);
    if (!discount || !plans.get(event.planCode) || discount.revoked_at !== null || discount.expires_at <= timestamp ||
        discount.redeemed >= discount.redemption_limit || (discount.plan && discount.plan !== event.planCode)) return 0;
    if (discount.kind === 'fixed') return discount.currency === event.currency ? Math.min(discount.value, event.amountMinor) : 0;
    return Number(BigInt(event.amountMinor) * BigInt(discount.value) / 10000n);
  }

  function reconcile(provider, event, timestamp) {
    if (event.kind === 'invoice.issued') {
      if (findInvoice.get(provider, event.objectId)) return 'conflict';
      const reduction = event.discountCode ? invoiceDiscount(event, timestamp) : 0;
      if (event.discountCode && !reduction) return 'discount-unavailable';
      return () => {
        insertInvoice.run(provider, event.objectId, event.id, event.currency, event.amountMinor - reduction, event.occurredAt);
        const items = event.lines ?? [{ description: '', quantity: 1, unitMinor: event.amountMinor }];
        items.forEach((line, index) => insertLine.run(provider, event.objectId, index + 1, line.description, line.quantity, line.unitMinor));
        if (reduction) redeem.run(provider, event.objectId, event.discountCode, event.planCode, reduction, timestamp);
      };
    }
    if (!event.invoiceId && !event.paymentId) return () => {};
    if (findMovement.get(provider, event.objectId)) return 'conflict';
    const payment = event.paymentId && findMovement.get(provider, event.paymentId);
    if (event.paymentId && !payment) return 'unmatched';
    if (payment?.payment) return 'conflict';
    const invoice = findInvoice.get(provider, payment?.invoice ?? event.invoiceId);
    if (!invoice) return 'unmatched';
    const available = payment ? payment.amount - refunded.get(provider, event.paymentId).total : invoice.outstanding;
    if (invoice.currency !== event.currency || event.amountMinor > available) return 'conflict';
    return () => insertMovement.run(provider, event.objectId, event.id, invoice.invoice, event.paymentId ?? null, event.amountMinor);
  }
  return {
    canReview: (account) => Boolean(authorized.get({ account })),
    setReviewer(account, enabled) {
      return (enabled ? grantBilling : revokeBilling).run(account);
    },
    discounts(account) {
      return discountManager.get(account) ? discounts.all() : [];
    },
    createDiscount(account, { code, kind, value, currency, plan, expires, limit }) {
      return transact(db, () => {
        if (!discountManager.get(account)) return 403;
        const timestamp = now();
        if (!discountCode.test(code) || !['percent', 'fixed'].includes(kind) || !validAmount(value) || value < 1 ||
            !Number.isSafeInteger(expires) || expires <= timestamp || !Number.isInteger(limit) || limit < 1 || limit > 10000 ||
            (plan && !plans.get(plan)) ||
            (kind === 'percent' ? currency || value > 10000 : !currencies.has(currency))) return 422;
        if (!addDiscount.run(code, kind, value, currency || null, plan || null, expires, limit).changes) return 409;
        auditDiscount.run(code, account, 'created', timestamp);
        return 303;
      });
    },
    revokeDiscount(account, code) {
      return transact(db, () => {
        if (!discountManager.get(account)) return 403;
        const timestamp = now();
        if (!revokeDiscount.run(timestamp, code).changes) return 409;
        auditDiscount.run(code, account, 'revoked', timestamp);
        return 303;
      });
    },
    invoice(account, provider, id) {
      if (!authorized.get({ account })) return undefined;
      const invoice = findInvoice.get(provider, id);
      return invoice && { ...invoice, lines: lines.all(provider, id), discount: redemption.get(provider, id) };
    },
    records(account, offset) {
      if (!authorized.get({ account })) return undefined;
      return records.all(offset).map(({ provider, payload, recorded_at }) => ({
        ...JSON.parse(payload), provider, recordedAt: recorded_at,
      }));
    },
    // An injected sandbox adapter verifies the original bytes and returns a provider-neutral event.
    accept(adapter, envelope) {
      if (adapter?.mode !== 'sandbox' || typeof adapter.provider !== 'string' ||
          !providerCode.test(adapter.provider) || typeof adapter.verify !== 'function') return { status: 'invalid-adapter' };
      const timestamp = now();
      const event = normalizeEvent(adapter.verify(envelope, timestamp));
      if (!event) return { status: 'invalid-event' };
      const payload = JSON.stringify(event);
      return transact(db, () => {
        const previous = existing.get(adapter.provider, event.id);
        if (previous) return { status: previous.payload === payload ? 'duplicate' : 'conflict' };
        const apply = reconcile(adapter.provider, event, timestamp);
        if (typeof apply !== 'function') return { status: apply };
        add.run(adapter.provider, event.id, payload, timestamp);
        apply();
        return { status: 'accepted' };
      });
    },
  };
}
