import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createSandboxBillingAdapter } from '../src/billing-sandbox.js';
import { totp } from '../src/mfa.js';
import { createApp } from '../src/server.js';
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

test('billing reviewers with MFA can read sandbox records without gaining operator or research access', async (t) => {
  const timestamp = Date.UTC(2026, 10, 27);
  const store = openWorkspaceStore(':memory:', () => timestamp);
  const credential = { salt: Buffer.alloc(16), hash: Buffer.alloc(32) };
  const create = (name) => {
    const email = name + '@billing.test';
    store.addAccount(email, credential);
    const { id } = store.credentials(email);
    return { id, session: store.newSession(id) };
  };
  const reviewer = create('reviewer');
  const researcher = create('researcher');
  const project = store.createProject(researcher.id, { title: 'Synthetic private research', description: '' });
  store.billing.setReviewer(reviewer.id, true);

  const app = createApp(store, { enforceEntitlements: true });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const request = (user, path, method) => fetch(origin + path, {
    method, redirect: 'manual', headers: { cookie: 'nri_session=' + user.session, origin },
  });
  const path = '/control-center/billing';
  assert.equal((await request(reviewer, path)).status, 403);
  assert.equal(store.mfa.begin(reviewer.id), true);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...store.mfa.pending(reviewer.id)].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
  const seed = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  assert.equal(store.mfa.confirm(reviewer.id, totp(seed, timestamp / 30_000), reviewer.session).length, 8);

  const body = Buffer.from(JSON.stringify({
    id: 'fixture_invoice_issued', kind: 'invoice.issued', objectId: 'fixture_invoice',
    amountMinor: 1234, currency: 'EUR', occurredAt: timestamp,
  }));
  const key = Buffer.alloc(32, 43);
  const signature = createHmac('sha256', key).update(String(timestamp) + '.').update(body).digest('hex');
  assert.deepEqual(store.billing.accept(createSandboxBillingAdapter('sandbox-fixture', key),
    { body, signature, timestamp }), { status: 'accepted' });
  const response = await request(reviewer, path + '?lang=en');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /Invoice issued.*fixture_invoice/);
  assert.doesNotMatch(html, /Synthetic private research/);
  assert.equal((await request(researcher, path)).status, 403);
  assert.equal((await request(reviewer, '/control-center')).status, 403);
  assert.equal((await request(reviewer, path, 'POST')).status, 405);
  assert.equal((await request(reviewer, '/workspace/projects/' + project)).status, 403);
  assert.equal((await request(reviewer, path + '?page=oops')).status, 422);
  assert.match(await (await request(reviewer, path + '?lang=ar')).text(), /صدرت فاتورة/);
  store.billing.setReviewer(reviewer.id, false);
  assert.equal((await request(reviewer, path)).status, 403);
});
