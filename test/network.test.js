import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('keeps research profiles private until opt-in and honors collaboration and blocking boundaries', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  const names = ['Researcher A', 'Researcher B', 'Researcher C'];
  const accounts = names.map((_, index) => {
    const email = 'network' + index + '@example.test';
    store.addAccount(email, credentials);
    const id = store.credentials(email).id;
    return { id, email, cookie: 'nri_session=' + store.newSession(id) };
  });
  const [a, b, c] = accounts;
  const project = store.createProject(a.id, { title: 'Private project', description: '' });
  const logged = [];
  const app = createApp(store, { log: (event) => logged.push(event) });
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const page = (kind) => origin + '/workspace/' + kind + '?lang=en';
  const post = (kind, actor, data) => fetch(page(kind), {
    method: 'POST', redirect: 'manual', headers: { cookie: actor.cookie, origin }, body: new URLSearchParams(data),
  });
  const get = (kind, actor) => fetch(page(kind), { redirect: 'manual', headers: { cookie: actor.cookie } });
  const update = (actor, name, discoverable) => post('network', actor, {
    intent: 'profile', name, discoverable, interests: 'Hydrology',
  });
  try {
    assert.equal((await update(a, names[0], 'yes')).status, 303);
    assert.equal((await update(b, names[1], 'no')).status, 303);
    assert.equal((await update(c, names[2], 'yes')).status, 303);
    assert.doesNotMatch(await (await get('network', a)).text(), /Researcher B/);
    assert.equal((await post('network', a, { intent: 'request', peer: b.id })).status, 422);
    assert.equal((await update(b, names[1], 'yes')).status, 303);
    assert.equal((await post('network', a, { intent: 'follow', peer: b.id })).status, 303);
    assert.equal((await post('network', a, { intent: 'request', peer: b.id })).status, 303);
    assert.equal((await post('collaboration', c, { intent: 'accept', peer: a.id })).status, 422);
    const inbox = await (await get('collaboration', b)).text();
    assert.match(inbox, /Researcher A/);
    assert.doesNotMatch(inbox, /network0@example.test|Private project/);
    assert.equal((await post('collaboration', b, { intent: 'accept', peer: a.id })).status, 303);
    const privateProject = await fetch(page('projects/' + project), { headers: { cookie: b.cookie } });
    assert.equal(privateProject.status, 404);
    assert.equal((await post('network', b, { intent: 'block', peer: a.id })).status, 303);
    assert.doesNotMatch(await (await get('network', a)).text(), /Researcher B/);
    assert.doesNotMatch(await (await get('collaboration', b)).text(), /Researcher A/);
    assert.equal((await post('network', a, { intent: 'follow', peer: b.id })).status, 422);
    assert.equal((await post('network', b, { intent: 'unblock', peer: a.id })).status, 303);
    assert.match(await (await get('network', a)).text(), /Researcher B/);

    assert.match(await (await get('network', a)).text(), /Report profile/);
    assert.equal((await post('network', a, { intent: 'report', peer: b.id, reason: 'harassment' })).status, 303);
    assert.equal((await post('network', a, { intent: 'report', peer: b.id, reason: 'harassment' })).status, 422);
    assert.equal((await fetch(origin + '/workspace/settings/network-moderation?lang=en', { headers: { cookie: a.cookie } })).status, 403);
    store.messages.setModerator(c.id, true);
    assert.equal(store.messages.isModerator(c.id), true);
    const moderationPage = await fetch(origin + '/workspace/settings/network-moderation?lang=en', { headers: { cookie: c.cookie } });
    assert.equal(moderationPage.status, 200, JSON.stringify(logged.find((event) => event.event === 'http.error')));
    assert.match(await moderationPage.text(), /Pending network reports[\s\S]*Researcher B[\s\S]*Harassment/);
    const [report] = store.network.reports();
    assert.equal((await fetch(origin + '/workspace/settings/network-moderation?lang=en', {
      method: 'POST', redirect: 'manual', headers: { origin, cookie: c.cookie },
      body: new URLSearchParams({ 'report-id': String(report.id), intent: 'actioned' }),
    })).status, 303);
    assert.equal(store.network.profile(b.id).discoverable, 0);
    assert.equal(store.network.reports().length, 0);
    assert.deepEqual(store.network.moderationEvents().map(({ reviewerId, action }) => ({ reviewerId, action })),
      [{ reviewerId: c.id, action: 'actioned' }]);
    assert.equal((await post('network', a, { intent: 'report', peer: b.id, reason: 'invalid' })).status, 422);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
