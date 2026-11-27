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
  if (!Number.isSafeInteger(event.amountMinor) || event.amountMinor < 0 ||
      typeof event.currency !== 'string' || !/^[A-Z]{3}$/.test(event.currency)) return undefined;
  return { ...fields, amountMinor: event.amountMinor, currency: event.currency };
}

export function billingStore(db, now, transact) {
  const add = db.prepare(`
    INSERT INTO billing_events VALUES (?,?,?,?)
    ON CONFLICT(provider,event_id) DO NOTHING
  `);
  const existing = db.prepare('SELECT payload FROM billing_events WHERE provider=? AND event_id=?');

  const authorized = db.prepare(`SELECT 1 FROM account_mfa m WHERE m.account_id=:account AND m.pending_until=0
    AND (EXISTS(SELECT 1 FROM license_operators WHERE account_id=:account)
      OR EXISTS(SELECT 1 FROM control_center_roles WHERE account_id=:account AND role='billing'))`);
  const grantBilling = db.prepare("INSERT OR IGNORE INTO control_center_roles VALUES (?, 'billing')");
  const revokeBilling = db.prepare("DELETE FROM control_center_roles WHERE account_id=? AND role='billing'");
  const records = db.prepare(`SELECT provider,payload,recorded_at FROM billing_events
    ORDER BY recorded_at DESC,provider,event_id LIMIT 51 OFFSET ?`);
  return {
    canReview: (account) => Boolean(authorized.get({ account })),
    setReviewer(account, enabled) {
      return (enabled ? grantBilling : revokeBilling).run(account);
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
        if (add.run(adapter.provider, event.id, payload, timestamp).changes === 1) return { status: 'accepted' };
        const previous = existing.get(adapter.provider, event.id);
        return { status: previous.payload === payload ? 'duplicate' : 'conflict' };
      });
    },
  };
}
