import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('migrates v4, links a saved source to a claim, records human review and exports only to the owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-evidence-'));
  const dbPath = join(directory, 'workspace.sqlite');
  const ownerEmail = 'evidence-owner@example.test';
  const otherEmail = 'evidence-other@example.test';
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  const doi = '10.5555/evidence-fixture';
  const checkedAt = Date.UTC(2026, 10, 26);
  try {
    const legacy = openWorkspaceStore(dbPath);
    legacy.addAccount(ownerEmail, credentials);
    legacy.addAccount(otherEmail, credentials);
    const owner = legacy.credentials(ownerEmail).id;
    const other = legacy.credentials(otherEmail).id;
    const project = legacy.createProject(owner, { title: 'Evidence fixture', description: '' });
    const unrelated = legacy.createProject(owner, { title: 'Unrelated project', description: '' });
    legacy.references.save(owner, project, {
      doi, provider: 'crossref', status: 'found', checkedAt, metadata: { title: 'Synthetic source' },
    }, true);
    legacy.close();
    const raw = new DatabaseSync(dbPath);
    raw.exec(`DROP TABLE lesson_progress;
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
      ALTER TABLE license_assignments DROP COLUMN state;
      PRAGMA user_version = 4;`);
    raw.close();
    const store = openWorkspaceStore(dbPath);
    const ownerCookie = 'nri_session=' + store.newSession(owner);
    const otherCookie = 'nri_session=' + store.newSession(other);
    const app = createApp(store);
    app.listen(0, '127.0.0.1');
    await new Promise((resolve) => app.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + app.address().port;
    const root = (id) => origin + '/workspace/projects/' + id + '/evidence';
    const write = (id, body, cookie = ownerCookie) => fetch(root(id) + '?lang=en', {
      method: 'POST', redirect: 'manual', headers: { cookie, origin }, body: new URLSearchParams(body),
    });
    const matrix = async () => (await fetch(root(project) + '/export', { headers: { cookie: ownerCookie } })).json();
    try {
      assert.equal((await write(project, { intent: 'claim', statement: 'Synthetic scientific claim' }, otherCookie)).status, 404);
      assert.equal((await write(project, { intent: 'claim', statement: 'Synthetic scientific claim' })).status, 303);
      const claim = (await matrix()).claims[0];
      const link = {
        intent: 'link', claim: claim.id, source: 'crossref:' + doi,
        relation: 'conflicts', studyType: 'Synthetic observational study', limitations: 'Limited sample.',
      };
      assert.equal((await write(unrelated, link)).status, 422);
      assert.equal((await write(project, link)).status, 303);
      assert.equal((await write(project, link)).status, 422);
      const item = (await matrix()).claims[0].evidence[0];
      assert.equal(item.source.retrievedAt, checkedAt);
      assert.equal(item.source.metadata.title, 'Synthetic source');
      assert.equal(item.review, null);
      const review = { intent: 'review', item: item.id, decision: 'accepted', note: 'Preserve the conflict.' };
      assert.equal((await write(project, review, otherCookie)).status, 404);
      assert.equal((await write(project, review)).status, 303);
      assert.equal((await write(project, { ...review, decision: 'rejected' })).status, 422);
      store.references.remove(owner, project, doi, 'crossref');
      const saved = (await matrix()).claims[0].evidence[0];
      assert.equal(saved.source.identifier, doi);
      assert.equal(saved.review.reviewer, owner);
      assert.equal(saved.review.decision, 'accepted');
      assert.equal(saved.relation, 'conflicts');
      const privateExport = await fetch(root(project) + '/export', { headers: { cookie: otherCookie } });
      assert.equal(privateExport.status, 404);
      const page = await (await fetch(root(project) + '?lang=ar', { headers: { cookie: ownerCookie } })).text();
      assert.match(page, /dir="rtl"/);
      assert.match(page, /قُبل ربط الدليل/);
    } finally {
      await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
