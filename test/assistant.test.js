import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('reviews bounded, account-scoped source snapshots with provider-specific warnings', async (t) => {
  const store = openWorkspaceStore();
  const credentials = { salt: Buffer.alloc(16), hash: Buffer.alloc(32) };
  const users = ['owner', 'other'].map((name) => {
    const email = name + '@example.test';
    store.addAccount(email, credentials);
    const { id } = store.credentials(email);
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const [owner, other] = users;
  const project = store.createProject(owner.id, { title: 'Private source review', description: '' });
  const save = (doi, provider, metadata) => store.references.save(owner.id, project, {
    doi, provider, status: metadata ? 'found' : 'not-found',
    checkedAt: Date.UTC(2026, 10, 26), metadata,
  });
  save('10.0000/alpha', 'openalex', { title: '<script>Alpha</script>', isRetracted: false });
  save('10.0000/alpha', 'crossref', { title: 'Alpha', updatedBy: [{ type: 'retraction' }] });
  save('10.0000/correction', 'crossref', { title: 'Correction', updatedBy: [{ type: 'correction' }] });
  save('10.0000/notice', 'crossref', { title: 'Retraction notice', updates: [{ type: 'retraction' }] });
  save('10.0000/missing', 'crossref', null);
  for (let i = 0; i < 13; i += 1) save('10.0000/extra-' + i, 'zenodo', { title: 'Extra record' });

  const app = createApp(store);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/assistant?lang=en&project=' + project;
  const get = (cookie = '', filter = '') => fetch(url + filter, { headers: { cookie }, redirect: 'manual' });

  assert.equal((await get()).headers.get('location'), '/login?lang=en');
  const denied = await get(other.cookie);
  assert.equal(denied.status, 404);
  assert.doesNotMatch(await denied.text(), /Alpha|Private source review/);

  const response = await get(owner.cookie, '&q=alpha');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.match(body, /&lt;script&gt;Alpha&lt;\/script&gt;/);
  assert.match(body, /Provider flagged a retraction/);
  assert.match(body, /Retraction status remains unverified/);
  assert.doesNotMatch(body, /<script>|Extra record/);
  const notice = await (await get(owner.cookie, '&q=notice')).text();
  assert.match(notice, /Provider recorded an editorial update/);
  assert.doesNotMatch(notice, /Provider flagged a retraction/);
  assert.match(await (await get(owner.cookie, '&q=correction')).text(), /Provider recorded an editorial update/);
  assert.match(await (await get(owner.cookie, '&q=missing')).text(), /Provider did not find this reference/);
  const bounded = await (await get(owner.cookie, '&q=extra')).text();
  assert.equal(bounded.match(/<strong dir="auto">Extra record<\/strong>/g).length, 12);
  assert.match(bounded, /Showing the first 12/);
  const arabic = await fetch(url.replace('lang=en', 'lang=ar'), { headers: { cookie: owner.cookie } });
  assert.match(await arabic.text(), /lang="ar" dir="rtl"/);
  assert.equal((await fetch(url, { method: 'POST', headers: { cookie: owner.cookie, origin } })).status, 405);
});
