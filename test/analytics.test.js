import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { parseCsv, summarizeCsv } from '../src/analytics.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const csv = 'sample,value\r\n"a,b",1\r\nc,2\r\nd,2\r\ne,3\r\nf,100\r\n';

test('validates bounded CSV and calculates reproducible descriptive metrics and outliers', () => {
  assert.equal(parseCsv(csv).rows[0][0], 'a,b');
  assert.equal(parseCsv('x,y\n1'), null);
  assert.equal(parseCsv('x,x\n1,2'), null);
  assert.equal(parseCsv('x\n"1'), null);
  assert.equal(summarizeCsv('x\nNaN', '', ''), null);
  assert.equal(summarizeCsv('x\n1\n""', '', ''), null);
  const result = summarizeCsv(csv, 'value', 'mg');
  assert.equal(result.stats.mean, 21.6);
  assert.equal(result.stats.median, 2);
  assert.deepEqual(result.outliers.rows, [{ row: 6, value: 100 }]);
  assert.equal(result.histogram.reduce((sum, row) => sum + row.count, 0), 5);
  assert.equal(summarizeCsv('x\n2', '', '').stats.sampleStdDev, null);
});

test('accepts an authorized CSV file, exports it reproducibly and rejects anonymous and foreign origins', async () => {
  const store = openWorkspaceStore();
  store.addAccount('analytics@example.test', { salt: randomBytes(16), hash: randomBytes(32) });
  const account = store.credentials('analytics@example.test');
  const cookie = 'nri_session=' + store.newSession(account.id);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const post = (intent, auth, source = origin) => {
    const body = new FormData();
    body.append('file', new File([csv], 'measurements.csv', { type: 'text/csv' }));
    body.append('column', 'value');
    body.append('unit', 'mg');
    body.append('intent', intent);
    return fetch(origin + '/workspace/analytics?lang=en', {
      method: 'POST', redirect: 'manual', headers: { origin: source, ...(auth ? { cookie } : {}) }, body,
    });
  };
  try {
    assert.equal((await post('analyze', false)).status, 303);
    assert.equal((await post('analyze', true, 'https://example.test')).status, 403);
    const report = await post('analyze', true);
    assert.equal(report.status, 200);
    assert.equal(report.headers.get('cache-control'), 'no-store');
    assert.match(await report.text(), /Potential outliers/);
    const response = await post('export', true);
    assert.match(response.headers.get('content-disposition'), /nri-analytics.json/);
    assert.deepEqual(await response.json(), summarizeCsv(csv, 'value', 'mg'));
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
