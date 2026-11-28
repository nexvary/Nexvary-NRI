import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('persists private Assistant settings, encrypts BYOK, and supports offline reset without calling providers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-byok-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'workspace.sqlite');
  const store = openWorkspaceStore(path);
  const [owner, other] = ['owner@example.test', 'other@example.test'].map((email) => {
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const { id } = store.credentials(email);
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const app = createApp(store);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  try {
    const origin = 'http://127.0.0.1:' + app.address().port;
    const url = origin + '/workspace/assistant/settings?lang=en';
    const key = 'mock-provider-key-never-sent';
    const post = (user, settings, source = origin) => fetch(url, {
      method: 'POST', headers: { cookie: user.cookie, origin: source },
      body: new URLSearchParams(settings), redirect: 'manual',
    });
    const get = (user, lang = 'en') => fetch(url.replace('lang=en', 'lang=' + lang), {
      headers: { cookie: user?.cookie ?? '' }, redirect: 'manual',
    });
    assert.equal((await get()).status, 303);
    assert.equal((await post(owner, { provider: 'openai', model: 'model-a' })).status, 422);
    assert.equal((await post(owner, { provider: 'openai', model: 'model-a', 'api-key': key }, 'https://foreign.example')).status, 403);
    assert.equal((await post(owner, { provider: 'openai', model: 'model-a', 'api-key': key })).status, 303);
    const settings = await get(owner);
    assert.equal(settings.headers.get('cache-control'), 'no-store');
    const html = await settings.text();
    assert.match(html, /Key stored/);
    assert.doesNotMatch(html, new RegExp(key));
    assert.match(await (await get(owner, 'ar')).text(), /المفتاح محفوظ/);
    assert.match(await (await get(other)).text(), /No API key stored/);
    assert.equal((await post(owner, { provider: 'openai', model: 'model-b' })).status, 303);
    assert.deepEqual(store.assistantSettings.configuration(owner.id), { provider: 'openai', model: 'model-b', apiKey: key });
    assert.equal((await post(other, { provider: 'local', model: 'local-model' })).status, 303);
    assert.equal((await post(other, { provider: 'offline' })).status, 303);
    assert.equal(store.assistantSettings.configuration(other.id), undefined);
    assert.ok(!(await readFile(path)).includes(Buffer.from(key)));
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
  const reopened = openWorkspaceStore(path);
  try {
    assert.equal(reopened.assistantSettings.configuration(owner.id).apiKey, 'mock-provider-key-never-sent');
    assert.equal(reopened.assistantSettings.save(owner.id, 'offline', '', ''), true);
    assert.equal(reopened.assistantSettings.configuration(owner.id), undefined);
  } finally {
    reopened.close();
  }
});
