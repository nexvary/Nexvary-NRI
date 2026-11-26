import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('grades locally, preserves completed lessons and isolates learner progress', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  const learners = ['learner', 'private'].map((name) => {
    const email = name + '@example.test';
    store.addAccount(email, credentials);
    return 'nri_session=' + store.newSession(store.credentials(email).id);
  });
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/education?lang=en';
  const get = (cookie) => fetch(url + '&last=100', { headers: { cookie } });
  const submit = (answer) => fetch(url, {
    method: 'POST', headers: { cookie: learners[0], origin },
    body: new URLSearchParams({ lesson: 'provenance', answer }),
  });
  try {
    assert.equal((await submit('99')).status, 422);
    assert.match(await (await submit('0')).text(), /try again/);
    assert.match(await (await submit('1')).text(), /Completed/);
    const learner = await (await get(learners[0])).text();
    assert.match(learner, /Attempts · 2 · Completed/);
    assert.match(learner, /21\.6/);
    const other = await (await get(learners[1])).text();
    assert.doesNotMatch(other, /Completed/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
