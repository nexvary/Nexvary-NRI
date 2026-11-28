import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { totp } from '../src/mfa.js';
import { hashPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

function decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...value].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
}

test('supports optional MFA, one-use codes and session revocation on authentication changes', async (t) => {
  assert.equal(totp(Buffer.from('12345678901234567890'), 1), '287082');
  let now = 1_800_000_000_000;
  const store = openWorkspaceStore(':memory:', () => now);
  const email = 'mfa@example.test';
  const password = 'a long test password here';
  store.addAccount(email, await hashPassword(password));
  const { id } = store.credentials(email);
  const token = store.newSession(id);
  const extraToken = store.newSession(id);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const settings = '/workspace/settings/mfa?lang=en';
  const request = (path, user, fields) => fetch(origin + path, {
    redirect: 'manual',
    headers: { cookie: user ? 'nri_session=' + user : '', ...(fields ? { origin } : {}) },
    ...(fields ? { method: 'POST', body: new URLSearchParams(fields) } : {}),
  });
  const login = (code) => request('/login?lang=en', null, { email, password, ...(code ? { 'mfa-code': code } : {}) });
  const setup = (intent, code) => request(settings, token, { intent, password, ...(code ? { code } : {}) });
  assert.equal((await login()).status, 303);
  assert.equal((await request(settings, null)).status, 303);
  assert.equal((await setup('begin')).status, 303);
  const pending = await request(settings, token);
  assert.equal(pending.headers.get('cache-control'), 'no-store');
  const key = (await pending.text()).match(/mfa-setup-key">([A-Z2-7]{32})</)[1];
  const secret = decode(key);
  const first = totp(secret, Math.floor(now / 30_000));
  const confirmed = await setup('confirm', first);
  assert.equal(confirmed.status, 200);
  const html = await confirmed.text();
  const recovery = [...html.matchAll(/<code dir="ltr">([0-9A-F-]{19})<\/code>/g)].map((match) => match[1]);
  assert.equal(recovery.length, 8);
  assert.ok(store.session(token));
  assert.equal(store.session(extraToken), undefined);
  const enabled = await (await request(settings, token)).text();
  assert.doesNotMatch(enabled, new RegExp(key + '|' + recovery[0]));
  assert.equal((await login()).status, 401);
  assert.equal((await login(first)).status, 401);
  now += 30_000;
  const next = totp(secret, Math.floor(now / 30_000));
  assert.equal((await login(next)).status, 303);
  assert.equal((await login(next)).status, 401);
  assert.equal((await login(recovery[0])).status, 303);
  assert.equal((await login(recovery[0])).status, 401);
  assert.equal((await setup('disable', recovery[1])).status, 303);
  assert.equal(store.otherSessions(id, token), 0);
  assert.equal((await login()).status, 303);
});
