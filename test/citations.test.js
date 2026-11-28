import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { parseCitations, citationText } from '../src/citation-formats.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('parses nested BibTeX and repeated RIS fields, preserving source-format metadata', () => {
  const bib = parseCitations('bibtex', '@string{j = "Journal"}\n@article{x,title = {A {Study}},journal=j # " 2",author={A and B},year=2024,doi={https://doi.org/10.1234/ABC},custom={Keep}}');
  assert.equal(bib[0].fields.journal, 'Journal 2');
  assert.equal(bib[0].doi, '10.1234/abc');
  assert.equal(parseCitations('bibtex',citationText(bib,'bibtex'))[0].fields.custom,'Keep');
  const record = parseCitations('ris',citationText(bib,'ris'))[0];
  assert.deepEqual(record.fields.AU,['A','B']);
  assert.equal(record.fields.TI[0],'A {Study}');
  assert.throws(() => parseCitations('bibtex','@article{x,title={bad}'),SyntaxError);
  assert.throws(() => parseCitations('ris','TY  - JOUR\nTI  - Missing end'),SyntaxError);
});

test('citation exchange groups identifiers, preserves sources, and gates controlled merges and downloads', async (t) => {
  const store = openWorkspaceStore();
  const [owner, stranger] = ['owner','stranger'].map((name) => {
    const email = name + '@citations.test';
    store.addAccount(email,{salt:Buffer.alloc(16),hash:Buffer.alloc(32)});
    const id = store.credentials(email).id;
    return { id, cookie: 'nri_session=' + store.newSession(id) };
  });
  const project = store.createProject(owner.id,{title:'Library study',description:''});
  const app = createApp(store);
  app.listen(0,'127.0.0.1');
  await once(app,'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const url = origin + '/workspace/projects/' + project + '/citations?lang=en';
  const post = (account, fields, source = origin) => fetch(url,{
    method:'POST',redirect:'manual',headers:{ cookie:account.cookie,origin:source },body:new URLSearchParams(fields),
  });
  const read = (account, query = '') => fetch(url + query,{headers:{cookie:account.cookie}});
  const bib = {intent:'import',format:'bibtex',data:'@article{a,title={A study},doi={10.1234/xyz},author={Abc}}'};
  const ris = (title, extra) => ({intent:'import',format:'ris',data:'TY  - JOUR\nTI  - '+title+'\n'+extra+'\nER  - '});
  assert.equal((await post(stranger,bib)).status,404);
  assert.equal((await post(owner,bib,'https://foreign.test')).status,403);
  assert.equal((await post(owner,bib)).status,303);
  assert.equal((await post(owner,bib)).status,303);
  assert.equal((await post(owner,ris('A study','DO  - https://doi.org/10.1234/XYZ\nDB  - Test Provider\nAN  - ABC'))).status,303);
  assert.equal((await post(owner,ris('A study','DB  - Test Provider\nAN  - ABC\nAU  - Other'))).status,303);
  assert.equal((await post(owner,ris('A study','AU  - Duplicate candidate'))).status,303);
  assert.equal((await post(owner,ris('A study','DO  - 10.1234/different'))).status,303);
  assert.equal((await read(stranger,'&export=ris')).status,404);
  assert.match(await (await read(owner)).text(),/Possible duplicate/);
  const groups = store.citations.list(owner.id,project);
  assert.deepEqual(groups.map((item) => item.sources.length),[3,1,1]);
  const [target, duplicate, conflict] = groups;
  const merge = (source) => post(owner,{intent:'merge',source,target:target.id});
  assert.equal((await merge(conflict.id)).status,409);
  assert.equal((await merge(duplicate.id)).status,303);
  assert.equal(store.citations.list(owner.id,project)[0].sources.length,4);
  assert.equal(parseCitations('ris',await (await read(owner,'&export=ris')).text()).length,2);
  assert.equal(parseCitations('bibtex',await (await read(owner,'&export=bibtex&sources=all')).text()).length,5);
});
