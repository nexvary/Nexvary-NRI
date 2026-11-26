import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

function fixture() {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  store.addAccount('report-owner@example.test', credentials);
  store.addAccount('report-other@example.test', credentials);
  const owner = store.credentials('report-owner@example.test').id;
  const other = store.credentials('report-other@example.test').id;
  const projectId = store.createProject(owner, { title: 'تقرير بحثي تجريبي', description: 'حدود البحث التجريبي' });
  const checkedAt = Date.UTC(2026, 10, 26);
  store.references.save(owner, projectId, {
    doi: '10.5555/report-fixture', provider: 'crossref', status: 'found', checkedAt,
    metadata: { title: 'Synthetic citation', authors: ['Synthetic researcher'] },
  }, true);
  store.evidence.addClaim(owner, projectId, 'ادعاء توضيحي');
  const claim = store.evidence.list(owner, projectId)[0].id;
  store.evidence.link(owner, projectId, {
    claim, doi: '10.5555/report-fixture', provider: 'crossref', relation: 'conflicts',
    studyType: 'Illustrative case', limitations: 'حدود الدراسة',
  });
  store.readiness.save(owner, projectId, {
    intendedUse: 'مثال', safety: 'unresolved', authorization: 'missing',
    dimensions: [...'LREADY'].map((letter) => ({ letter, level: 'unavailable', limits: 'فجوة الأدلة' })),
  });
  return { store, owner, other, projectId };
}

test('exports owner-scoped report content with dated provenance, evidence and governance limitations', async () => {
  const { store, owner, other, projectId } = fixture();
  const ownerCookie = 'nri_session=' + store.newSession(owner);
  const otherCookie = 'nri_session=' + store.newSession(other);
  const app = createApp(store, { reportRenderer: async (model) => Buffer.from(JSON.stringify(model)) });
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/projects/' + projectId + '/reports?lang=en';
  const submit = (cookie, format) => fetch(url, {
    method: 'POST', redirect: 'manual', headers: { origin, cookie }, body: new URLSearchParams({ format }),
  });
  try {
    assert.equal((await submit(otherCookie, 'pdf')).status, 404);
    assert.equal((await submit(ownerCookie, 'html')).status, 422);
    const response = await submit(ownerCookie, 'pdf');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition'), /nri-research-report\.pdf/);
    const body = await response.text();
    assert.match(body, /Synthetic citation/);
    assert.match(body, /2026-11-26T00:00:00.000Z/);
    assert.match(body, /Blocked by safety or authorization/);
    assert.match(body, /حدود الدراسة/);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test('renders actual bilingual PDF and DOCX files with the configured local dependencies', {
  skip: !process.env.NRI_REPORT_PYTHON,
}, async () => {
  const { store, owner, projectId } = fixture();
  const cookie = 'nri_session=' + store.newSession(owner);
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  async function download(lang, format) {
    const response = await fetch(origin + '/workspace/projects/' + projectId + '/reports?lang=' + lang, {
      method: 'POST', headers: { origin, cookie }, body: new URLSearchParams({ format }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), new RegExp('nri-research-report\\.' + format));
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    for (const lang of ['ar', 'en']) {
      const pdf = await download(lang, 'pdf');
      const docx = await download(lang, 'docx');
      assert.match(pdf.subarray(0, 8).toString(), /^%PDF-/);
      assert.ok(pdf.length > 4000);
      const xml = execFileSync(process.env.NRI_REPORT_PYTHON, ['-c',
        "import io,sys,zipfile; z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.read('word/document.xml').decode())",
      ], { input: docx, encoding: 'utf8' });
      assert.match(xml, /Synthetic citation/);
      assert.match(xml, /حدود الدراسة/);
      if (lang === 'ar') assert.match(xml, /w:bidi w:val="1"/);
    }
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
