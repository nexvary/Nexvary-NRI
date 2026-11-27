import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('private resources require explicit grants for every team role and remain revocable during report rendering', async (t) => {
  const store = openWorkspaceStore();
  const people = ['owner','administrator','researcher','reviewer','read-only','outsider'].map((name) => {
    const email = name + '@sharing.test';
    store.addAccount(email,{salt:Buffer.alloc(16),hash:Buffer.alloc(32)});
    const id = store.credentials(email).id;
    store.network.save(id,{name,interests:'',orcid:'',discoverable:true});
    return { name,id,cookie:'nri_session=' + store.newSession(id) };
  });
  const [owner,admin,researcher,reviewer,reader,outsider] = people;
  const project = store.createProject(owner.id,{title:'Project with private exhibits',description:'Original project description'});
  const pdf = Buffer.from('%PDF-1.4\nprivate version one');
  const doc = store.documents.create(owner.id,project,{name:'Shared version.pdf',bytes:pdf});
  store.documents.append(owner.id,project,doc,{name:'Unshared revision.pdf',bytes:Buffer.from('%PDF-1.4\nprivate version two')});
  store.references.save(owner.id,project,{doi:'10.1234/sample',provider:'crossref',status:'found',checkedAt:100,metadata:{title:'Reference snapshot title'}});
  store.readiness.save(owner.id,project,{intendedUse:'Shared public purpose',dimensions:[],safety:'unresolved',authorization:'unknown'});
  const [revision] = store.readiness.list(owner.id,project);
  const members = [admin,researcher,reviewer,reader];
  const accept = (user) => {
    assert.ok(store.teams.grant(owner.id,project,user.id,user.name));
    const [{ invitation }] = store.teams.inbox(user.id);
    assert.ok(store.teams.decide(user.id,project,user.name,invitation,'accepted'));
  };
  members.forEach(accept);
  const render = Promise.withResolvers();
  const started = Promise.withResolvers();
  let pause = false;
  const app = createApp(store,{reportRenderer:async (report,format) => {
    assert.match(JSON.stringify(report),/Original project description/);
    assert.doesNotMatch(JSON.stringify(report),/Unshared revision|New owner description/);
    if (pause) { started.resolve(); await render.promise; }
    return Buffer.from(format);
  }});
  app.listen(0,'127.0.0.1');
  await once(app,'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const path = '/workspace/projects/' + project + '/shared-resources';
  const get = (user,suffix='') => fetch(origin + path + suffix + (suffix.includes('?') ? '&' : '?') + 'lang=en',{headers:{cookie:user.cookie}});
  const post = (user, fields, suffix='', from=origin) => fetch(origin + path + suffix,{
    method:'POST',redirect:'manual',headers:{cookie:user.cookie,origin:from},body:new URLSearchParams(fields),
  });
  const resources = [
    ['document',doc + ':1'], ['reference',JSON.stringify(['crossref','10.1234/sample',100])],
    ['readiness',revision.id + ':' + revision.revision], ['report','report'],
  ];
  assert.equal((await get(outsider)).status,404);
  for (const user of members) {
    assert.match(await (await get(user)).text(),/No shared resources/);
    assert.equal((await post(user,{intent:'share',recipient:user.id,kind:'document',resource:resources[0][1]})).status,403);
    const grants = new Map();
    for (const [kind,resource] of resources) {
      const fields = {intent:'share',recipient:user.id,kind,resource};
      assert.equal((await post(owner,fields,'','https://other.test')).status,403);
      assert.equal((await post(owner,fields)).status,303);
      const id = store.resources.list(user.id,project,0).grants.find((item) => item.kind === kind).id;
      grants.set(kind,id);
      assert.equal((await get(user,'/' + id)).status,200);
      for (const other of [...members,outsider].filter((person) => person !== user)) {
        assert.equal((await get(other,'/' + id)).status,404);
      }
    }
    const direct = '/workspace/projects/' + project + '/documents/' + doc + '/versions/1';
    assert.equal((await fetch(origin + direct,{headers:{cookie:user.cookie}})).status,404);
    const downloaded = await get(user,'/' + grants.get('document') + '?download=pdf');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
    const ready = await get(user,'/' + grants.get('readiness'));
    assert.match(await ready.text(),/Shared public purpose/);
    assert.match(await (await get(user,'/' + grants.get('reference'))).text(),/10.1234\/sample/);
    const attachment = await post(user,{format:'docx'},'/' + grants.get('report') + '?lang=ar');
    assert.equal(await attachment.text(),'docx');
  }
  store.updateProject(owner.id,project,{title:'Project with private exhibits',description:'New owner description'});
  const report = store.resources.list(reader.id,project,0).grants.find((item) => item.kind === 'report').id;
  pause = true;
  const pending = post(reader,{format:'pdf'},'/' + report);
  await started.promise;
  assert.equal((await post(owner,{intent:'revoke',grant:report})).status,303);
  render.resolve();
  assert.equal((await pending).status,404);
  const savedDoc = store.resources.list(reader.id,project,0).grants.find((item) => item.kind === 'document').id;
  assert.ok(store.teams.revoke(owner.id,project,reader.id));
  accept(reader);
  assert.equal((await get(reader,'/' + savedDoc + '?download=pdf')).status,404);
  assert.ok(store.network.interact(owner.id,reviewer.id,'block'));
  assert.equal((await get(reviewer)).status,404);
});
