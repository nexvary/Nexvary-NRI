import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { after, before, test } from 'node:test';
import { createApp } from '../src/server.js';
import { modules } from '../src/content.js';
import { openWorkspaceStore } from '../src/store.js';

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

test('serves a bilingual dashboard without fabricated dashboard metrics', async () => {
  const ar = await fetch(base);
  assert.equal(ar.status, 200);
  assert.equal(ar.headers.get('content-language'), 'ar');
  const arabic = await ar.text();
  assert.match(arabic, /<html lang="ar" dir="rtl" data-theme="dark">/);
  assert.match(arabic, /سجّل الدخول لعرض مساحة عملك/);
  assert.match(arabic, /غير مفعّل/);
  assert.match(arabic, /class="skip" href="#main"/);

  const en = await fetch(`${base}/?lang=en`);
  assert.equal(en.headers.get('content-language'), 'en');
  const english = await en.text();
  assert.match(english, /<html lang="en" dir="ltr" data-theme="dark">/);
  assert.match(english, /Sign in to see your workspace/);
  assert.doesNotMatch(english, /Demo data|Assessing rainwater harvesting/);
  assert.match(english, /<svg class="icon"/);
  assert.match(english, /Live API spend/);
  assert.match(english, /Inactive/);
  assert.match(english, /aria-current="page"/);
  assert.match(english, /dashboard-navigation\.js/);
  assert.match(english, /id="dashboard-navigation-status" role="status" aria-live="polite" hidden/);
  assert.match(en.headers.get('content-security-policy'), /script-src 'self'/);
});

test('dashboard navigation announces pending movement and marks the main region busy', async () => {
  let listener;
  const status = { hidden: true };
  const attributes = {};
  const link = { target: '', closest: (selector) => selector === 'a[data-dashboard-nav]' ? {} : null };
  const document = {
    addEventListener: (type, callback) => { if (type === 'click') listener = callback; },
    getElementById: (id) => id === 'dashboard-navigation-status' ? status
      : id === 'main' ? { setAttribute: (key, value) => { attributes[key] = value; } } : null,
  };
  const source = await readFile(new URL('../public/dashboard-navigation.js', import.meta.url), 'utf8');
  runInNewContext(source, { document });
  listener({ target: { closest: () => link }, defaultPrevented: false, button: 0 });
  assert.equal(status.hidden, false);
  assert.equal(attributes['aria-busy'], 'true');
});

test('dashboard database errors return an accessible bilingual retry page without leaking internals', async (t) => {
  const store = openWorkspaceStore();
  store.addAccount('dashboard-error@example.test', { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
  const account = store.credentials('dashboard-error@example.test').id;
  const token = store.newSession(account);
  store.library.dashboard = () => { throw new Error('private database diagnostic'); };
  const app = createApp(store);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  try {
    for (const [lang, phrase] of [['en', 'Dashboard data could not be loaded'], ['ar', 'تعذّر تحميل بيانات لوحة التحكم']]) {
      const response = await fetch(origin + '/?lang=' + lang, { headers: { cookie: 'nri_session=' + token } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.match(html, /role="alert"/);
      assert.ok(html.includes(phrase));
      assert.doesNotMatch(html, /private database diagnostic/);
    }
  } finally {
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
  }
});

test('navigates to every module and preserves its view across language changes', async () => {
  for (const [id, module] of Object.entries(modules)) {
    if (['research', 'references', 'evidence', 'l-ready', 'economics', 'library', 'network', 'collaboration', 'analytics', 'observatory', 'reports', 'settings', 'education', 'assistant', 'messages'].includes(id)) {
      const start = await fetch(`${base}/?lang=en&view=${id}`, { redirect: 'manual' });
      assert.equal(start.status, 303);
      const destination = { research: '/workspace', references: '/workspace/reference-projects', evidence: '/workspace/evidence-projects', 'l-ready': '/workspace/readiness-projects', economics: '/workspace/economics-projects', library: '/workspace/library', network: '/workspace/network', collaboration: '/workspace/collaboration', analytics: '/workspace/analytics', observatory: '/workspace/observatory', reports: '/workspace/report-projects', settings: '/workspace/settings', education: '/workspace/education', assistant: '/workspace/assistant', messages: '/workspace/messages' }[id];
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
  const ar = await fetch(`${base}/?lang=ar`);
  const body = await ar.text();
  const letters = [...body.matchAll(/<bdi>([A-Z])<\/bdi>/g)].map((match) => match[1]).join('');
  assert.equal(letters, 'LREADY');
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

test('publishes bilingual release and legal review information separately from official company contacts', async () => {
  for (const [lang, privacy, terms, review] of [
    ['en', 'Privacy policy draft', 'Terms of use draft', 'Legal information for owner review'],
    ['ar', 'مسودة سياسة الخصوصية', 'مسودة شروط الاستخدام', 'معلومات قانونية بانتظار مراجعة المالك'],
  ]) {
    const system = await fetch(`${base}/?lang=${lang}&view=about`).then((response) => response.text());
    const developer = await fetch(`${base}/?lang=${lang}&view=developer`).then((response) => response.text());
    for (const heading of [privacy, terms, review]) {
      assert.ok(system.includes(heading));
      assert.ok(!developer.includes(heading));
    }
    assert.match(system, /github\.com\/nexvary\/Nexvary-NRI\/commits\//);
    assert.match(system, /https:\/\/nexvary\.com\/contact/);
    assert.doesNotMatch(system, /mailto:info@nexvary\.com/);
    assert.match(developer, /href="mailto:info@nexvary\.com"/);
    assert.match(developer, /href="https:\/\/www\.youtube\.com\/@NexvaryInc"/);
    assert.match(developer, /href="https:\/\/x\.com\/Nexvary"/);
  }
});
