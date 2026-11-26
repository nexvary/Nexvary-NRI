import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('tracks dated source updates and saved searches without accessing another account', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('watch-owner@example.test', credentials);
  store.addAccount('watch-other@example.test', credentials);
  const owner = store.credentials('watch-owner@example.test').id;
  const other = store.credentials('watch-other@example.test').id;
  const cookie = (id) => 'nri_session=' + store.newSession(id);
  const ownerCookie = cookie(owner);
  const otherCookie = cookie(other);
  const project = store.createProject(owner, { title: 'Watchlist source', description: '' });
  const doi = '10.5555/solar-fixture';
  const record = { doi, provider: 'crossref', status: 'found', checkedAt: Date.now(), metadata: { title: 'Synthetic solar source' } };
  store.references.save(owner, project, record, true);
  const otherProject = store.createProject(other, { title: 'Other source', description: '' });
  store.references.save(other, otherProject, record, true);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const watch = '/workspace/observatory?lang=en';
  const post = (path, data, cookie = ownerCookie) => fetch(origin + path, {
    method: 'POST', redirect: 'manual', headers: { cookie, origin }, body: new URLSearchParams(data),
  });
  const get = (path, cookie = ownerCookie) => fetch(origin + path, { headers: { cookie } });
  try {
    const create = await post(watch, { title: 'Solar watchlist', query: 'solar' });
    assert.equal(create.status, 303);
    const path = create.headers.get('location');
    assert.equal((await get(path, otherCookie)).status, 404);
    const update = { intent: 'add', note: 'Synthetic update note', date: '2026-11-26', source: project + ':crossref:' + doi };
    assert.equal((await post(path, { ...update, source: otherProject + ':crossref:' + doi })).status, 422);
    assert.equal((await post(path, { ...update, date: '2026-11-31' })).status, 422);
    assert.equal((await post(path, update)).status, 303);
    store.references.remove(owner, project, doi, 'crossref');
    const html = await (await get(path + '&q=synthetic')).text();
    assert.match(html, /Synthetic update note/);
    assert.match(html, /10\.5555\/solar-fixture/);
    assert.match(html, /kind=source&amp;q=solar/);
    const filtered = await (await get(path + '&q=absent')).text();
    assert.doesNotMatch(filtered, /Synthetic update note/);
    assert.equal((await post(path, { intent: 'remove', confirm: 'yes' }, otherCookie)).status, 404);
    assert.equal((await post(path, { intent: 'remove', confirm: 'yes' })).status, 303);
    assert.equal((await get(path)).status, 404);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
