import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';
import { hashPassword } from '../src/password.js';

test('revokes other sessions and audits the change within the signed-in account', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('settings-owner@example.test', credentials);
  store.addAccount('settings-other@example.test', credentials);
  const owner = store.credentials('settings-owner@example.test').id;
  const other = store.credentials('settings-other@example.test').id;
  const cookie = (id) => 'nri_session=' + store.newSession(id);
  const session = cookie(owner);
  const another = cookie(owner);
  const unrelated = cookie(other);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const settings = origin + '/workspace/settings?lang=en';
  const get = (cookie) => fetch(settings, { redirect: 'manual', headers: { cookie } });
  try {
    const before = await (await get(session)).text();
    assert.match(before, /Sign out other sessions/);
    const revoke = await fetch(settings, { method: 'POST', redirect: 'manual',
      headers: { origin, cookie: session }, body: new URLSearchParams({ intent: 'revoke-others' }) });
    assert.equal(revoke.status, 303);
    assert.equal((await get(another)).status, 303);
    assert.equal((await get(unrelated)).status, 200);
    assert.doesNotMatch(await (await get(unrelated)).text(), /Other sessions revoked/);
    const current = await get(session);
    assert.equal(current.status, 200);
    assert.match(await current.text(), /Other sessions revoked/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test('profile and light theme require current-password confirmation and are isolated', async () => {
  const store = openWorkspaceStore();
  const password = 'a sufficiently long test password';
  store.addAccount('profile-owner@example.test', await hashPassword(password));
  store.addAccount('profile-other@example.test', await hashPassword('another sufficiently long password'));
  const owner = store.credentials('profile-owner@example.test').id;
  const other = store.credentials('profile-other@example.test').id;
  const cookie = (id) => 'nri_session=' + store.newSession(id);
  const ownerCookie = cookie(owner);
  const otherCookie = cookie(other);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const settings = origin + '/workspace/settings?lang=en';
  const update = (session, suppliedPassword) => fetch(settings, {
    method: 'POST', redirect: 'manual', headers: { origin, cookie: session },
    body: new URLSearchParams({ intent: 'update-profile', 'display-name': 'Research Reader', theme: 'light', password: suppliedPassword }),
  });
  try {
    assert.equal((await update(ownerCookie, 'incorrect password')).status, 403);
    assert.deepEqual(store.settings.profile(owner), { displayName: '', theme: 'dark' });
    assert.equal((await update(ownerCookie, password)).status, 303);
    assert.equal(store.settings.profile(owner).displayName, 'Research Reader');
    assert.equal(store.settings.profile(owner).theme, 'light');
    const response = await fetch(settings, { headers: { cookie: ownerCookie } });
    const page = await response.text();
    assert.equal(response.status, 200);
    assert.match(page, /Profile and appearance updated/);
    assert.match(page, /Research Reader/);
    const themed = await fetch(origin + '/?lang=en', { headers: { cookie: ownerCookie } });
    assert.match(await themed.text(), /data-theme="light"/);
    const unrelated = await fetch(origin + '/?lang=en', { headers: { cookie: otherCookie } });
    assert.match(await unrelated.text(), /data-theme="dark"/);
    assert.deepEqual(store.settings.list(other), []);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
