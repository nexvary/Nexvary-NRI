import { buildReport } from '../src/reports.js';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { readinessState } from '../src/readiness.js';
import { openWorkspaceStore } from '../src/store.js';

test('blocks L-READY on safety or authorization before evaluating evidence gaps', () => {
  const dimensions = [...'LREADY'].map((letter) => ({ letter, level: 'integrated' }));
  assert.equal(readinessState({ dimensions, safety: 'unsafe', authorization: 'documented' }), 'blocked');
  assert.equal(readinessState({ dimensions, safety: 'documented', authorization: 'missing' }), 'blocked');
  assert.equal(readinessState({ dimensions, safety: 'documented', authorization: 'documented' }), 'recorded');
  dimensions[0].level = 'unavailable';
  assert.equal(readinessState({ dimensions, safety: 'documented', authorization: 'documented' }), 'gaps');
});

test('records a private six-dimension L-READY assessment and preserves revisions', async () => {
  const store = openWorkspaceStore();
  const creds = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('assessor@example.test', creds);
  store.addAccount('other@example.test', creds);
  const owner = store.credentials('assessor@example.test').id;
  const other = store.credentials('other@example.test').id;
  const project = store.createProject(owner, { title: 'Readiness fixture', description: '' });
  const ownerCookie = 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/projects/' + project + '/readiness?lang=en';
  const fields = {
    intendedUse: 'Illustrative use case', safety: 'unresolved', authorization: 'missing',
    ...Object.fromEntries([...'LREADY'].flatMap((letter) => [
      [letter + '-level', 'unavailable'], [letter + '-limits', 'Evidence missing'],
    ])),
  };
  const submit = (data, cookie = ownerCookie) => fetch(url, {
    method: 'POST', redirect: 'manual', headers: { cookie, origin }, body: new URLSearchParams(data),
  });
  try {
    assert.equal((await submit(fields, otherCookie)).status, 404);
    assert.equal((await submit({ ...fields, 'L-level': 'integrated' })).status, 422);
    assert.equal((await submit(fields)).status, 303);
    const [first] = store.readiness.list(owner, project);
    assert.deepEqual(first.dimensions.map((row) => row.letter), [...'LREADY']);
    assert.equal(first.reviewer, owner);
    const doi = '10.0000/readiness';
    store.references.save(owner, project, {
      doi, provider: 'crossref', checkedAt: 42, status: 'found', metadata: { title: 'Readiness source' },
    });
    store.evidence.addClaim(owner, project, 'Fixture readiness claim');
    const [claim] = store.evidence.list(owner, project);
    store.evidence.link(owner, project, {
      claim: claim.id, doi, provider: 'crossref', relation: 'supports', studyType: '', limitations: 'Limited scope',
    });
    const [source] = store.evidence.list(owner, project)[0].evidence;
    const categories = { 'L-level': 'preliminary', 'R-level': 'independent', 'E-level': 'integrated' };
    const sources = { 'L-source': source.id, 'R-source': source.id, 'E-source': source.id };
    const revise = {
      ...fields, ...categories, ...sources, id: first.id, revision: first.revision,
      authorization: 'documented', safety: 'documented',
    };
    assert.equal((await submit(revise)).status, 422);
    store.evidence.review(owner, project, { item: source.id, decision: 'accepted', note: 'Reviewed for the fixture' });
    assert.equal((await submit(revise)).status, 303);
    assert.equal((await submit(revise)).status, 422);
    const [current, original] = store.readiness.list(owner, project);
    assert.equal(original.revision, first.revision);
    assert.deepEqual(current.dimensions.map(({ level }) => level),
      ['preliminary', 'independent', 'integrated', 'unavailable', 'unavailable', 'unavailable']);
    assert.equal(current.dimensions[0].evidence.source.identifier, doi);
    assert.equal(current.dimensions[0].limits, 'Evidence missing');
    const page = await (await fetch(url, { headers: { cookie: ownerCookie } })).text();
    assert.match(page, /Evidence gaps remain/);
    assert.match(page, /Assessment blocked by safety or authorization/);
    assert.match(page, /Revision history/);
    assert.match(page, /https:\/\/doi\.org\/10\.0000\/readiness/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});


test('binds independent readiness review to a current project revision and exports it', () => {
  const store = openWorkspaceStore();
  try {
    const accounts = ['owner', 'reviewer', 'outsider'].map((name) => {
      const email = name + '@readiness.test';
      store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
      return store.credentials(email).id;
    });
    const [owner, reviewer, outsider] = accounts;
    const project = store.createProject(owner, { title: 'Independent review', description: '' });
    const assessment = {
      intendedUse: 'Fixture use', dimensions: [...'LREADY'].map((letter) => ({ letter, level: 'unavailable', limits: 'Evidence missing' })),
      safety: 'unresolved', authorization: 'missing',
    };
    assert.equal(store.readiness.save(owner, project, assessment), true);
    const [first] = store.readiness.list(owner, project);
    store.network.save(reviewer, { name: 'Fixture reviewer', interests: '', orcid: '', discoverable: true });
    assert.equal(store.teams.grant(owner, project, reviewer, 'reviewer'), true);
    const [invitation] = store.teams.inbox(reviewer);
    assert.equal(store.teams.decide(reviewer, project, 'reviewer', invitation.invitation, 'accepted'), true);
    const input = { revision: first.revision, decision: 'changes-requested', note: 'Verify safety evidence', independence: 'declared' };
    assert.equal(store.teams.reviewReadiness(owner, project, input), 403);
    assert.equal(store.teams.reviewReadiness(outsider, project, input), 403);
    assert.equal(store.teams.reviewReadiness(reviewer, project, { ...input, independence: '' }), 422);
    assert.equal(store.teams.reviewReadiness(reviewer, project, input), 303);
    assert.equal(store.teams.reviewReadiness(reviewer, project, input), 409);
    const report = buildReport(store, owner, store.getProject(owner, project), 'en', 'test');
    assert.match(JSON.stringify(report), /Verify safety evidence/);
    assert.equal(store.readiness.reviews(outsider, project).length, 0);
    assert.equal(store.readiness.save(owner, project, { ...assessment, id: first.id, revision: first.revision }), true);
    assert.equal(store.teams.reviewReadiness(reviewer, project, input), 409);
    assert.equal(store.teams.revoke(owner, project, reviewer), true);
    const [current] = store.readiness.list(owner, project);
    assert.equal(store.teams.reviewReadiness(reviewer, project, { ...input, revision: current.revision }), 403);
    assert.equal(store.readiness.reviews(owner, project).length, 1);
  } finally {
    store.close();
  }
});
