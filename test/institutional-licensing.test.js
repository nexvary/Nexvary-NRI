import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { totp } from '../src/mfa.js';
import { hashPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('institutional subscriptions require a seat and preserve ownership and data portability', { timeout: 12000 }, async (t) => {
  let now = Date.UTC(2026, 10, 27);
  const store = openWorkspaceStore(':memory:', () => now);
  const password = 'Synthetic institutional test password';
  const credentials = await hashPassword(password);
  const account = (name) => {
    const email = name + '@institution.test';
    store.addAccount(email, credentials);
    const { id } = store.credentials(email);
    const token = store.newSession(id);
    return { id, email, token };
  };
  const operator = account('operator');
  const first = account('first');
  const second = account('second');
  const outsider = account('outsider');
  const projectPath = (user) => '/workspace/projects/' + store.createProject(user.id, { title: user.email, description: '' });
  const paths = new Map([first, second, outsider].map((user) => [user, projectPath(user)]));
  const licensing = store.licensing;
  licensing.setOperator(operator.id, true);
  assert.equal(licensing.createOrganization(operator.id, 'research-center', 'Research Center'), 403);
  store.mfa.begin(operator.id);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...store.mfa.pending(operator.id)].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
  const seed = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  assert.equal(store.mfa.confirm(operator.id, totp(seed, now / 30_000), operator.token).length, 8);
  const app = createApp(store, { enforceEntitlements: true });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const control = '/control-center?lang=en';
  const code = 'research-center';
  const request = (user, path, fields, source = origin) => fetch(origin + path, {
    redirect: 'manual',
    headers: { cookie: 'nri_session=' + user.token, ...(fields && { origin: source }) },
    ...(fields && { method: 'POST', body: new URLSearchParams(fields) }),
  });
  const manage = (user, intent, fields = {}, source) =>
    request(user, control, { institution: code, password, intent, ...fields }, source);
  assert.equal((await manage(outsider, 'institution-create', { 'institution-name': 'Research Center' })).status, 403);
  assert.equal((await manage(operator, 'institution-create', { 'institution-name': 'Research Center' })).status, 303);
  assert.equal(licensing.save(operator.id, 'research', 1, 0, null, null, 1), 303);
  assert.equal(licensing.saveModules(operator.id, 'research', [2], ''), 303);
  assert.equal(licensing.dashboard(operator.id).plans[0].currency, null);
  const pricing = { plan: 'research', currency: 'eur', 'monthly-minor': '1200', 'annual-minor': '0' };
  assert.equal((await manage(first, 'pricing', pricing)).status, 403);
  assert.equal((await manage(operator, 'pricing', { ...pricing, password: 'Incorrect fixture password' })).status, 403);
  assert.equal((await manage(operator, 'pricing', { ...pricing, currency: 'ZZZ' })).status, 422);
  assert.equal((await manage(operator, 'pricing', pricing)).status, 303);
  const { currency, monthly_minor, annual_minor } = licensing.dashboard(operator.id).plans[0];
  assert.deepEqual([currency, monthly_minor, annual_minor], ['EUR', 1200, 0]);
  assert.equal(licensing.save(operator.id, 'research', 1, 0, null, null, 1), 303);
  assert.equal(licensing.dashboard(operator.id).plans[0].monthly_minor, 1200);
  assert.equal(licensing.setPricing(operator.id, 'research', '', null, null), 303);
  assert.equal(licensing.dashboard(operator.id).plans[0].currency, null);
  assert.equal(licensing.dashboard(operator.id).recent[0].action, 'pricing-cleared');
  const expire = now + 60_000;
  assert.equal(licensing.assignInstitution(operator.id, code, 'research', expire, 'trial'), 303);
  for (const user of [first, second]) {
    assert.equal(licensing.changeInstitutionMember(operator.id, code, user.email, true), 303);
    assert.equal((await request(user, paths.get(user))).status, 403);
  }
  assert.equal(licensing.changeInstitutionSeat(operator.id, code, outsider.email, true), 422);
  assert.equal((await manage(first, 'institution-seat-allocate', { email: first.email })).status, 403);
  assert.equal((await manage(operator, 'institution-seat-allocate', { email: first.email }, 'https://foreign.test')).status, 403);

  const candidates = [first, second];
  const results = await Promise.all(candidates.map((user) =>
    manage(operator, 'institution-seat-allocate', { email: user.email })));
  assert.deepEqual(results.map(({ status }) => status).sort(), [303, 409]);
  const winner = candidates[results.findIndex(({ status }) => status === 303)];
  const runnerUp = candidates.find((user) => user !== winner);
  assert.equal((await request(winner, paths.get(winner))).status, 200);
  assert.equal((await request(winner, paths.get(outsider))).status, 404);
  assert.equal((await request(winner, '/workspace', { title: 'Over quota' })).status, 429);
  assert.equal((await request(runnerUp, paths.get(runnerUp))).status, 403);
  assert.equal(licensing.save(operator.id, 'research', 1, 0, null, null, null), 409);

  assert.equal((await manage(operator, 'institution-seat-revoke', { email: winner.email })).status, 303);
  assert.equal((await request(winner, paths.get(winner))).status, 403);
  assert.equal(licensing.changeInstitutionSeat(operator.id, code, runnerUp.email, true), 303);
  assert.equal(licensing.changeInstitutionMember(operator.id, code, runnerUp.email, false), 303);
  assert.equal((await request(runnerUp, paths.get(runnerUp))).status, 403);
  assert.equal(licensing.changeInstitutionSeat(operator.id, code, winner.email, true), 303);
  now = expire;
  assert.equal((await request(winner, paths.get(winner))).status, 403);
  const exportReply = await request(winner, '/workspace/settings/privacy', { intent: 'export', password });
  assert.equal(exportReply.status, 200);
  const archive = await exportReply.text();
  assert.match(archive, new RegExp(winner.email));
  assert.equal(JSON.parse(archive).institutionalMemberships[0].has_seat, 1);
  assert.doesNotMatch(archive, new RegExp(outsider.email));
  assert.equal(licensing.transitionInstitution(operator.id, code, 'expired', 'active', null), 303);
  assert.equal((await request(winner, paths.get(winner))).status, 200);

  assert.equal(licensing.save(operator.id, 'personal', 5, 0), 303);
  assert.equal(licensing.assign(operator.id, winner.email, 'personal', null), 303);
  assert.equal((await request(winner, paths.get(winner))).status, 403);
  assert.equal(licensing.saveModules(operator.id, 'personal', [2], ''), 303);
  assert.equal((await request(winner, paths.get(winner))).status, 200);
  const dashboard = licensing.dashboard(operator.id);
  assert.equal(dashboard.organizations[0].seats, 1);
  assert.ok(dashboard.institutionalHistory.some(({ action }) => action === 'seat-revoked'));
  assert.ok(dashboard.institutionalHistory.some(({ action }) => action === 'subscription:expired:active'));
  assert.match(await (await request(operator, '/control-center?lang=ar')).text(), /المؤسسات والمقاعد/);
});
