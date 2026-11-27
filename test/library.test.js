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

test('dashboard isolates accepted collaborator counts, self-reported ORCID and metered usage', async (t) => {
  const store = openWorkspaceStore();
  const [owner, peer, outsider] = ['owner', 'peer', 'outsider'].map((name) => {
    const email = name + '@dashboard.test';
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const id = store.credentials(email).id;
    store.network.save(id, { name, interests: '', orcid: name === 'owner' ? '0000-0002-1825-0097' : '', discoverable: true });
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  store.network.interact(owner.id, peer.id, 'request');
  store.network.interact(peer.id, owner.id, 'accept');
  const entry = store.assistantUsage.reserve(owner.id, 'mock-dashboard', { tokens: 1000, cost: 500000 }, { tokens: 2000, cost: 1000000 });
  store.assistantUsage.record(owner.id, entry, 500, 11, 125000);
  const app = createApp(store);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = 'http://127.0.0.1:' + app.address().port;
  const view = async (user, lang = 'en') => (await fetch(base + '/?lang=' + lang, { headers: { cookie: user.cookie } })).text();
  const html = await view(owner);
  assert.match(html, /Accepted collaborators<\/dt><dd>1<\/dd>/);
  assert.match(html, /https:\/\/orcid.org\/0000-0002-1825-0097/);
  assert.match(html, /Self-reported/);
  assert.match(html, /Provider-reported tokens<\/dt>\s*<dd>511<\/dd>/);
  assert.match(html, /\$0\.125/);
  const unlinked = await view(outsider);
  assert.match(unlinked, /Accepted collaborators<\/dt><dd>0<\/dd>/);
  assert.doesNotMatch(unlinked, /0000-0002-1825-0097|\$0\.125|>511</);
  assert.match(await view(owner, 'ar'), /المتعاونون المقبولون/);
});

test('library collections and reading marks remain owner-scoped and tied to PDF versions', async (t) => {
  const store = openWorkspaceStore();
  const [owner, other] = ['owner', 'other'].map((name) => {
    const email = name + '@organization.test';
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const id = store.credentials(email).id;
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const project = store.createProject(owner.id, { title: 'Owner project', description: '' });
  const document = store.documents.create(owner.id, project, { name: 'Methods.pdf', bytes: Buffer.from('%PDF-1.4\nfixture') });
  const app = createApp(store);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const index = '/workspace/library/collections?lang=en';
  const reading = '/workspace/projects/' + project + '/documents/' + document + '/reading?lang=en';
  const request = (user, path, fields, source = origin) => fetch(origin + path, {
    redirect: 'manual', headers: { cookie: user.cookie, ...(fields ? { origin: source } : {}) },
    ...(fields ? { method: 'POST', body: new URLSearchParams(fields) } : {}),
  });
  const created = await request(owner, index, { intent: 'create', name: 'Methods folder' });
  assert.equal(created.status, 303);
  const location = created.headers.get('location');
  const collection = new URL(origin + location).searchParams.get('collection');
  assert.equal((await request(other, location)).status, 404);
  assert.equal((await request(other, index, { intent: 'remove', collection })).status, 404);
  assert.equal((await request(other, reading)).status, 404);
  assert.equal((await request(owner, reading, { intent: 'link', collection }, 'https://foreign.test')).status, 403);
  assert.equal((await request(owner, reading, { intent: 'link', collection })).status, 303);
  assert.match(await (await request(owner, location)).text(), /Methods\.pdf/);
  const mark = { intent: 'add-mark', kind: 'annotation', page: 2, version: 1, text: '<script>Review methods</script>' };
  assert.equal((await request(owner, reading, { ...mark, version: 9 })).status, 422);
  assert.equal((await request(owner, reading, mark)).status, 303);
  assert.equal((await request(owner, reading, { ...mark, kind: 'bookmark', text: '' })).status, 303);
  assert.ok(store.documents.append(owner.id, project, document, { name: 'Revision.pdf', bytes: Buffer.from('%PDF-1.4\nsecond') }));
  const html = await (await request(owner, reading)).text();
  assert.match(html, /Annotation · v1/);
  assert.match(html, /Bookmark · v1/);
  assert.match(html, /&lt;script&gt;Review methods&lt;\/script&gt;/);
  assert.equal((await request(owner, location, { intent: 'remove', collection })).status, 303);
  assert.ok(store.documents.get(owner.id, project, document));
  assert.equal(store.organization.reading(owner.id, project, document, 0).marks.length, 2);
  assert.ok(store.documents.delete(owner.id, project, document));
  assert.equal((await request(owner, reading)).status, 404);
});
