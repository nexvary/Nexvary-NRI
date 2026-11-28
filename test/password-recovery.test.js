import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { totp } from '../src/mfa.js';
import { hashPassword, verifyPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

function decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...value].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
}

test('MFA recovery resets the password atomically, revokes sessions and records an audit event', async (t) => {
  let now = 1_800_000_000_000;
  const store = openWorkspaceStore(':memory:', () => now);
  const email = 'recover@example.test';
  const password = 'previous test password that is long';
  const replacement = 'replacement test password is also long';
  store.addAccount(email, await hashPassword(password));
  const owner = store.credentials(email).id;
  const current = store.newSession(owner);
  const other = store.newSession(owner);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const post = (path, fields, token) => fetch(origin + path, { method: 'POST', redirect: 'manual',
    headers: { origin, ...(token ? { cookie: `nri_session=${token}` } : {}) }, body: new URLSearchParams(fields) });
  const setup = async (intent, code) => post('/workspace/settings/mfa?lang=en', { intent, password, ...(code ? { code } : {}) }, current);
  assert.equal((await setup('begin')).status, 303);
  const setupPage = await fetch(origin + '/workspace/settings/mfa?lang=en', { headers: { cookie: `nri_session=${current}` } });
  const key = (await setupPage.text()).match(/mfa-setup-key">([A-Z2-7]{32})</)[1];
  const secret = decode(key);
  const setupCode = totp(secret, Math.floor(now / 30_000));
  const confirmation = await setup('confirm', setupCode);
  const recoveryCode = (await confirmation.text()).match(/<code dir="ltr">([0-9A-F-]{19})<\/code>/)[1];
  const recovery = await post('/recover?lang=en', { email, code: recoveryCode, password: replacement });
  assert.equal(recovery.status, 200);
  assert.match(await recovery.text(), /existing sessions revoked/);
  assert.equal(store.session(current), undefined);
  assert.equal(store.session(other), undefined);
  assert.equal(store.settings.list(owner)[0].action, 'password-reset');
  assert.equal(await verifyPassword(password, store.credentials(email)), false);
  assert.equal(await verifyPassword(replacement, store.credentials(email)), true);
});

test('self-service recovery rejects accounts without MFA and keeps failures indistinguishable', async (t) => {
  const store = openWorkspaceStore();
  const password = 'known existing password for account';
  store.addAccount('plain@example.test', await hashPassword(password));
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const result = await fetch(origin + '/recover?lang=ar', { method: 'POST', redirect: 'manual', headers: { origin },
    body: new URLSearchParams({ email: 'plain@example.test', code: '123456', password: 'replacement password long enough' }) });
  assert.equal(result.status, 200);
  assert.match(await result.text(), /التحقق بخطوتين/);
  assert.equal(await verifyPassword(password, store.credentials('plain@example.test')), true);
  assert.deepEqual(store.settings.list(store.credentials('plain@example.test').id), []);
});
