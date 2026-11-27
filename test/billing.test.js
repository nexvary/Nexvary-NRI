import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createSandboxBillingAdapter } from '../src/billing-sandbox.js';
import { openWorkspaceStore } from '../src/store.js';

test('sandbox billing verifies original bytes and deduplicates normalized events by provider', (t) => {
  const timestamp = Date.UTC(2026, 10, 27);
  const key = Buffer.alloc(32, 42);
  const store = openWorkspaceStore(':memory:', () => timestamp);
  t.after(() => store.close());
  const adapter = createSandboxBillingAdapter('sandbox-a', key);
  const second = createSandboxBillingAdapter('sandbox-b', key);
  const event = {
    id: 'fixture_event', kind: 'payment.recorded', objectId: 'fixture_payment',
    occurredAt: timestamp, amountMinor: 1234, currency: 'EUR',
  };
  const sign = (value, time = timestamp) => {
    const body = Buffer.from(JSON.stringify(value));
    const signature = createHmac('sha256', key).update(String(time) + '.').update(body).digest('hex');
    return { body, signature, timestamp: time };
  };
  const signed = sign(event);
  assert.deepEqual(store.billing.accept(adapter, null), { status: 'invalid-event' });
  assert.deepEqual(store.billing.accept(adapter, { ...signed, body: Buffer.concat([signed.body, Buffer.from(' ')]) }),
    { status: 'invalid-event' });
  assert.deepEqual(store.billing.accept(adapter, sign(event, timestamp - 300_001)), { status: 'invalid-event' });
  assert.deepEqual(store.billing.accept(adapter, sign({ ...event, amountMinor: -1 })), { status: 'invalid-event' });
  assert.deepEqual(store.billing.accept({ ...adapter, mode: 'live' }, signed), { status: 'invalid-adapter' });
  assert.deepEqual(store.billing.accept(adapter, signed), { status: 'accepted' });
  assert.deepEqual(store.billing.accept(adapter, sign({ currency: event.currency, ...event })), { status: 'duplicate' });
  assert.deepEqual(store.billing.accept(adapter, sign({ ...event, amountMinor: 1235 })), { status: 'conflict' });
  assert.deepEqual(store.billing.accept(second, signed), { status: 'accepted' });
  assert.deepEqual(store.billing.accept(adapter, signed), { status: 'duplicate' });
});
