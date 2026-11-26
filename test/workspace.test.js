import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hashPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore, sessionLifetime } from '../src/store.js';

const password = 'Fixture password for local tests only';
const alice = 'alice@example.test';
const bob = 'bob@example.test';
let credentials;
let app;
let origin;

before(async () => {
  credentials = await hashPassword(password);
  const store = openWorkspaceStore();
  store.addAccount(alice, credentials);
  store.addAccount(bob, await hashPassword(password));
  app = createApp(store);
  await new Promise((resolve, reject) => app.once('error', reject).listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${app.address().port}`;
});

after(() => new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())));

function get(path, cookie) {
  return fetch(origin + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
}

function post(path, fields, cookie, source = origin) {
  return fetch(origin + path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...(source ? { Origin: source } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });
}

async function signIn(email, oldCookie) {
  const response = await post('/login?lang=en', { email, password }, oldCookie);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/workspace?lang=en');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  return cookie.split(';', 1)[0];
}

test('requires a session and serves a localized login with generic credential errors', async () => {
  const unauthenticated = await get('/workspace');
  assert.equal(unauthenticated.status, 303);
  assert.equal(unauthenticated.headers.get('location'), '/login?lang=ar');
  const login = await get('/login?lang=ar');
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const html = await login.text();
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /href="\/login\?lang=en" hreflang="en"/);
  for (const email of [alice, 'unknown@example.test']) {
    const denied = await post('/login?lang=en', { email, password: 'incorrect' });
    assert.equal(denied.status, 401);
    assert.match(await denied.text(), /email address or password is incorrect/);
    assert.equal(denied.headers.get('set-cookie'), null);
  }
});

test('manages projects and denies reading, editing or deleting across account boundaries', async () => {
  const ownerCookie = await signIn(alice);
  const otherCookie = await signIn(bob);
  const title = 'تجربة & <em>مشروع</em>';
  const escapedTitle = 'تجربة &amp; &lt;em&gt;مشروع&lt;/em&gt;';
  const description = 'Synthetic greenhouse feasibility notes.';
  const created = await post('/workspace?lang=ar', { title, description }, ownerCookie);
  assert.equal(created.status, 303);
  const project = created.headers.get('location');
  assert.match(project, /^\/workspace\/projects\/[0-9a-f-]{36}\?lang=ar$/);
  const remove = project.replace('?', '/delete?');
  const ownerList = await get('/workspace?lang=ar', ownerCookie);
  assert.equal(ownerList.status, 200);
  assert.ok((await ownerList.text()).includes(escapedTitle));
  const ownerPage = await get(project, ownerCookie);
  assert.equal(ownerPage.status, 200);
  assert.equal(ownerPage.headers.get('cache-control'), 'no-store');
  const ownerHtml = await ownerPage.text();
  assert.ok(ownerHtml.includes(description));
  assert.ok(ownerHtml.includes(escapedTitle));
  assert.doesNotMatch(ownerHtml, /<em>مشروع<\/em>/);
  assert.ok(ownerHtml.includes(project.replace('lang=ar', 'lang=en')));

  const otherList = await get('/workspace?lang=ar', otherCookie);
  assert.doesNotMatch(await otherList.text(), /مشروع<\/em>|greenhouse|&lt;em&gt;/);
  const look = await get(project, otherCookie);
  assert.equal(look.status, 404);
  assert.doesNotMatch(await look.text(), /greenhouse/);
  assert.equal((await post(project, { title: 'Replacement' }, otherCookie)).status, 404);
  assert.equal((await post(remove, { confirm: 'yes' }, otherCookie)).status, 404);
  assert.equal((await get(project)).status, 303);

  const edited = await post(project, { title: 'Updated research', description }, ownerCookie);
  assert.equal(edited.status, 303);
  assert.match(await (await get(project, ownerCookie)).text(), /Updated research/);
  assert.equal((await post(remove, {}, ownerCookie)).status, 400);
  assert.equal((await post(remove, { confirm: 'yes' }, ownerCookie)).status, 303);
  assert.equal((await get(project, ownerCookie)).status, 404);
});

test('rejects foreign or absent origins, unsupported forms and invalid data', async () => {
  const cookie = await signIn(alice);
  for (const source of ['', 'https://different.example.test']) {
    const rejected = await post('/workspace?lang=en', { title: 'Denied' }, cookie, source);
    assert.equal(rejected.status, 403);
  }
  const unsupported = await fetch(origin + '/workspace?lang=en', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unsupported.status, 415);
  const oversized = await post('/workspace?lang=en', { title: 'Title', description: 'x'.repeat(30_000) }, cookie);
  assert.equal(oversized.status, 413);
  const invalid = await post('/workspace?lang=en', { title: '   ' }, cookie);
  assert.equal(invalid.status, 422);
  assert.match(await invalid.text(), /Enter a title/);
  assert.equal((await get('/logout?lang=en', cookie)).status, 405);
});

test('rotates sessions on login and revokes the active session on logout', async () => {
  const oldCookie = await signIn(alice);
  const newCookie = await signIn(alice, oldCookie);
  assert.notEqual(oldCookie, newCookie);
  assert.equal((await get('/workspace?lang=en', oldCookie)).status, 303);
  assert.equal((await get('/workspace?lang=en', newCookie)).status, 200);
  const logout = await post('/logout?lang=en', {}, newCookie);
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get('/workspace?lang=en', newCookie)).status, 303);
});

test('applies a bounded login attempt window', async () => {
  const store = openWorkspaceStore();
  store.addAccount(alice, credentials);
  const isolated = createApp(store);
  try {
    await new Promise((resolve, reject) => isolated.once('error', reject).listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${isolated.address().port}`;
    const attemptLogin = (submittedPassword) => fetch(address + '/login?lang=en', {
      method: 'POST',
      redirect: 'manual',
      headers: { Origin: address },
      body: new URLSearchParams({ email: alice, password: submittedPassword }),
    });
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.equal((await attemptLogin('incorrect')).status, 401);
    }
    const limited = await attemptLogin(password);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(limited.headers.get('set-cookie'), null);
  } finally {
    await new Promise((resolve, reject) => isolated.close((error) => error ? reject(error) : resolve()));
  }
});

test('reopens a migrated store with data and rejects sessions at expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-workspace-test-'));
  const path = join(directory, 'private', 'workspace.sqlite');
  let currentTime = Date.now();
  let store = openWorkspaceStore(path, () => currentTime);
  try {
    store.addAccount(alice, credentials);
    const owner = store.credentials(alice).id;
    const id = store.createProject(owner, { title: 'Persisted project', description: '' });
    const session = store.newSession(owner);
    store.close();
    store = openWorkspaceStore(path, () => currentTime);
    assert.equal(store.getProject(owner, id).title, 'Persisted project');
    assert.equal(store.session(session).id, owner);
    currentTime += sessionLifetime * 1000;
    assert.equal(store.session(session), undefined);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o077, 0);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
