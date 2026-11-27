import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { hashPassword } from '../src/password.js';
import { totp } from '../src/mfa.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('MFA-protected operator plans govern project capacity and external token reservations', async (t) => {
  let now = 1_800_000_000_000;
  const store = openWorkspaceStore(':memory:', () => now);
  const password = 'local fixture operator password';
  const operatorCredentials = await hashPassword(password);
  const [operator, researcher, trialResearcher] = ['operator', 'researcher', 'trial'].map((name) => {
    const email = name + '@plans.test';
    store.addAccount(email, name === 'operator' ? operatorCredentials : { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const { id } = store.credentials(email);
    const token = store.newSession(id);
    return { id, email, token, cookie: 'nri_session=' + token };
  });
  let renders = 0;
  const app = createApp(store,{reportRenderer:async () => {
    if (++renders === 1) throw new Error('Fixture failure');
    return Buffer.from('fixture report');
  }});
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const path = '/workspace/settings/licensing?lang=en';
  const request = (user, url, fields, source = origin) => fetch(origin + url, {
    redirect: 'manual', headers: { cookie: user?.cookie ?? '', ...(fields ? { origin: source } : {}) },
    ...(fields ? { method: 'POST', body: new URLSearchParams(fields) } : {}),
  });
  const setup = { intent: 'save', plan: 'research', 'project-limit': 1, 'ai-tokens': 1000, 'storage-mib': 1, 'daily-reports': 1 };
  const assign = { intent: 'assign', email: researcher.email, plan: 'research', expires: '2027-12-01' };
  assert.equal((await request(null, path)).headers.get('location'), '/login?lang=en');
  assert.equal((await request(operator, path, setup)).status, 403);
  store.licensing.setOperator(operator.id, true);
  assert.equal((await request(operator, path)).status, 403);
  store.mfa.begin(operator.id);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...store.mfa.pending(operator.id)].map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
  const secret = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  store.mfa.confirm(operator.id, totp(secret, now / 30_000), operator.token);
  assert.equal((await request(operator, path, setup, 'https://foreign.test')).status, 403);
  assert.equal((await request(operator, path, { ...setup, 'ai-tokens': '-1' })).status, 422);
  assert.equal((await request(operator, path, setup)).status, 303);
  assert.equal((await request(operator, path, { ...assign, expires: '2027-02-31' })).status, 422);
  assert.equal((await request(operator, path, assign)).status, 303);
  assert.equal((await request(researcher, path, assign)).status, 403);
  const dashboard = await request(operator, path);
  assert.equal(dashboard.headers.get('cache-control'), 'no-store');
  assert.match(await dashboard.text(), /Active assignments/);
  const project = await request(researcher, '/workspace?lang=en', { title: 'First' });
  assert.equal(project.status, 303);
  const denied = await request(researcher, '/workspace?lang=en', { title: 'Second' });
  assert.equal(denied.status, 429);
  assert.match(await denied.text(), /project limit/);
  assert.equal((await request(researcher, project.headers.get('location'))).status, 200);
  const projectPath = project.headers.get('location').split('?')[0];
  const projectId = projectPath.split('/').at(-1);
  const pdf = store.documents.create(researcher.id,projectId,{name:'First.pdf',bytes:Buffer.alloc(1024 * 1024)});
  assert.throws(() => store.documents.append(researcher.id,projectId,pdf,{name:'Second.pdf',bytes:Buffer.from('pdf')}),
    {code:'NRI_STORAGE_LIMIT'});
  assert.equal(store.documents.versions(researcher.id,projectId,pdf).length,1);
  const upload = new FormData();
  upload.set('pdf',new File(['%PDF-1.4\nfixture\n%%EOF\n'],'Second.pdf'));
  const deniedUpload = await fetch(origin + projectPath + '/documents/' + pdf + '?lang=en', {
    method:'POST',headers:{cookie:researcher.cookie,origin},body:upload,redirect:'manual',
  });
  assert.equal(deniedUpload.status,429);
  assert.match(await deniedUpload.text(),/PDF storage limit/);
  assert.ok(store.documents.delete(researcher.id,projectId,pdf));
  assert.ok(store.documents.create(researcher.id,projectId,{name:'Reclaimed.pdf',bytes:Buffer.from('pdf')}));
  const reportPath = projectPath + '/reports?lang=en';
  assert.equal((await request(researcher,reportPath,{format:'pdf'})).status,503);
  assert.equal((await request(researcher,reportPath,{format:'pdf'})).status,200);
  assert.equal((await request(researcher,reportPath,{format:'docx'})).status,429);
  assert.equal(renders,2);
  now += 86_400_000;
  const nextDay = store.licensing.reserveReport(researcher.id);
  assert.ok(nextDay);
  assert.equal(store.licensing.reserveReport(researcher.id),undefined);
  store.licensing.releaseReport(researcher.id,nextDay);
  now -= 86_400_000;
  const caps = { tokens: 5000, cost: 5000 };
  assert.ok(store.assistantUsage.reserve(researcher.id, 'test', { tokens: 900, cost: 100 }, caps));
  assert.equal(store.assistantUsage.reserve(researcher.id, 'test', { tokens: 101, cost: 1 }, caps), undefined);
  assert.equal(store.licensing.dashboard(operator.id).recent[0].subject, researcher.id);
  const change = (from, to, other = {}) => ({
    intent: 'transition', email: researcher.email, 'current-state': from, 'next-state': to, password, ...other,
  });
  assert.equal((await request(researcher, path, change('active', 'suspended'))).status, 403);
  assert.equal((await request(operator, path, change('active', 'suspended', { password: 'incorrect' }))).status, 403);
  assert.equal((await request(operator, path, change('active', 'grace'))).status, 422);
  assert.equal((await request(operator, path, change('active', 'suspended'))).status, 303);
  assert.equal((await request(operator, path, change('active', 'revoked'))).status, 409);
  assert.equal((await request(operator, path, assign)).status, 409);
  assert.equal((await request(researcher, project.headers.get('location'))).status, 200);
  assert.equal(store.licensing.aiTokens(researcher.id), 0);
  assert.equal(store.licensing.reserveReport(researcher.id), undefined);
  assert.equal(store.licensing.canStore(researcher.id, 0), false);
  assert.equal(store.licensing.dashboard(operator.id).recent[0].action, 'subscription:active:suspended');
  assert.equal((await request(operator, path, change('suspended', 'active', { expires: assign.expires }))).status, 303);
  assert.equal(store.licensing.aiTokens(researcher.id), 1000);

  const trial = { ...assign, intent: 'trial', email: trialResearcher.email, expires: '2027-11-01', password };
  assert.equal((await request(operator, path, trial)).status, 303);
  assert.equal(store.licensing.aiTokens(trialResearcher.id), 1000);
  assert.equal(store.licensing.dashboard(operator.id).subscriptions.find((item) => item.email === trial.email).state, 'trial');
  now = Date.UTC(2027, 10, 1);
  assert.equal(store.licensing.aiTokens(trialResearcher.id), 0);
  assert.equal(store.licensing.dashboard(operator.id).subscriptions.find((item) => item.email === trial.email).state, 'expired');
  operator.cookie = 'nri_session=' + store.newSession(operator.id);
  const revoked = await request(operator, path, change('expired', 'revoked', { email: trial.email }));
  assert.equal(revoked.status, 303);
  assert.equal(revoked.headers.get('location'), path);
  assert.equal(store.licensing.dashboard(operator.id).recent[0].action, 'subscription:expired:revoked');
  assert.equal((await request(operator, path, change('revoked', 'active', { email: trial.email }))).status, 409);
  now = Date.UTC(2027, 11, 1);
  assert.equal(store.licensing.aiTokens(researcher.id), 0);
  assert.equal(store.createProject(researcher.id, { title: 'Expired', description: '' }), undefined);
  store.licensing.setOperator(operator.id, false);
  assert.equal(store.licensing.dashboard(operator.id), undefined);
  const health = await request(null, '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  store.healthy = () => false;
  const unavailable = await request(null, '/healthz');
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
});
