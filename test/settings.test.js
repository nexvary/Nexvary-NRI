import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

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
