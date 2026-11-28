import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { totp } from '../src/mfa.js';
import { hashPassword } from '../src/password.js';
import { backupWorkspace, restoreWorkspace } from '../src/recovery.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('reauthenticates private exports and deletion, isolates accounts, and preserves backup semantics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-privacy-'));
  const database = join(directory, 'live.sqlite');
  const now = 1_800_000_000_000;
  const store = openWorkspaceStore(database, () => now);
  const email = 'owner@privacy.test';
  const peerEmail = 'peer@privacy.test';
  const password = 'fixture password for privacy';
  const credentials = await hashPassword(password);
  store.addAccount(email, credentials);
  store.addAccount(peerEmail, credentials);
  const owner = store.credentials(email).id;
  const peer = store.credentials(peerEmail).id;
  const token = store.newSession(owner);
  const peerToken = store.newSession(peer);
  const project = store.createProject(owner, { title: 'Owner project', description: '' });
  const other = store.createProject(peer, { title: 'Other private project', description: '' });
  const pdf = Buffer.from('%PDF-1.4\nPrivate fixture');
  const document = store.documents.create(owner, project, { name: 'Study.pdf', bytes: pdf });
  const collection = store.organization.create(owner, 'Study materials');
  assert.ok(store.organization.membership(owner, project, document, collection, true));
  assert.ok(store.organization.addMark(owner, project, document, { version: 1, page: 1, kind: 'annotation', text: 'Private reading note' }));
  const key = 'mock-secret-api-key';
  store.assistantSettings.save(owner, 'openai', 'fixture', key);
  for (const id of [owner, peer]) store.network.save(id, { name: id, interests: '', orcid: '', discoverable: true });
  store.network.interact(owner, peer, 'request');
  store.network.interact(peer, owner, 'accept');
  const conversation = store.messages.open(owner, peer);
  store.messages.send(owner, conversation, 'Owner sent message');
  store.messages.send(peer, conversation, 'Peer private message');

  store.mfa.begin(owner);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...store.mfa.pending(owner)].map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
  const secret = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const recovery = store.mfa.confirm(owner, totp(secret, now / 30_000), token);
  const secondSession = store.newSession(owner);
  const before = join(directory, 'before');
  await backupWorkspace(database, before);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  try {
    const origin = 'http://127.0.0.1:' + app.address().port;
    const url = origin + '/workspace/settings/privacy?lang=en';
    const post = (fields, { session = token, source = origin } = {}) => fetch(url, {
      method: 'POST', redirect: 'manual', headers: { cookie: 'nri_session=' + session, origin: source },
      body: new URLSearchParams({ password, ...fields }),
    });
    assert.equal((await post({ intent: 'delete', confirm: 'DELETE' }, { source: 'https://foreign.test' })).status, 403);
    assert.equal((await post({ intent: 'delete', confirm: 'yes' })).status, 422);
    assert.equal((await post({ intent: 'delete', confirm: 'DELETE' })).status, 401);
    const exported = await post({ intent: 'export', code: recovery[0], account: peer });
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('cache-control'), 'no-store');
    assert.match(exported.headers.get('content-disposition'), /attachment/);
    const text = await exported.text();
    assert.doesNotMatch(text, /Other private project|Peer private message|mock-secret-api-key|password|nonce|ciphertext/);
    const record = JSON.parse(text);
    assert.equal(record.account.email, email);
    assert.deepEqual(Buffer.from(record.documents[0].content, 'base64'), pdf);
    assert.equal(record.readingMarks[0].text, 'Private reading note');
    assert.equal(record.collections[0].name, 'Study materials');
    assert.equal(record.sentMessages[0].text, 'Owner sent message');
    assert.equal((await post({ intent: 'delete', confirm: 'DELETE', code: recovery[0] })).status, 401);
    const deleted = await post({ intent: 'delete', confirm: 'DELETE', code: recovery[1], account: peer });
    assert.equal(deleted.status, 303);
    assert.match(deleted.headers.get('set-cookie'), /Max-Age=0/);
    for (const session of [token, secondSession]) assert.equal(store.session(session), undefined);
    assert.equal(store.credentials(email), undefined);
    assert.equal(store.mfa.enabled(owner), false);
    assert.equal(store.assistantSettings.configuration(owner), undefined);
    assert.equal(store.documents.download(owner, project, document, 1), undefined);
    assert.equal(store.messages.thread(peer, conversation), undefined);
    assert.equal(store.organization.collection(owner, collection, 0), undefined);
    assert.equal(store.getProject(peer, other).title, 'Other private project');
    assert.ok(store.session(peerToken));

    const after = join(directory, 'after');
    await backupWorkspace(database, after);
    for (const [bundle, present] of [[before, true], [after, false]]) {
      const copy = openWorkspaceStore(await restoreWorkspace(bundle, bundle + '-restored'));
      try {
        assert.equal(Boolean(copy.credentials(email)), present);
        assert.equal(Boolean(copy.documents.download(owner, project, document, 1)), present);
        assert.equal(copy.session(token), undefined);
        assert.equal(copy.session(peerToken), undefined);
      } finally {
        copy.close();
      }
    }
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
