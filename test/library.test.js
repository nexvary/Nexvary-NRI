import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('searches the private library and renders account-scoped dashboard data', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('library-owner@example.test', credentials);
  store.addAccount('library-other@example.test', credentials);
  const owner = store.credentials('library-owner@example.test').id;
  const other = store.credentials('library-other@example.test').id;
  const project = store.createProject(owner, { title: 'Private water research', description: '' });
  const otherProject = store.createProject(other, { title: 'Other private project', description: '' });
  store.documents.create(owner, project, { name: 'Water methods.pdf', bytes: Buffer.from('%PDF-1.4') });
  store.documents.create(other, otherProject, { name: 'Other private file.pdf', bytes: Buffer.from('%PDF-1.4') });
  store.references.save(owner, project, {
    doi: '10.5555/fixture-library', provider: 'crossref', status: 'found', checkedAt: Date.now(),
    metadata: { title: 'Synthetic reference record' },
  }, true);
  const ownerCookie = 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const library = '/workspace/library?lang=en';
  const get = (path, cookie) => fetch(origin + path, {
    redirect: 'manual', headers: cookie ? { cookie } : {},
  });
  try {
    assert.equal((await get(library)).status, 303);
    const ownerDashboard = await get('/?lang=en', ownerCookie);
    assert.equal(ownerDashboard.headers.get('cache-control'), 'no-store');
    const ownerHtml = await ownerDashboard.text();
    assert.match(ownerHtml, /Private water research/);
    assert.match(ownerHtml, /Water methods.pdf/);
    assert.match(ownerHtml, /Synthetic reference record/);
    assert.doesNotMatch(ownerHtml, /Other private/);
    const guest = await (await get('/?lang=en')).text();
    assert.doesNotMatch(guest, /Private water research|Water methods.pdf/);
    const filtered = await (await get(library + '&kind=pdf&q=water', ownerCookie)).text();
    assert.match(filtered, /Water methods.pdf/);
    assert.doesNotMatch(filtered, /Synthetic reference record|Other private/);
    const source = await (await get(library + '&kind=source&q=10.5555', ownerCookie)).text();
    assert.match(source, /Synthetic reference record/);
    assert.doesNotMatch(source, /Water methods.pdf/);
    const otherResult = await (await get(library + '&q=water', otherCookie)).text();
    assert.match(otherResult, /No library records/);
    assert.doesNotMatch(otherResult, /Water methods.pdf|Private water research/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
