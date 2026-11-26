import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const alice = 'docs-alice@example.test';
const bob = 'docs-bob@example.test';
const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
let server;
let origin;
let store;
let firstProject;
let secondProject;
let aliceCookie;
let bobCookie;

function pdf(comment) {
  const header = '%PDF-1.4\n';
  const catalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const pages = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const page = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\n';
  const objects = header + catalog + pages + page;
  const offsets = [header.length, header.length + catalog.length, header.length + catalog.length + pages.length];
  return Buffer.from(objects +
    'xref\n0 4\n0000000000 65535 f \n' +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${objects.length}\n%${comment}\n%%EOF\n`);
}

const firstPdf = pdf('first synthetic document');
const secondPdf = pdf('second synthetic document');

function fileForm(bytes, name = 'study.pdf') {
  const fields = new FormData();
  fields.set('pdf', new Blob([bytes], { type: 'application/pdf' }), name);
  return fields;
}

function request(path, { cookie = aliceCookie, body, method = body ? 'POST' : 'GET', source = origin } = {}) {
  return fetch(origin + path, {
    method,
    body,
    redirect: 'manual',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' && source ? { Origin: source } : {}),
    },
  });
}

before(async () => {
  store = openWorkspaceStore();
  store.addAccount(alice, credentials);
  store.addAccount(bob, credentials);
  const aliceId = store.credentials(alice).id;
  const bobId = store.credentials(bob).id;
  aliceCookie = 'nri_session=' + store.newSession(aliceId);
  bobCookie = 'nri_session=' + store.newSession(bobId);
  firstProject = store.createProject(aliceId, { title: 'Synthetic project', description: '' });
  secondProject = store.createProject(bobId, { title: 'Other project', description: '' });
  server = createApp(store);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

function documentsPath(project = firstProject) {
  return `/workspace/projects/${project}/documents`;
}

test('uploads two real PDF versions and returns each original as a private attachment', async () => {
  const page = await request(`/workspace/projects/${firstProject}?lang=en`);
  assert.match(await page.text(), /Private PDFs/);
  const empty = await request(documentsPath() + '?lang=ar');
  assert.match(await empty.text(), /لم تُضف ملفات PDF/);
  const created = await request(documentsPath() + '?lang=ar', { body: fileForm(firstPdf, 'دراسة.pdf') });
  assert.equal(created.status, 303);
  const history = created.headers.get('location').split('?')[0];
  assert.ok(history.startsWith(documentsPath() + '/'));
  const appended = await request(history + '?lang=en', { body: fileForm(secondPdf, 'study-v2.pdf') });
  assert.equal(appended.status, 303);

  const body = await (await request(history + '?lang=en')).text();
  assert.match(body, /Version history/);
  assert.ok(body.indexOf('Version 2') < body.indexOf('Version 1'));
  assert.match(body, /study-v2\.pdf/);
  assert.match(body, /دراسة\.pdf/);
  const first = await request(history + '/versions/1');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/pdf');
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.match(first.headers.get('content-disposition'), /^attachment; filename="document-v1.pdf"; filename\*=UTF-8''%D8/);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), firstPdf);
  const second = await request(history + '/versions/2');
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), secondPdf);
  const head = await request(history + '/versions/2', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), secondPdf.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('assigns separate version numbers to concurrent uploads', async () => {
  const created = await request(documentsPath(), { body: fileForm(firstPdf) });
  const history = created.headers.get('location').split('?')[0];
  const appended = await Promise.all([
    request(history, { body: fileForm(firstPdf, 'concurrent-a.pdf') }),
    request(history, { body: fileForm(secondPdf, 'concurrent-b.pdf') }),
  ]);
  assert.deepEqual(appended.map((response) => response.status), [303, 303]);
  const downloads = await Promise.all([request(history + '/versions/2'), request(history + '/versions/3')]);
  assert.ok(downloads.every((response) => response.status === 200));
  const payloads = await Promise.all(downloads.map(async (response) => Buffer.from(await response.arrayBuffer())));
  assert.ok(payloads.some((payload) => payload.equals(firstPdf)));
  assert.ok(payloads.some((payload) => payload.equals(secondPdf)));
});

test('rejects other accounts, unrelated projects and anonymous document requests', async () => {
  const created = await request(documentsPath(), { body: fileForm(firstPdf) });
  assert.equal(created.status, 303);
  const history = created.headers.get('location').split('?')[0];
  const id = history.split('/').at(-1);
  for (const path of [documentsPath(), history, history + '/versions/1']) {
    assert.equal((await request(path, { cookie: bobCookie })).status, 404);
    const anonymous = await request(path, { cookie: null });
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get('location'), '/login?lang=ar');
  }
  for (const path of [documentsPath(), history]) {
    assert.equal((await request(path, { cookie: bobCookie, body: fileForm(secondPdf) })).status, 404);
  }
  assert.equal((await request(documentsPath(secondProject) + '/' + id + '/versions/1', { cookie: bobCookie })).status, 404);
  assert.equal((await request(history + '/delete', {
    cookie: bobCookie, body: new URLSearchParams({ confirm: 'yes' }),
  })).status, 404);
  assert.equal((await request(history + '/versions/2')).status, 404);
  assert.equal((await request(history + '/versions/1')).status, 200);
});

test('rejects malformed, oversized and foreign-origin uploads without creating versions', async () => {
  const root = documentsPath(secondProject);
  const badPdf = await request(root, { cookie: bobCookie, body: fileForm(Buffer.from('plain text')) });
  assert.equal(badPdf.status, 422);
  assert.match(await badPdf.text(), /توقيع صالح/);
  assert.equal((await request(root, { cookie: bobCookie, body: fileForm(firstPdf, 'study.txt') })).status, 422);
  const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
  assert.equal((await request(root, { cookie: bobCookie, body: fileForm(huge) })).status, 413);
  assert.equal((await request(root, { cookie: bobCookie, body: new URLSearchParams({ pdf: 'text' }) })).status, 415);
  assert.equal((await request(root, { cookie: bobCookie, body: fileForm(firstPdf), source: 'https://somewhere.example' })).status, 403);
  const unsupported = await request(root, { cookie: bobCookie, method: 'PUT', body: fileForm(firstPdf) });
  assert.equal(unsupported.status, 405);
  const empty = await request(root, { cookie: bobCookie });
  assert.match(await empty.text(), /لم تُضف ملفات PDF/);
});

test('removes every version when the owner deletes a document or its parent project', async () => {
  const ownerId = store.credentials(alice).id;
  const project = store.createProject(ownerId, { title: 'Delete fixtures', description: '' });
  const start = await request(documentsPath(project), { body: fileForm(firstPdf) });
  const history = start.headers.get('location').split('?')[0];
  const id = history.split('/').at(-1);
  assert.equal((await request(history, { body: fileForm(secondPdf) })).status, 303);
  assert.equal((await request(history + '/delete', { body: new URLSearchParams() })).status, 400);
  assert.equal((await request(history + '/delete', { body: new URLSearchParams({ confirm: 'yes' }) })).status, 303);
  assert.equal((await request(history + '/versions/1')).status, 404);
  assert.deepEqual(store.documents.versions(ownerId, project, id), []);
  const again = await request(documentsPath(project), { body: fileForm(firstPdf) });
  const secondHistory = again.headers.get('location').split('?')[0];
  assert.ok(store.deleteProject(ownerId, project));
  assert.equal((await request(secondHistory + '/versions/1')).status, 404);
  assert.deepEqual(store.documents.list(ownerId, project), []);
});

test('migrates a P1a database and persists encrypted files across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-document-encryption-'));
  const path = join(directory, 'workspace.sqlite');
  const keyPath = path + '.key';
  try {
    let local = openWorkspaceStore(path);
    local.addAccount(alice, credentials);
    const owner = local.credentials(alice).id;
    const project = local.createProject(owner, { title: 'Existing project', description: 'P1a fixture' });
    local.close();

    // Reconstruct the pre-document schema while preserving real P1a rows.
    let db = new DatabaseSync(path);
    db.exec(`
      DROP TABLE project_references;
      DROP TABLE reference_cache;
      DROP TABLE document_versions;
      DROP TABLE documents;
      DROP TABLE document_key;
      DROP TABLE lesson_progress;
      DROP TABLE project_share_events;
      DROP TABLE project_shares;
      DROP TABLE security_events;
      DROP TABLE observatory_updates;
      DROP TABLE observatory_topics;
      DROP TABLE researcher_request_events;
      DROP TABLE researcher_links;
      DROP TABLE researcher_profiles;
      DROP TABLE economic_scenarios;
      DROP TABLE readiness_revisions;
      DROP TABLE evidence_items;
      DROP TABLE claims;
      PRAGMA user_version = 1;
    `);
    db.close();
    await rm(keyPath);
    local = openWorkspaceStore(path);
    let id;
    try {
      assert.equal(local.getProject(owner, project).description, 'P1a fixture');
      id = local.documents.create(owner, project, { name: 'persistent.pdf', bytes: firstPdf });
    } finally {
      local.close();
    }
    const databaseBytes = await readFile(path);
    assert.equal(databaseBytes.includes(firstPdf), false);
    assert.equal(databaseBytes.includes(Buffer.from('%PDF-1.4')), false);
    if (process.platform !== 'win32') assert.equal((await stat(keyPath)).mode & 0o077, 0);
    local = openWorkspaceStore(path);
    try {
      assert.deepEqual(local.documents.download(owner, project, id, 1).bytes, firstPdf);
    } finally {
      local.close();
    }

    await rename(keyPath, keyPath + '.saved');
    assert.throws(() => openWorkspaceStore(path), /encryption key file is missing/);
    await assert.rejects(stat(keyPath), { code: 'ENOENT' });
    await writeFile(keyPath, randomBytes(32), { mode: 0o600 });
    assert.throws(() => openWorkspaceStore(path), /does not match this database/);
    await rm(keyPath);
    await rename(keyPath + '.saved', keyPath);

    db = new DatabaseSync(path);
    db.prepare('UPDATE document_versions SET tag = zeroblob(16) WHERE document_id = ?').run(id);
    db.close();
    local = openWorkspaceStore(path);
    try {
      assert.throws(() => local.documents.download(owner, project, id, 1));
    } finally {
      local.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
