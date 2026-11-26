import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createCrossrefClient, crossrefUrl, normalizeDoi } from '../src/crossref.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const doi = '10.5555/nri-test#one';
const unknown = '10.5555/nri-missing';
const correction = '10.5555/nri-correction';
const retraction = '10.5555/nri-retraction';
const fixtureTime = Date.UTC(2026, 10, 26, 14, 0);
const credentials = { salt: randomBytes(16), hash: randomBytes(32) };

function responseFor(identifier, extra = {}) {
  return Response.json({
    status: 'ok',
    'message-type': 'work',
    message: { DOI: identifier, ...extra },
  });
}

test('normalizes supported DOI input and preserves reserved characters on a fixed host', () => {
  assert.equal(normalizeDoi(' DOI: 10.5555/NRI-test#One '), doi);
  assert.equal(normalizeDoi('https://doi.org/10.5555/NRI-test%23One'), doi);
  assert.equal(normalizeDoi('http://dx.doi.org/10.5555%2FNRI-test%23One'), doi);
  assert.equal(crossrefUrl(doi), 'https://api.crossref.org/works/10.5555/nri-test%23one');
  assert.equal(normalizeDoi('10.5555/one/two'), '10.5555/one/two');
  for (const input of [
    'https://doi.org.invalid/10.5555/a', 'https://doi.org@invalid.test/10.5555/a',
    'https://doi.org/10.5555/a?hidden=1', 'http://doi.org:8888/10.5555/a',
    'https://doi.org/10.5555/%zz', 'https://doi.org/10.5555/A\nB',
    '10.5555/../resource', '10.5555/', '10.5555/a b',
  ]) assert.equal(normalizeDoi(input), null, input);
});

test('distinguishes work updates from update notices and treats inconsistent metadata as unavailable', async () => {
  let now = fixtureTime;
  let response = responseFor(doi, {
    title: ['Synthetic work'],
    type: 'posted-content',
    subtype: 'preprint',
    issued: { 'date-parts': [[2024, 2, 29]] },
    'updated-by': [{ type: 'retraction', DOI: retraction, source: 'retraction-watch' }],
    'update-to': [{ type: 'correction', DOI: correction, source: 'publisher' }],
  });
  const crossref = createCrossrefClient({
    now: () => now,
    fetchRecord: async (url, options) => {
      assert.equal(url, crossrefUrl(doi));
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Accept, 'application/json');
      return response;
    },
  });
  const result = await crossref(doi);
  assert.equal(result.status, 'found');
  assert.equal(result.checkedAt, fixtureTime);
  assert.equal(result.metadata.subtype, 'preprint');
  assert.equal(result.metadata.issued, '2024-02-29');
  assert.equal(result.metadata.updatedBy[0].doi, retraction);
  assert.equal(result.metadata.updates[0].doi, correction);

  now += 1001;
  response = responseFor('10.5555/unrelated');
  assert.deepEqual(await crossref(doi), { status: 'unavailable' });
  now += 1001;
  response = new Response('<html>An error</html>');
  assert.deepEqual(await crossref(doi), { status: 'unavailable' });
  now += 1001;
  response = new Response(null, { status: 404 });
  assert.deepEqual(await crossref(doi), { status: 'not-found', checkedAt: now, metadata: null });
});

