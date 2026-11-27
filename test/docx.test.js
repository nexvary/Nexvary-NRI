import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { inspectDocx } from '../src/docx.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const fixture = (variant = 'valid') => execFileSync('python3', ['-I', '-c', String.raw`
import io, sys, zipfile
mode = sys.argv[1]
ct = 'http://schemas.openxmlformats.org/package/2006/content-types'
rel = 'http://schemas.openxmlformats.org/package/2006/relationships'
word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
main = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
xml = f'<w:document xmlns:w="{word}"><w:body><w:p><w:r><w:t>بحث &amp; &lt;script&gt;</w:t></w:r></w:p></w:body></w:document>'
if mode == 'dtd':
    xml = '<!DOCTYPE doc [<!ENTITY bad SYSTEM "file:///etc/passwd">]>' + xml
if mode == 'malformed':
    xml = xml[:-4]
if mode == 'active':
    xml = xml.replace('<w:p>', '<w:p><w:object/>', 1)
attributes = 'Target="word/document.xml"'
if mode == 'scheme-relative':
    attributes = 'Target="//word/document.xml"'
if mode == 'external':
    attributes = 'TargetMode="External" Target="https://example.test/"'
output = io.BytesIO()
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', f'<Types xmlns="{ct}"><Override PartName="/word/document.xml" ContentType="{main}"/></Types>')
    archive.writestr('_rels/.rels', f'<Relationships xmlns="{rel}"><Relationship Id="rId1" Type="{office}" {attributes}/></Relationships>')
    archive.writestr('word/document.xml', xml)
    extra = {'traversal': ('../data.xml', '<data/>'), 'macro': ('word/vbaProject.bin', 'code'),
             'bomb': ('word/extra.xml', 'X' * (5 * 1024 * 1024))}
    if mode in extra:
        archive.writestr(*extra[mode])
sys.stdout.buffer.write(output.getvalue())
`, variant]);

test('rejects malformed and unsafe DOCX packages', async () => {
  for (const variant of ['dtd', 'malformed', 'external', 'scheme-relative', 'traversal', 'macro', 'bomb', 'active']) {
    assert.equal((await inspectDocx(fixture(variant))).status, 422, variant);
  }
  assert.equal((await inspectDocx(Buffer.from('not a ZIP archive'))).status, 422);
});

test('stores, previews and downloads a DOCX only in its private project', async (t) => {
  const store = openWorkspaceStore();
  const accounts = ['author', 'other'].map((name) => {
    const email = name + '@docx.test';
    store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
    const { id } = store.credentials(email);
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const project = store.createProject(accounts[0].id, { title: 'Document fixture', description: '' });
  const app = createApp(store).listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const root = '/workspace/projects/' + project + '/documents';
  const get = (path, account = accounts[0]) => fetch(origin + path, { headers: { cookie: account.cookie } });
  const bytes = fixture();
  const upload = (path, data, name = 'study.docx') => {
    const body = new FormData();
    body.set('file', new Blob([data]), name);
    return fetch(origin + path, { method: 'POST', headers: { cookie: accounts[0].cookie, origin }, body, redirect: 'manual' });
  };
  const created = await upload(root, bytes);
  assert.equal(created.status, 303);
  const history = created.headers.get('location').split('?')[0];
  assert.equal((await upload(history, bytes, 'study-v2.docx')).status, 303);
  assert.equal((await upload(history, fixture('external'))).status, 422);
  assert.equal((await get(history + '/versions/3')).status, 404);
  const url = history + '/versions/2/preview?lang=ar';
  const preview = await get(url);
  assert.equal(preview.status, 200);
  const body = await preview.text();
  assert.match(body, /بحث &amp; &lt;script&gt;/);
  assert.doesNotMatch(body, /بحث & <script>/);
  assert.equal((await get(url, accounts[1])).status, 404);
  const download = await get(history + '/versions/1');
  assert.equal(download.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await get(history + '/versions/1', accounts[1])).status, 404);
  assert.match(await (await get('/workspace/library?kind=docx&q=study')).text(), /study\.docx/);
});
