import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('requires explicit scoped project consent and revokes access on a block', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  const [owner, reader, stranger] = ['owner', 'reader', 'stranger'].map((name) => {
    const email = name + '@example.test';
    store.addAccount(email, credentials);
    const id = store.credentials(email).id;
    store.network.save(id, { name, interests: '', orcid: '', discoverable: true });
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const project = store.createProject(owner.id, { title: 'Project title', description: 'Private project summary' });
  const document = store.documents.create(owner.id, project, { name: 'Private methods PDF', bytes: Buffer.from('%PDF-1.4') });
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const root = '/workspace/projects/' + project;
  const manage = root + '/sharing';
  const share = '/workspace/shared-projects/' + project;
  const inbox = '/workspace/project-invitations';
  const get = (path, user) => fetch(origin + path + '?lang=en', { redirect: 'manual', headers: { cookie: user.cookie } });
  const post = (path, user, fields) => fetch(origin + path + '?lang=en', {
    method: 'POST', redirect: 'manual', headers: { cookie: user.cookie, origin }, body: new URLSearchParams(fields),
  });
  try {
    assert.equal((await post(manage, stranger, { intent: 'invite', peer: reader.id })).status, 404);
    assert.equal((await post(manage, owner, { intent: 'invite', peer: reader.id })).status, 303);
    assert.equal((await get(share, reader)).status, 404);
    assert.equal((await post(inbox, stranger, { intent: 'accept', project })).status, 422);
    assert.equal((await post(inbox, reader, { intent: 'accept', project })).status, 303);
    assert.match(await (await get(share, reader)).text(), /Private project summary/);
    assert.equal((await get(root + '/documents/' + document, reader)).status, 404);
    assert.equal((await get(root + '/references', reader)).status, 404);
    assert.equal((await get(root + '/reports', reader)).status, 404);
    assert.equal((await get(share, stranger)).status, 404);
    assert.equal((await post(manage, owner, { intent: 'revoke', peer: reader.id })).status, 303);
    assert.equal((await get(share, reader)).status, 404);
    assert.equal((await post(manage, owner, { intent: 'invite', peer: reader.id })).status, 303);
    assert.equal((await post(inbox, reader, { intent: 'accept', project })).status, 303);
    assert.equal((await post('/workspace/network', reader, { intent: 'block', peer: owner.id })).status, 303);
    assert.equal((await post('/workspace/network', reader, { intent: 'unblock', peer: owner.id })).status, 303);
    assert.equal((await get(share, reader)).status, 404);
    assert.match(await (await get(manage, owner)).text(), /Access history/);
    assert.equal(store.sharing.history(owner.id, project)[0].state, 'revoked');
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
