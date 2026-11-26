import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createCrossrefClient, crossrefUrl, normalizeDoi, resolverUrl } from '../src/crossref.js';
import { createOpenAlexClient, openAlexUrl } from '../src/openalex.js';
import { createOrcidClient, createZenodoClient, normalizeOrcid, normalizeZenodoDoi } from '../src/public-identifiers.js';
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
    raw.exec('DROP TABLE readiness_revisions; DROP TABLE evidence_items; DROP TABLE claims; DROP TABLE project_references; DROP TABLE reference_cache; PRAGMA user_version = 2;');
    raw.close();
    store = openWorkspaceStore(path, now);
    const record = { doi: unknown, provider: 'crossref', status: 'not-found', checkedAt: fixtureTime, metadata: null };
    assert.equal(store.references.save(owner, project, record, true), true);
    store.close();
    store = openWorkspaceStore(path, now);
    try {
      assert.deepEqual(store.references.list(owner, project), [record]);
      assert.deepEqual(store.references.cached(owner, unknown, 'crossref'), record);
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

test('normalizes OpenAlex works API URL', () => {
  assert.equal(openAlexUrl('10.5555/nri-test#one'), 'https://api.openalex.org/works/doi:10.5555/nri-test%23one');
  assert.equal(openAlexUrl('10.5555/one/two'), 'https://api.openalex.org/works/doi:10.5555/one/two');
});

test('normalizes OpenAlex work metadata and handles retraction flag', async () => {
  let now = fixtureTime;
  const fixtureWork = {
    id: 'https://openalex.org/W0000001',
    doi: 'https://doi.org/10.5555/nri-test%23one',
    title: 'OpenAlex Synthetic Title',
    type: 'article',
    publication_year: 2024,
    is_retracted: false,
    primary_location: {
      source: { display_name: 'Test Journal', host_organization_name: 'Test Publisher' },
      is_oa: true,
      landing_page_url: 'https://example.org/landing',
      pdf_url: null,
    },
    authorships: [
      { author: { display_name: 'Alice Researcher' } },
      { author: { display_name: 'Bob Scholar' } },
    ],
  };
  const openalex = createOpenAlexClient({
    now: () => now,
    fetchRecord: async (url) => {
      assert.equal(url, openAlexUrl('10.5555/nri-test#one'));
      return Response.json(fixtureWork);
    },
  });
  const result = await openalex('10.5555/nri-test#one');
  assert.equal(result.status, 'found');
  assert.equal(result.checkedAt, fixtureTime);
  assert.equal(result.metadata.title, 'OpenAlex Synthetic Title');
  assert.equal(result.metadata.type, 'article');
  assert.equal(result.metadata.issued, '2024');
  assert.equal(result.metadata.isRetracted, false);
  assert.equal(result.metadata.authors[0], 'Alice Researcher');
  assert.equal(result.metadata.venue, 'Test Journal');
  assert.equal(result.metadata.publisher, 'Test Publisher');
  assert.equal(result.metadata.openAccessUrl, 'https://example.org/landing');

  now += 1001;
  const retractedWork = { ...fixtureWork, is_retracted: true };
  const openalex2 = createOpenAlexClient({
    now: () => now,
    fetchRecord: async () => Response.json(retractedWork),
  });
  const retracted = await openalex2('10.5555/nri-test#one');
  assert.equal(retracted.metadata.isRetracted, true);

  now += 1001;
  const openalex3 = createOpenAlexClient({
    now: () => now,
    fetchRecord: async () => new Response(null, { status: 404 }),
  });
  assert.deepEqual(await openalex3('10.5555/nri-test#one'), { status: 'not-found', checkedAt: now, metadata: null });

  now += 1001;
  const openalex4 = createOpenAlexClient({
    now: () => now,
    fetchRecord: async () => new Response(null, { status: 500 }),
  });
  assert.deepEqual(await openalex4('10.5555/nri-test#one'), { status: 'unavailable' });
});

test('limits concurrent OpenAlex calls and respects retry-after', async () => {
  let now = fixtureTime;
  let calls = 0;
  let release;
  const openalex = createOpenAlexClient({
    now: () => now,
    fetchRecord: () => {
      calls++;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const pending = openalex(doi);
  assert.equal((await openalex(doi)).status, 'limited');
  release(new Response(null, { status: 429, headers: { 'Retry-After': '20' } }));
  assert.deepEqual(await pending, { status: 'limited', retryAfter: 20 });
  assert.equal(calls, 1);
});

test('saves OpenAlex DOI results alongside Crossref and enables comparison', async () => {
  let now = fixtureTime;
  let crossrefCalls = 0;
  let openalexCalls = 0;
  const store = openWorkspaceStore(':memory:', () => now);
  store.addAccount('owner@example.test', credentials);
  const owner = store.credentials('owner@example.test').id;
  const project = store.createProject(owner, { title: 'Comparison project', description: '' });
  const ownerCookie = () => 'nri_session=' + store.newSession(owner);

  const crossrefAdapter = createCrossrefClient({
    now: () => now,
    fetchRecord: async (url) => {
      crossrefCalls++;
      assert.equal(url, crossrefUrl(doi));
      return Response.json({
        status: 'ok', 'message-type': 'work',
        message: { DOI: doi, title: ['Crossref Title'], type: 'journal-article', issued: { 'date-parts': [[2023]] } },
      });
    },
  });

  const openalexAdapter = createOpenAlexClient({
    now: () => now,
    fetchRecord: async (url) => {
      openalexCalls++;
      assert.equal(url, openAlexUrl(doi));
      return Response.json({
        id: 'https://openalex.org/W1',
        doi: resolverUrl(doi),
        title: 'OpenAlex Title',
        type: 'article',
        publication_year: 2023,
        is_retracted: false,
        primary_location: { source: { display_name: 'Test Journal', host_organization_name: null }, pdf_url: null, landing_page_url: null },
        authorships: [],
      });
    },
  });

  const app = createApp(store, { crossref: crossrefAdapter, openalex: openalexAdapter });
  try {
    await new Promise((resolve, reject) => app.once('error', reject).listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${app.address().port}`;
    let cookie = ownerCookie();
    const path = (id) => `/workspace/projects/${id}/references?lang=en`;
    const post = (target, fields, session = cookie) => fetch(origin + target, {
      method: 'POST', redirect: 'manual',
      headers: { Cookie: session, Origin: origin },
      body: new URLSearchParams(fields),
    });
    const get = (target, session = cookie) => fetch(origin + target, {
      redirect: 'manual', headers: session ? { Cookie: session } : {},
    });

    // Check via Crossref
    const r1 = await post(path(project), { doi, action: 'check', provider: 'crossref' });
    assert.equal(r1.status, 303);
    assert.equal(crossrefCalls, 1);
    assert.equal(openalexCalls, 0);

    let html = await (await get(path(project))).text();
    assert.match(html, /Crossref Title/);
    assert.match(html, /Crossref/);
    assert.doesNotMatch(html, /OpenAlex Title/);

    // Both providers checked message should NOT appear yet (only crossref done)
    assert.match(html, /Check this DOI against the second provider/);

    // Check same DOI via OpenAlex
    now += 1001;
    const r2 = await post(path(project), { doi, action: 'check', provider: 'openalex' });
    assert.equal(r2.status, 303);
    assert.equal(openalexCalls, 1);

    html = await (await get(path(project))).text();
    assert.match(html, /Crossref Title/);
    assert.match(html, /OpenAlex Title/);
    // Both providers checked message should now appear
    assert.match(html, /Both providers have been checked/);

    // OpenAlex uses cache (same account)
    now += 1001;
    const r3 = await post(path(project), { doi, action: 'check', provider: 'openalex' });
    assert.equal(r3.status, 303);
    assert.equal(openalexCalls, 1); // no new call

    // Remove just the OpenAlex record
    now += 1001;
    const r4 = await post(path(project), { doi, action: 'remove', provider: 'openalex' });
    assert.equal(r4.status, 303);
    html = await (await get(path(project))).text();
    assert.match(html, /Crossref Title/);
    assert.doesNotMatch(html, /OpenAlex Title/);

    // Reject unknown provider
    now += 1001;
    const r5 = await post(path(project), { doi, action: 'check', provider: 'unknown-provider' });
    assert.equal(r5.status, 400);
    assert.equal(crossrefCalls, 1);

  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test('migrates a P2a database (version 3) to version 4 and preserves existing records', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const directory = await mkdtemp(join(tmpdir(), 'nri-v3-migration-test-'));
  const dbPath = join(directory, 'workspace.sqlite');
  const now = () => fixtureTime;
  try {
    // Create a version 3 database (P2a schema without provider column)
    const v3Schema = `
      CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt BLOB NOT NULL CHECK(length(salt) = 16), hash BLOB NOT NULL CHECK(length(hash) = 32)) STRICT;
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE INDEX projects_owner_updated ON projects(owner_id, updated_at DESC, id);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE document_key (id INTEGER PRIMARY KEY CHECK(id = 1), fingerprint TEXT NOT NULL) STRICT;
      CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL) STRICT;
      CREATE INDEX documents_project ON documents(project_id, id);
      CREATE TABLE document_versions (document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, number INTEGER NOT NULL CHECK(number > 0), filename TEXT NOT NULL, created_at INTEGER NOT NULL, size INTEGER NOT NULL CHECK(size > 0), nonce BLOB NOT NULL UNIQUE CHECK(length(nonce) = 12), ciphertext BLOB NOT NULL CHECK(length(ciphertext) = size), tag BLOB NOT NULL CHECK(length(tag) = 16), PRIMARY KEY(document_id, number)) STRICT;
      CREATE TABLE reference_cache (owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, doi TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('found', 'not-found')), checked_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(owner_id, doi)) STRICT;
      CREATE TABLE project_references (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, doi TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('found', 'not-found')), checked_at INTEGER NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(project_id, doi)) STRICT;
    `;
    const raw = new DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
    raw.exec(v3Schema);
    // Insert a test account and project
    raw.exec(`INSERT INTO accounts VALUES ('acct1', 'test@example.test', zeroblob(16), zeroblob(32));`);
    raw.exec(`INSERT INTO projects VALUES ('proj1', 'acct1', 'Test Project', '', ${fixtureTime});`);
    // Insert a reference record (old schema, no provider column)
    raw.exec(`INSERT INTO project_references VALUES ('proj1', '10.5555/legacy', 'found', ${fixtureTime}, '{"title":"Legacy Title"}');`);
    raw.exec(`INSERT INTO reference_cache VALUES ('acct1', '10.5555/legacy', 'found', ${fixtureTime}, ${fixtureTime + 86400000}, '{"title":"Legacy Title"}');`);
    raw.exec('PRAGMA user_version = 3;');
    raw.close();

    // Open with current code and preserve the version 3 reference rows
    const store = openWorkspaceStore(dbPath, now);
    try {
      const records = store.references.list('acct1', 'proj1');
      assert.equal(records.length, 1);
      assert.equal(records[0].doi, '10.5555/legacy');
      assert.equal(records[0].provider, 'crossref'); // migrated default
      assert.equal(records[0].status, 'found');
      assert.equal(records[0].metadata.title, 'Legacy Title');

      const cached = store.references.cached('acct1', '10.5555/legacy', 'crossref');
      assert.ok(cached);
      assert.equal(cached.provider, 'crossref');
      assert.equal(cached.status, 'found');
    } finally {
      store.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects mismatched OpenAlex records and restricts links to reported open-access locations', async () => {
  const doi = '10.5555/nri-test';
  async function fetchWork(work) {
    return createOpenAlexClient({ fetchRecord: async () => Response.json(work) })(doi);
  }
  assert.deepEqual(await fetchWork({ doi: '10.5555/other-work' }), { status: 'unavailable' });
  const work = { doi, primary_location: { landing_page_url: 'https://example.org/paywalled' } };
  assert.equal((await fetchWork(work)).metadata.openAccessUrl, '');
  work.best_oa_location = { pdf_url: 'javascript:alert(1)', landing_page_url: 'https://example.org/repository' };
  assert.equal((await fetchWork(work)).metadata.openAccessUrl, 'https://example.org/repository');
});

test('validates public identifiers and saves dated ORCID and Zenodo snapshots in the private workspace', async () => {
  const id = '0000-0002-1825-0097';
  const doi = '10.5281/zenodo.123';
  assert.equal(normalizeOrcid('https://orcid.org/' + id), id);
  assert.equal(normalizeOrcid('0000-0002-1825-0098'), null);
  assert.equal(normalizeOrcid('https://orcid.org.evil.test/' + id), null);
  assert.equal(normalizeZenodoDoi('https://doi.org/' + doi), doi);
  assert.equal(normalizeZenodoDoi('10.5281/zenodo.123/extra'), null);

  const store = openWorkspaceStore();
  store.addAccount('provider-owner@example.test', credentials);
  store.addAccount('provider-other@example.test', credentials);
  const owner = store.credentials('provider-owner@example.test').id;
  const other = store.credentials('provider-other@example.test').id;
  const project = store.createProject(owner, { title: 'Provider integration fixture', description: '' });
  const ownerCookie = 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);
  let orcidCalls = 0;
  const orcid = createOrcidClient({ fetchRecord: async (url) => {
    assert.equal(url, 'https://pub.orcid.org/v3.0/' + id + '/person');
    orcidCalls++;
    return Response.json({ name: { path: id, visibility: 'public', 'credit-name': { value: 'Synthetic public name' } } });
  } });
  const zenodo = createZenodoClient({ fetchRecord: async (url) => {
    assert.equal(url, 'https://zenodo.org/api/records/123');
    return Response.json({
      doi, status: 'published', metadata: {
        title: 'Synthetic dataset', creators: [{ name: 'Synthetic author' }],
        publication_date: '2026-11-26', license: { id: 'cc-by-4.0' },
      },
    });
  } });
  const app = createApp(store, { orcid, zenodo });
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/projects/' + project + '/references?lang=en';
  const check = (provider, doi, cookie = ownerCookie) => fetch(url, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, origin },
    body: new URLSearchParams({ provider, doi, action: 'check' }),
  });
  try {
    assert.equal((await check('orcid', id, otherCookie)).status, 404);
    assert.equal((await check('orcid', id + 'x')).status, 422);
    assert.equal(orcidCalls, 0);
    assert.equal((await check('orcid', id)).status, 303);
    assert.equal((await check('orcid', id)).status, 303);
    assert.equal(orcidCalls, 1);
    assert.equal((await check('zenodo', doi)).status, 303);
    const html = await (await fetch(url, { headers: { cookie: ownerCookie } })).text();
    for (const expected of ['Synthetic public name', 'Ownership is unverified', 'Synthetic dataset', 'cc-by-4.0', 'Retrieved (UTC)']) {
      assert.ok(html.includes(expected), expected);
    }
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
