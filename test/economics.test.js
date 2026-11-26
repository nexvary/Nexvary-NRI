import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { evaluateScenario, readScenario } from '../src/economics.js';
import { openWorkspaceStore } from '../src/store.js';

const assumptions = {
  name: 'Hypothetical base case', unit: 'units', currency: 'EUR', capacity: '1000',
  utilization: '50', fixedCost: '1000.00', variableCost: '2.00', unitPrice: '5.00',
};

test('evaluates exact minor-unit costs, capacity limits and reproducible sensitivity', () => {
  const input = readScenario(new URLSearchParams(assumptions));
  assert.equal(input.fixedCost, 100000);
  const data = evaluateScenario(input);
  assert.deepEqual(data.base, {
    units: 500, rate: 50, price: 500, revenue: 250000, totalCost: 200000, operatingResult: 50000,
  });
  assert.equal(data.breakEvenUnits, 334);
  assert.equal(data.sensitivity.utilizationLow.operatingResult, 20000);
  assert.equal(data.sensitivity.priceHigh.operatingResult, 75000);
  assert.equal(evaluateScenario({ ...input, unitPrice: 200 }).breakEvenUnits, null);
  assert.equal(evaluateScenario({ ...input, utilization: 95 }).sensitivity.utilizationHigh.rate, 100);
  assert.equal(readScenario(new URLSearchParams({ ...assumptions, fixedCost: '1e4' })), null);
  assert.equal(readScenario(new URLSearchParams({ ...assumptions, utilization: '101' })), null);
});

test('compares saved scenarios and exports formula results within the project owner boundary', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('economics-owner@example.test', credentials);
  store.addAccount('economics-other@example.test', credentials);
  const owner = store.credentials('economics-owner@example.test').id;
  const other = store.credentials('economics-other@example.test').id;
  const project = store.createProject(owner, { title: 'Scenario test', description: '' });
  const ownerCookie = 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const path = origin + '/workspace/projects/' + project + '/economics';
  const post = (fields, cookie = ownerCookie) => fetch(path + '?lang=en', {
    method: 'POST', redirect: 'manual', headers: { cookie, origin }, body: new URLSearchParams(fields),
  });
  try {
    assert.equal((await post(assumptions, otherCookie)).status, 404);
    assert.equal((await post(assumptions)).status, 303);
    assert.equal((await post({ ...assumptions, name: 'Low capacity', utilization: '20' })).status, 303);
    const denied = await fetch(path + '/export', { headers: { cookie: otherCookie } });
    assert.equal(denied.status, 404);
    const response = await fetch(path + '/export', { headers: { cookie: ownerCookie } });
    assert.match(response.headers.get('content-disposition'), /nri-economics.json/);
    const data = await response.json();
    assert.equal(data.formulaVersion, 1);
    assert.equal(data.currencyScale, 100);
    assert.equal(data.hypothetical, true);
    assert.equal(data.scenarios.length, 2);
    const low = data.scenarios.find((scenario) => scenario.assumptions.name === 'Low capacity');
    assert.equal(low.results.base.operatingResult, -40000);
    assert.equal((await post({ intent: 'remove', id: low.id }, otherCookie)).status, 404);
    assert.equal((await post({ intent: 'remove', id: low.id })).status, 303);
    const html = await (await fetch(path + '?lang=ar', { headers: { cookie: ownerCookie } })).text();
    assert.match(html, /الجدوى الاقتصادية/);
    assert.match(html, /Hypothetical base case/);
    assert.doesNotMatch(html, /Low capacity/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
