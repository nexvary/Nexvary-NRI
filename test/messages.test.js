import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('private messages enforce conversation membership, unread state, blocking and report limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-messages-'));
  const file = join(directory, 'workspace.sqlite');
  let now = Date.now();
  const store = openWorkspaceStore(file, () => now);
  const [alice, bob, eve] = ['Alice', 'Bob', 'Eve'].map((name) => {
    const email = name.toLowerCase() + '@example.test';
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const { id } = store.credentials(email);
    store.network.save(id, { name, interests: '', orcid: '', discoverable: true });
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  try {
    const origin = 'http://127.0.0.1:' + app.address().port;
    const inbox = '/workspace/messages?lang=en';
    const request = (user, path, fields, source = origin) => fetch(origin + path, {
      redirect: 'manual',
      headers: { cookie: user?.cookie ?? '', ...(fields ? { origin: source } : {}) },
      ...(fields ? { method: 'POST', body: new URLSearchParams(fields) } : {}),
    });
    assert.equal((await request(null, inbox)).headers.get('location'), '/login?lang=en');
    assert.equal((await request(alice, inbox, { intent: 'start', peer: bob.id })).status, 404);
    store.network.interact(alice.id, bob.id, 'request');
    store.network.interact(bob.id, alice.id, 'accept');
    assert.match(await (await request(alice, inbox)).text(), /Accepted collaborator/);
    const opened = await request(alice, inbox, { intent: 'start', peer: bob.id });
    assert.equal(opened.status, 303);
    const thread = opened.headers.get('location');
    const openedByBob = await request(bob, inbox, { intent: 'start', peer: alice.id });
    assert.equal(openedByBob.headers.get('location'), thread);
    assert.equal((await request(eve, thread)).status, 404);
    assert.equal((await request(eve, thread, { intent: 'send', text: 'intrusion' })).status, 404);
    const secret = 'Private text <script>escape me</script>';
    assert.equal((await request(alice, thread, { intent: 'send', text: secret }, 'https://another.test')).status, 403);
    assert.equal((await request(alice, thread, { intent: 'send', text: secret })).status, 303);
    assert.ok(!(await readFile(file)).includes(Buffer.from(secret)));
    assert.equal(store.messages.unread(alice.id), 0);
    const html = await (await request(bob, inbox)).text();
    assert.match(html, /Unread messages · 1/);
    assert.match(html, /You have unread messages/);
    assert.doesNotMatch(await (await request(eve, inbox)).text(), /Alice|Bob|Private text/);
    const dashboard = await request(bob, '/?lang=en');
    assert.equal(dashboard.headers.get('cache-control'), 'no-store');
    assert.match(await dashboard.text(), /Unread messages · 1/);
    await request(bob, inbox, { intent: 'preferences' });
    const quiet = await (await request(bob, inbox)).text();
    assert.match(quiet, /Unread messages · 1/);
    assert.doesNotMatch(quiet, /You have unread messages/);
    assert.doesNotMatch(await (await request(bob, '/?lang=en')).text(), /Unread messages · 1/);
    const message = await (await request(bob, thread.replace('lang=en', 'lang=ar'))).text();
    assert.match(message, /lang="ar" dir="rtl"/);
    assert.match(message, /Private text &lt;script&gt;escape me&lt;\/script&gt;/);
    const sequence = message.match(/name="message" value="(\d+)"/)[1];
    assert.equal((await request(eve, thread, { intent: 'read', message: sequence })).status, 404);
    assert.equal((await request(alice, thread, { intent: 'report', message: sequence, category: 'spam' })).status, 404);
    assert.equal((await request(bob, thread, { intent: 'report', message: sequence, category: 'spam' })).status, 303);
    assert.equal((await request(bob, thread, { intent: 'report', message: sequence, category: 'spam' })).status, 422);
    assert.match(await (await request(bob, thread)).text(), /Reported/);
    assert.doesNotMatch(await (await request(alice, thread)).text(), /Reported/);
    assert.equal((await request(bob, thread, { intent: 'read', message: sequence })).status, 303);
    assert.equal(store.messages.unread(bob.id), 0);
    assert.equal((await request(bob, thread, { intent: 'block' })).status, 303);
    assert.equal((await request(alice, thread, { intent: 'send', text: 'blocked sender' })).status, 403);
    assert.equal((await request(bob, thread, { intent: 'send', text: 'blocked recipient' })).status, 403);
    assert.equal((await request(alice, thread, { intent: 'unblock' })).status, 303);
    assert.equal((await request(alice, thread, { intent: 'send', text: 'still blocked' })).status, 403);
    assert.equal((await request(bob, thread, { intent: 'unblock' })).status, 303);
    for (let index = 1; index < 20; index++) {
      assert.equal((await request(alice, thread, { intent: 'send', text: 'Burst ' + index })).status, 303);
    }
    assert.equal((await request(alice, thread, { intent: 'send', text: 'Limited' })).status, 429);
    now += 60_001;
    assert.equal((await request(alice, thread, { intent: 'send', text: 'Window reset' })).status, 303);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
