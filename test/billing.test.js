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

  const key = Buffer.alloc(32, 43);
  const adapter = createSandboxBillingAdapter('sandbox-fixture', key);
  const accept = (id, kind, objectId, amountMinor, extra = {}, currency = 'EUR') => {
    const body = Buffer.from(JSON.stringify({ id, kind, objectId, amountMinor, currency, occurredAt: timestamp, ...extra }));
    const signature = createHmac('sha256', key).update(String(timestamp) + '.').update(body).digest('hex');
    return store.billing.accept(adapter, { body, signature, timestamp }).status;
  };
  const invoiceLink = { invoiceId: 'fixture_invoice' };
  assert.equal(accept('pay_1', 'payment.recorded', 'payment_one', 1000, invoiceLink), 'unmatched');
  const lineItems = { lines: [{ description: 'Synthetic research subscription', quantity: 2, unitMinor: 617 }] };
  assert.equal(accept('bad_invoice', 'invoice.issued', 'fixture_invoice', 1233, lineItems), 'invalid-event');
  assert.equal(accept('invoice_1', 'invoice.issued', 'fixture_invoice', 1234, lineItems), 'accepted');
  assert.equal(accept('invoice_2', 'invoice.issued', 'fixture_invoice', 1234, lineItems), 'conflict');
  assert.equal(accept('pay_1', 'payment.recorded', 'payment_one', 1000, invoiceLink), 'accepted');
  assert.equal(accept('pay_1', 'payment.recorded', 'payment_one', 1000, invoiceLink), 'duplicate');
  assert.equal(accept('pay_again', 'payment.recorded', 'payment_one', 1000, invoiceLink), 'conflict');
  assert.equal(store.billing.invoice(reviewer.id, adapter.provider, 'fixture_invoice').outstanding, 234);
  assert.equal(accept('pay_over', 'payment.recorded', 'payment_over', 235, invoiceLink), 'conflict');
  assert.equal(accept('pay_usd', 'payment.recorded', 'payment_usd', 234, invoiceLink, 'USD'), 'conflict');
  assert.equal(accept('pay_2', 'payment.recorded', 'payment_two', 234, invoiceLink), 'accepted');
  assert.equal(store.billing.invoice(reviewer.id, adapter.provider, 'fixture_invoice').outstanding, 0);
  assert.equal(accept('refund_over', 'payment.refunded', 'refund_over', 235, { paymentId: 'payment_two' }), 'conflict');
  assert.equal(accept('refund_1', 'payment.refunded', 'refund_one', 125, { paymentId: 'payment_two' }), 'accepted');
  assert.equal(accept('refund_2', 'payment.refunded', 'refund_two', 110, { paymentId: 'payment_two' }), 'conflict');
  assert.equal(store.billing.invoice(reviewer.id, adapter.provider, 'fixture_invoice').outstanding, 125);
  const response = await request(reviewer, path + '?lang=en');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /Invoice issued[\s\S]*fixture_invoice/);
  assert.match(html, /Commercial analytics/);
  assert.doesNotMatch(html, /Synthetic private research/);
  assert.equal((await request(researcher, path)).status, 403);
  assert.equal((await request(reviewer, '/control-center')).status, 403);
  assert.equal((await request(reviewer, path, 'POST')).status, 405);
  assert.equal((await request(reviewer, '/workspace/projects/' + project)).status, 403);
  assert.equal((await request(reviewer, path + '?page=oops')).status, 422);
  assert.match(await (await request(reviewer, path + '?lang=ar')).text(), /صدرت فاتورة/);
  const invoice = path + '?provider=sandbox-fixture&invoice=fixture_invoice';
  assert.match(await (await request(reviewer, invoice + '&lang=en')).text(), /Outstanding · 125 EUR/);
  assert.match(await (await request(reviewer, invoice + '&lang=ar')).text(), /المبلغ المستحق/);
  assert.equal((await request(researcher, invoice + '&format=pdf')).status, 403);
  if (process.env.NRI_REPORT_PYTHON) {
    const pdf = await request(reviewer, invoice + '&format=pdf&lang=ar');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }
  const promo = { code: 'RESEARCH10', kind: 'percent', value: 1000, currency: '', plan: 'research',
    expires: timestamp + 60_000, limit: 1 };
  assert.equal(store.billing.createDiscount(reviewer.id, promo), 403);
  store.licensing.setOperator(reviewer.id, true);
  assert.equal(store.licensing.save(reviewer.id, 'research', 10, 0), 303);
  assert.equal(store.licensing.save(reviewer.id, 'other-plan', 10, 0), 303);
  assert.equal(store.billing.createDiscount(reviewer.id, { ...promo, expires: timestamp }), 422);
  assert.equal(store.billing.createDiscount(reviewer.id, promo), 303);
  const usePromo = { discountCode: promo.code, planCode: promo.plan };
  assert.equal(accept('wrong_plan', 'invoice.issued', 'wrong_plan', 1234, { ...usePromo, planCode: 'other-plan' }),
    'discount-unavailable');
  assert.equal(accept('discount_1', 'invoice.issued', 'discounted_invoice', 1234, usePromo), 'accepted');
  assert.equal(accept('discount_1', 'invoice.issued', 'discounted_invoice', 1234, usePromo), 'duplicate');
  assert.equal(accept('discount_2', 'invoice.issued', 'second_discounted_invoice', 1234, usePromo), 'discount-unavailable');
  const discounted = store.billing.invoice(reviewer.id, adapter.provider, 'discounted_invoice');
  assert.equal(discounted.total, 1111);
  assert.equal(discounted.discount.amount, 123);
  assert.equal(store.billing.discounts(reviewer.id)[0].redeemed, 1);
  assert.equal(store.billing.createDiscount(reviewer.id, { ...promo, code: 'FIXED', kind: 'fixed', value: 250, currency: 'EUR' }), 303);
  const useFixed = { ...usePromo, discountCode: 'FIXED' };
  assert.equal(accept('bad_currency', 'invoice.issued', 'bad_currency', 100, useFixed, 'USD'), 'discount-unavailable');
  assert.equal(accept('fixed_1', 'invoice.issued', 'fixed_invoice', 100, useFixed), 'accepted');
  assert.equal(store.billing.invoice(reviewer.id, adapter.provider, 'fixed_invoice').outstanding, 0);
  assert.equal(store.billing.revokeDiscount(reviewer.id, 'FIXED'), 303);
  assert.equal(accept('fixed_revoked', 'invoice.issued', 'fixed_revoked', 100, useFixed), 'discount-unavailable');
  const analyticsPath = '/control-center/analytics?lang=en';
  const analyticsResponse = await request(reviewer, analyticsPath);
  assert.equal(analyticsResponse.status, 200);
  assert.equal(analyticsResponse.headers.get('cache-control'), 'no-store');
  const analytics = await analyticsResponse.text();
  assert.match(analytics, /Invoices 3\s+· Invoiced 2,345 EUR minor units\s+·\s+Payments recorded 1,234 EUR minor units\s+·\s+Refunds recorded 125 EUR minor units/);
  assert.match(analytics, /Redemptions · 2/);
  assert.equal((await request(researcher, analyticsPath)).status, 403);
  assert.equal((await request(reviewer, analyticsPath, 'POST')).status, 405);
  const arabicAnalytics = await (await request(reviewer, '/control-center/analytics?lang=ar')).text();
  assert.match(arabicAnalytics, /التحليلات التجارية[\s\S]*الفواتير والحركات المسجلة/);
  store.licensing.setOperator(reviewer.id, false);
  const support = '/control-center/support?email=researcher%40billing.test&lang=en';
  const security = '/control-center/security?email=researcher%40billing.test&lang=ar';
  assert.equal((await request(reviewer, support)).status, 403);
  assert.equal((await request(reviewer, security)).status, 403);
  store.operations.setReviewer(researcher.id, 'support', true);
  assert.equal((await request(researcher, support)).status, 403);
  store.operations.setReviewer(reviewer.id, 'support', true);
  const supportPage = await request(reviewer, support);
  assert.equal(supportPage.status, 200);
  assert.equal(supportPage.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await supportPage.text(), /Synthetic private research|Active sessions/);
  assert.equal((await request(reviewer, security)).status, 403);
  store.operations.setReviewer(reviewer.id, 'support', false);
  store.operations.setReviewer(reviewer.id, 'security', true);
  const securityPage = await request(reviewer, security);
  assert.equal(securityPage.status, 200);
  assert.match(await securityPage.text(), /الجلسات النشطة/);
  assert.equal((await request(reviewer, support)).status, 403);
  assert.equal((await request(reviewer, security, 'POST')).status, 405);
  assert.equal((await request(reviewer, '/workspace/projects/' + project)).status, 403);
  store.operations.setReviewer(reviewer.id, 'security', false);
  assert.equal((await request(reviewer, security)).status, 403);
  store.billing.setReviewer(reviewer.id, false);
  assert.equal((await request(reviewer, path)).status, 403);
});
