import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const [clientArg = '24', roundArg = '20'] = process.argv.slice(2);
const clients = Number(clientArg);
const rounds = Number(roundArg);
assert(Number.isInteger(clients) && clients >= 2 && clients <= 100, 'Use 2–100 clients.');
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 100, 'Use 1–100 rounds.');

const directory = await mkdtemp(join(tmpdir(), 'nri-load-'));
const database = join(directory, 'workspace.sqlite');
const store = openWorkspaceStore(database);
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
let app;

try {
  const accounts = Array.from({ length: clients }, (_, index) => {
    const email = `load-${index}@example.test`;
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const { id } = store.credentials(email);
    const title = `LOAD-PROJECT-[${index}]`;
    const project = store.createProject(id, { title, description: '' });
    return { id, project, title, cookie: 'nri_session=' + store.newSession(id) };
  });
  app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const origin = 'http://127.0.0.1:' + app.address().port;
  const timings = { reads: [], writes: [], denied: [] };
  async function send(account, path, expected, operation, fields) {
    const headers = { cookie: account.cookie, ...(fields ? { origin } : {}) };
    const start = performance.now();
    const response = await fetch(origin + path, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(15_000),
      ...(fields ? { method: 'POST', body: new URLSearchParams(fields) } : {}),
    });
    const body = await response.text();
    timings[operation].push(performance.now() - start);
    assert.equal(response.status, expected, path);
    return body;
  }
  eventLoop.enable();
  const started = performance.now();
  const outcomes = await Promise.allSettled(accounts.map(async (account, index) => {
    const foreign = accounts[(index + 1) % accounts.length];
    for (let round = 0; round < rounds; round++) {
      const lang = round % 2 === 0 ? 'en' : 'ar';
      const body = await send(account, '/workspace?lang=' + lang, 200, 'reads');
      assert.ok(body.includes(account.title));
      assert.ok(!body.includes(foreign.title));
      await send(account, '/workspace/projects/' + foreign.project + '?lang=' + lang, 404, 'denied');
      await send(account, '/workspace?lang=' + lang, 303, 'writes', { title: `New fixture ${round}`, description: '' });
    }
    assert.equal(store.listProjects(account.id).length, rounds + 1);
  }));
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(failures.length, 0, failures[0]?.reason?.message);
  const elapsed = (performance.now() - started) / 1000;
  const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
  const summary = Object.fromEntries(Object.entries(timings).map(([name, values]) =>
    [name, { requests: values.length, p50Ms: Math.round(percentile(values, 0.5)), p95Ms: Math.round(percentile(values, 0.95)) }]));
  console.log(JSON.stringify({
    node: process.version, clients, rounds, elapsedSeconds: Number(elapsed.toFixed(2)),
    requestsPerSecond: Math.round(clients * rounds * 3 / elapsed), ...summary,
    eventLoopP95Ms: Math.round(eventLoop.percentile(95) / 1e6),
    rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2), sqliteBytes: (await stat(database)).size,
  }, null, 2));
} finally {
  eventLoop.disable();
  if (app) await new Promise((resolve) => app.close(resolve));
  else store.close();
  await rm(directory, { recursive: true, force: true });
}
