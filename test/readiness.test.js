import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { readinessState } from '../src/readiness.js';
import { openWorkspaceStore } from '../src/store.js';

test('blocks L-READY on safety or authorization before evaluating evidence gaps', () => {
  const dimensions = [...'LREADY'].map((letter) => ({ letter, level: 'integrated' }));
  assert.equal(readinessState({ dimensions, safety: 'unsafe', authorization: 'documented' }), 'blocked');
  assert.equal(readinessState({ dimensions, safety: 'documented', authorization: 'missing' }), 'blocked');
  assert.equal(readinessState({ dimensions, safety: 'documented', authorization: 'documented' }), 'recorded');
  dimensions[0].level = 'unavailable';
  assert.equal(readinessState({ dimensions, safety: 'documented', authorization: 'documented' }), 'gaps');
});

test('records a private six-dimension L-READY assessment and preserves revisions', async () => {
  const store = openWorkspaceStore();
  const creds = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('assessor@example.test', creds);
  store.addAccount('other@example.test', creds);
  const owner = store.credentials('assessor@example.test').id;
  const other = store.credentials('other@example.test').id;
  const project = store.createProject(owner, { title: 'Readiness fixture', description: '' });
  const ownerCookie = 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/projects/' + project + '/readiness?lang=en';
  const fields = {
    intendedUse: 'Illustrative use case', safety: 'unresolved', authorization: 'missing',
    ...Object.fromEntries([...'LREADY'].flatMap((letter) => [
      [letter + '-level', 'unavailable'], [letter + '-limits', 'Evidence missing'],
    ])),
  };
  const submit = (data, cookie = ownerCookie) => fetch(url, {
    method: 'POST', redirect: 'manual', headers: { cookie, origin }, body: new URLSearchParams(data),
  });
  try {
    assert.equal((await submit(fields, otherCookie)).status, 404);
    assert.equal((await submit({ ...fields, 'L-level': 'integrated' })).status, 422);
    assert.equal((await submit(fields)).status, 303);
    const [first] = store.readiness.list(owner, project);
    assert.deepEqual(first.dimensions.map((row) => row.letter), [...'LREADY']);
    assert.equal(first.reviewer, owner);
    const revise = { ...fields, id: first.id, revision: first.revision, authorization: 'documented', safety: 'documented' };
    assert.equal((await submit(revise)).status, 303);
    assert.equal((await submit(revise)).status, 422);
    assert.equal(store.readiness.list(owner, project).length, 2);
    const page = await (await fetch(url, { headers: { cookie: ownerCookie } })).text();
    assert.match(page, /Evidence gaps remain/);
    assert.match(page, /Assessment blocked by safety or authorization/);
    assert.match(page, /Revision history/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