test('limits concurrent provider calls and respects provider retry instructions', async () => {
  let now = fixtureTime;
  let calls = 0;
  let release;
  const crossref = createCrossrefClient({
    now: () => now,
    fetchRecord: () => {
      calls++;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const pending = crossref(doi);
  assert.equal((await crossref(unknown)).status, 'limited');
  release(new Response(null, { status: 429, headers: { 'Retry-After': '15' } }));
  assert.deepEqual(await pending, { status: 'limited', retryAfter: 15 });
  now += 10_000;
  assert.deepEqual(await crossref(doi), { status: 'limited', retryAfter: 5 });
  assert.equal(calls, 1);

  now += 5000;
  const next = crossref(doi);
  release(new Response(null, { status: 503 }));
  assert.deepEqual(await next, { status: 'unavailable' });
  assert.equal(calls, 2);
});

test('saves dated DOI results within their own projects and preserves them during upstream failures', async () => {
  let now = fixtureTime;
  let calls = 0;
  let unavailable = false;
  const store = openWorkspaceStore(':memory:', () => now);
  store.addAccount('owner@example.test', credentials);
  store.addAccount('other@example.test', credentials);
  const owner = store.credentials('owner@example.test').id;
  const other = store.credentials('other@example.test').id;
  const project = store.createProject(owner, { title: 'Synthetic project', description: 'private note' });
  const alternate = store.createProject(owner, { title: 'Second owner project', description: '' });
  const foreign = store.createProject(other, { title: 'Other project', description: '' });
  const ownerCookie = () => 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);

  const adapter = createCrossrefClient({
    now: () => now,
    fetchRecord: async (url) => {
      calls++;
      assert.ok([crossrefUrl(doi), crossrefUrl(unknown)].includes(url));
      if (unavailable) return new Response(null, { status: 503 });
      if (url === crossrefUrl(unknown)) return new Response(null, { status: 404 });
      return responseFor(doi, {
        title: ['<Synthetic> reference'],
        type: 'posted-content',
        subtype: 'preprint',
        'updated-by': [{ type: 'retraction', DOI: retraction, source: 'retraction-watch' }],
      });
    },
  });
  const app = createApp(store, { crossref: adapter });
  try {
    await new Promise((resolve, reject) => app.once('error', reject).listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${app.address().port}`;
    let cookie = ownerCookie();
    const path = (id) => `/workspace/projects/${id}/references?lang=en`;
    const get = (target, session = cookie) => fetch(origin + target, {
      redirect: 'manual', headers: session ? { Cookie: session } : {},
    });
    const post = (target, input, session = cookie, action = 'check') => fetch(origin + target, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: session, Origin: origin },
      body: new URLSearchParams({ doi: input, action }),
    });

    const picker = await get('/workspace/reference-projects?lang=en');
    const choices = await picker.text();
    assert.match(choices, /Synthetic project/);
    assert.doesNotMatch(choices, /Other project/);
    assert.equal((await get(path(project), otherCookie)).status, 404);
    assert.equal((await post(path(project), doi, otherCookie)).status, 404);
    assert.equal((await get(path(project), '')).status, 303);
    assert.equal((await post(path(project), 'https://unrelated.test')).status, 422);
    assert.equal(calls, 0);

    const added = await post(path(project), 'https://doi.org/10.5555/NRI-test%23One');
    assert.equal(added.status, 303);
    assert.equal(added.headers.get('location'), path(project));
    const saved = await get(path(project));
    assert.equal(saved.headers.get('cache-control'), 'no-store');
    const html = await saved.text();
    assert.match(html, /&lt;Synthetic&gt; reference/);
    assert.match(html, /Preprint/);
    assert.match(html, /Retraction/);
    assert.match(html, /2026-11-26T14:00:00\.000Z/);
    assert.match(html, /https:\/\/api\.crossref\.org\/works\/10\.5555\/nri-test%23one/);
    assert.equal(calls, 1);
    assert.doesNotMatch(await (await get(path(foreign), otherCookie)).text(), /&lt;Synthetic&gt;/);
    assert.equal((await post(path(alternate), doi)).status, 303);
    assert.equal(calls, 1);
    assert.match(await (await get(path(alternate))).text(), /2026-11-26T14:00:00\.000Z/);
    assert.equal((await post(path(foreign), doi, otherCookie)).status, 429);
    assert.equal(calls, 1);

    now += 1001;
    assert.equal((await post(path(project), unknown)).status, 303);
    assert.match(await (await get(path(project))).text(), /DOI status is unknown/);
    assert.equal((await post(path(project), unknown)).status, 303);
    assert.equal(calls, 2);

    now += 15 * 60_000 + 1;
    assert.equal((await post(path(project), unknown)).status, 303);
    assert.equal(calls, 3);
    now += 24 * 60 * 60_000;
    cookie = ownerCookie();
    unavailable = true;
    const failed = await post(path(project), doi);
    assert.equal(failed.status, 503);
    const failure = await failed.text();
    assert.match(failure, /Previously saved results/);
    assert.match(failure, /2026-11-26T14:00:00\.000Z/);
    assert.equal(calls, 4);

    assert.equal((await post(path(alternate), doi, cookie, 'remove')).status, 303);
    assert.doesNotMatch(await (await get(path(alternate))).text(), /&lt;Synthetic&gt;/);
    assert.match(await (await get(path(project))).text(), /&lt;Synthetic&gt;/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test('migrates a P1b database and persists reference snapshots and the local cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-references-test-'));
  const path = join(directory, 'workspace.sqlite');
  const now = () => fixtureTime;
  try {
    let store = openWorkspaceStore(path, now);
    store.addAccount('owner@example.test', credentials);
    const owner = store.credentials('owner@example.test').id;
    const project = store.createProject(owner, { title: 'From P1b', description: '' });
    const document = store.documents.create(owner, project, { name: 'fixture.pdf', bytes: Buffer.from('test bytes') });
    store.close();
    const raw = new DatabaseSync(path);
    raw.exec('DROP TABLE project_references; DROP TABLE reference_cache; PRAGMA user_version = 2;');
    raw.close();
    store = openWorkspaceStore(path, now);
    const record = { doi: unknown, status: 'not-found', checkedAt: fixtureTime, metadata: null };
    assert.equal(store.references.save(owner, project, record, true), true);
    store.close();
    store = openWorkspaceStore(path, now);
    try {
      assert.deepEqual(store.references.list(owner, project), [record]);
      assert.deepEqual(store.references.cached(owner, unknown), record);
      assert.equal(store.documents.download(owner, project, document, 1).bytes.toString(), 'test bytes');
      assert.equal(store.deleteProject(owner, project), true);
      assert.deepEqual(store.references.list(owner, project), []);
    } finally {
      store.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
