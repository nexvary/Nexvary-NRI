import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createApp } from '../src/server.js';
import { modules } from '../src/content.js';

const app = createApp();
let base;

before(async () => {
  await new Promise((resolve, reject) => {
    app.once('error', reject).listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${app.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  app.close((error) => error ? reject(error) : resolve());
}));

test('serves a bilingual dashboard with explicit fixtures and API state', async () => {
  const ar = await fetch(base);
  assert.equal(ar.status, 200);
  assert.equal(ar.headers.get('content-language'), 'ar');
  const arabic = await ar.text();
  assert.match(arabic, /<html lang="ar" dir="rtl">/);
  assert.match(arabic, /بيانات تجريبية/);
  assert.match(arabic, /غير مفعّل/);
  assert.match(arabic, /class="skip" href="#main"/);

  const en = await fetch(`${base}/?lang=en`);
  assert.equal(en.headers.get('content-language'), 'en');
  const english = await en.text();
  assert.match(english, /<html lang="en" dir="ltr">/);
  assert.match(english, /Demo data/);
  assert.match(english, /Live API spend/);
  assert.match(english, /Inactive/);
  assert.match(english, /aria-current="page"/);
});

test('navigates to every module and preserves its view across language changes', async () => {
  for (const [id, module] of Object.entries(modules)) {
    if (['research', 'references', 'evidence'].includes(id)) {
      const start = await fetch(`${base}/?lang=en&view=${id}`, { redirect: 'manual' });
      assert.equal(start.status, 303);
      const destination = { research: '/workspace', references: '/workspace/reference-projects', evidence: '/workspace/evidence-projects' }[id];
      assert.equal(start.headers.get('location'), destination + '?lang=en');
      continue;
    }
    const response = await fetch(`${base}/?lang=en&view=${id}`);
    assert.equal(response.status, 200, id);
    const body = await response.text();
    assert.ok(body.includes(`<title>${module[2][0]} | NEXVARY NRI</title>`), id);
    assert.ok(body.includes(`href="/?lang=ar&amp;view=${id}" hreflang="ar"`), id);
    if (!['dashboard', 'about'].includes(id)) assert.ok(body.includes('Planned module'), id);
  }
});

test('shows L-READY dimensions in the required order and no assessment result', async () => {
  const ar = await fetch(`${base}/?lang=ar&view=l-ready`);
  const body = await ar.text();
  const letters = [...body.matchAll(/<bdi>([A-Z])<\/bdi>/g)].map((match) => match[1]).join('');
  assert.equal(letters, 'LREADY');
  assert.match(body, /إطار بحثي نوعي مقترح/);
  assert.doesNotMatch(body, /<progress|<meter/);
});

test('provides separately navigable system and developer pages with the build version', async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const system = await fetch(`${base}/?lang=en&view=about`);
  assert.ok((await system.text()).includes(`Version <bdi>${version}</bdi>`));
  const developer = await fetch(`${base}/?lang=en&view=developer`);
  const body = await developer.text();
  assert.equal(developer.status, 200);
  assert.match(body, /href="\/\?lang=en&amp;view=developer" aria-current="page"/);
  assert.match(body, /href="https:\/\/nexvary\.com\//);
});

test('serves the stylesheet and HEAD while handling unsupported requests', async () => {
  const css = await fetch(`${base}/styles.css`);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.match(await css.text(), /@media \(max-width: 470px\)/);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(base, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  const unknown = await fetch(`${base}/?lang=en&view=constructor`);
  assert.equal(unknown.status, 404);
  assert.match(await unknown.text(), /Return to the dashboard/);
});
