import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { allowsRoute } from '../src/entitlements.js';
import { totp } from '../src/mfa.js';
import { hashPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('strict mode requires explicit grants and preserves account and resource authorization', { timeout: 10_000 }, async (t) => {
  let now = Date.UTC(2026, 10, 27);
  const store = openWorkspaceStore(':memory:', () => now);
  const password = 'Synthetic entitlement operator password';
  const credentials = await hashPassword(password);
  const users = Array.from({ length: 3 }, (_, i) => {
    const email = 'fixture-' + i + '@entitlements.test';
    store.addAccount(email, credentials);
    const { id } = store.credentials(email);
    const token = store.newSession(id);
    return { email, id, token, cookie: 'nri_session=' + token };
  });
  const [operator, researcher, other] = users;
  const project = store.createProject(researcher.id, { title: 'Private fixture', description: '' });
  const otherProject = store.createProject(other.id, { title: 'Other private fixture', description: '' });
  store.licensing.setOperator(operator.id, true);
  store.mfa.begin(operator.id);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...store.mfa.pending(operator.id)].map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
  const seed = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  store.mfa.confirm(operator.id, totp(seed, Math.floor(now / 30_000)), operator.token);
  assert.equal(store.licensing.save(operator.id, 'fixture', 10, 1000), 303);
  assert.equal(store.licensing.assign(operator.id, researcher.email, 'fixture', now + 60_000), 303);

  let finish;
  let rendererStarted;
  const started = new Promise((resolve) => { rendererStarted = resolve; });
  const renderReport = () => new Promise((resolve) => {
    finish = resolve;
    rendererStarted();
  });
  const app = createApp(store, { enforceEntitlements: true, reportRenderer: renderReport });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const request = (user, path, { method = 'GET', fields, source = origin } = {}) => fetch(origin + path, {
    method, redirect: 'manual', headers: { cookie: user?.cookie ?? '', ...(fields && { origin: source }) },
    ...(fields && { body: new URLSearchParams(fields) }),
  });
  const target = '/workspace/projects/' + project;
  const consolePath = '/control-center?lang=en';
  const planUpdate = (actor, previous, modules, source) => request(actor, consolePath, {
    method: 'POST', source, fields: [['intent', 'modules'], ['plan', 'fixture'], ['previous', previous],
      ['password', password], ...modules.map((module) => ['module', module])],
  });
  assert.equal(allowsRoute(store.licensing, operator.id, 'unregistered'), false);
  assert.equal((await request(undefined, target)).status, 303);
  assert.equal((await request(other, target)).status, 403);
  assert.equal((await request(researcher, target, { method: 'HEAD' })).status, 403);
  assert.equal((await request(researcher, '/', {})).status, 403);
  assert.equal((await request(researcher, '/workspace/settings/privacy')).status, 200);
  assert.equal((await request(researcher, consolePath)).status, 403);
  assert.equal((await planUpdate(researcher, '', [2])).status, 403);
  assert.equal((await planUpdate(operator, '', [2], 'https://foreign.test')).status, 403);
  assert.equal((await planUpdate(operator, '', [16])).status, 422);
  assert.equal((await planUpdate(operator, '', [2, 4, 5, 6, 15])).status, 303);
  assert.equal((await planUpdate(operator, '', [2])).status, 409);
  assert.equal((await request(researcher, target)).status, 200);
  assert.equal((await request(researcher, '/workspace/projects/' + otherProject)).status, 404);
  assert.equal((await request(researcher, target + '/documents')).status, 403);
  assert.equal((await request(researcher, target + '/shared-resources')).status, 403);
  assert.equal((await request(researcher, target + '/references')).status, 200);
  assert.equal((await request(researcher, '/workspace/assistant')).status, 403);

  const report = request(researcher, target + '/reports', { method: 'POST', fields: { format: 'pdf' } });
  await started;
  try {
    assert.equal((await planUpdate(operator, '2,4,5,6,15', [2])).status, 303);
  } finally {
    finish(Buffer.from('Synthetic private report'));
  }
  const denied = await report;
  assert.equal(denied.status, 404);
  assert.doesNotMatch(await denied.text(), /Synthetic private report/);
  assert.equal((await request(researcher, target + '/reports')).status, 403);
  assert.equal((await request(researcher, target)).status, 200);
  now += 60_000;
  assert.equal((await request(researcher, target)).status, 403);
  assert.equal((await request(researcher, '/workspace/settings')).status, 200);
  assert.equal(store.getProject(researcher.id, project).title, 'Private fixture');
  assert.equal(store.licensing.dashboard(operator.id).recent[0].action, 'modules:2');
});
