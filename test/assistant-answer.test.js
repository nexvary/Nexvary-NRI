import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAssistantProvider } from '../src/assistant-provider.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('local Assistant scopes input, verifies citations, escapes output and cancels pending work', async (t) => {
  const store = openWorkspaceStore();
  const [owner, other] = ['owner@local.test', 'other@local.test'].map((email) => {
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const { id } = store.credentials(email);
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const project = store.createProject(owner.id, { title: 'Private project name', description: 'Private unpublished notes' });
  for (const [doi, isRetracted] of [['10.0000/cited', false], ['10.0000/retracted', true]]) {
    store.references.save(owner.id, project, {
      doi, provider: 'openalex', checkedAt: 1, status: 'found', metadata: { title: doi, isRetracted },
    });
  }
  let calls = 0;
  const inFlight = Promise.withResolvers();
  const assistantProvider = createAssistantProvider({
    localPort: '12345',
    async fetchImpl(url, options) {
      calls++;
      assert.equal(url, 'http://127.0.0.1:12345/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      assert.doesNotMatch(options.body, /Private unpublished notes|Private project name|10\.0000\/retracted/);
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'example-local-model');
      assert.equal(payload.max_tokens, 512);
      const { sources, question } = JSON.parse(payload.messages[1].content);
      assert.deepEqual(sources.map(({ id, identifier }) => [id, identifier]), [['S1', '10.0000/cited']]);
      if (question === 'Cancel this') {
        inFlight.resolve();
        await once(options.signal, 'abort');
        options.signal.throwIfAborted();
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify({ claims: [
        { text: 'Cited <script>statement</script>', citations: ['S1'] },
        { text: 'Unknown source', citations: ['S999'] },
      ] }) } }] });
    },
  });
  const app = createApp(store, { assistantProvider });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const request = (user, values, lang = 'en') => fetch(origin + '/workspace/assistant/answer?lang=' + lang, {
    method: 'POST', body: new URLSearchParams({ project, ...values }), headers: { cookie: user.cookie, origin },
  });
  assert.equal((await request(owner, { question: 'Offline' })).status, 422);
  assert.equal(calls, 0);
  store.assistantSettings.save(owner.id, 'local', 'example-local-model', '');
  assert.equal((await request(other, { question: 'Another account' })).status, 404);
  assert.equal(calls, 0);
  const answer = await request(owner, { question: 'Summarize' });
  assert.equal(answer.status, 200);
  const html = await answer.text();
  assert.match(html, /Cited &lt;script&gt;statement&lt;\/script&gt;/);
  assert.match(html, /Unsupported citation/);
  assert.match(html, /10\.0000\/cited/);
  assert.doesNotMatch(html, /S999|10\.0000\/retracted/);
  assert.equal((await request(owner, { question: 'Summarize' })).status, 200);
  assert.equal(calls, 1);
  const pending = request(owner, { question: 'Cancel this' }, 'ar');
  await inFlight.promise;
  assert.equal((await request(other, { intent: 'cancel' })).status, 404);
  assert.equal((await request(owner, { intent: 'cancel' })).status, 204);
  const cancelled = await pending;
  assert.equal(cancelled.status, 409);
  assert.match(await cancelled.text(), /أُلغي الطلب/);
});
