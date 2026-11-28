import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('research content respects discoverability, blocking and moderator review', async () => {
  const store = openWorkspaceStore();
  const credentials = { salt: randomBytes(16), hash: randomBytes(32) };
  const accounts = ['author','reader','moderator'].map((name) => {
    const email=`content-${name}@example.test`;
    store.addAccount(email,credentials);
    const id=store.credentials(email).id;
    return { id, cookie:'nri_session='+store.newSession(id) };
  });
  const [author,reader,moderator]=accounts;
  for (const [account,name,discoverable] of [[author,'Researcher A',true],[reader,'Researcher B',true],[moderator,'Researcher C',true]]) {
    store.network.save(account.id,{name,interests:'',orcid:'',discoverable});
  }
  const app=createApp(store);
  app.listen(0,'127.0.0.1');
  await new Promise((resolve)=>app.once('listening',resolve));
  const origin='http://127.0.0.1:'+app.address().port;
  const network=origin+'/workspace/network?lang=en';
  const post=async(account,data)=>fetch(network,{method:'POST',redirect:'manual',headers:{cookie:account.cookie,origin},body:new URLSearchParams(data)});
  try {
    store.network.save(author.id,{name:'Researcher A',interests:'',orcid:'',discoverable:false});
    assert.deepEqual(store.network.posts(reader.id),[]);
    assert.equal(store.network.publishPost(author.id,'hidden until opt-in'),false);
    store.network.save(author.id,{name:'Researcher A',interests:'',orcid:'',discoverable:true});
    assert.equal(store.network.publishPost(author.id,'private draft'),true);
    const html=await (await fetch(network,{headers:{cookie:reader.cookie}})).text();
    assert.match(html,/private draft/);
    assert.doesNotMatch(html,/hidden until opt-in/);
    assert.equal((await post(reader,{intent:'comment','post-id':'1',body:'Useful result <script>alert(1)</script>'})).status,303);
    assert.equal((await post(reader,{intent:'react-like','post-id':'1'})).status,303);
    const comments=store.network.comments(author.id,1);
    assert.equal(comments.length,1);
    assert.equal(comments[0].body,'Useful result <script>alert(1)</script>');
    const readerHtml=await (await fetch(network,{headers:{cookie:reader.cookie}})).text();
    assert.doesNotMatch(readerHtml,/<script>alert\(1\)<\/script>/);
    assert.match(readerHtml,/&lt;script&gt;/);
    assert.equal((await post(author,{intent:'report-content','target-type':'comment','target-id':String(comments[0].id),reason:'harassment'})).status,303);
    store.messages.setModerator(moderator.id,true);
    const reports=store.network.reports();
    assert.equal(reports.length,1);
    assert.equal(reports[0].reportType,'content');
    assert.equal((await fetch(origin+'/workspace/settings/network-moderation?lang=en',{headers:{cookie:reader.cookie}})).status,403);
    const moderation=origin+'/workspace/settings/network-moderation?lang=en';
    assert.match(await (await fetch(moderation,{headers:{cookie:moderator.cookie}})).text(),/Useful result/);
    assert.equal((await fetch(moderation,{method:'POST',redirect:'manual',headers:{cookie:moderator.cookie,origin},body:new URLSearchParams({intent:'actioned','report-id':String(reports[0].id),'report-type':'content'})})).status,303);
    assert.deepEqual(store.network.comments(author.id,1),[]);
    assert.equal(store.network.reports().length,0);
    assert.deepEqual(store.network.contentModerationEvents().map(({reviewerId,action})=>({reviewerId,action})),[{reviewerId:moderator.id,action:'actioned'}]);

    const another=store.network.publishPost(author.id,'blocked update');
    assert.equal(another,true);
    assert.equal(store.network.interact(reader.id,author.id,'block'),true);
    assert.equal(store.network.posts(reader.id).some((item)=>item.body==='blocked update'),false);
    assert.equal(store.network.comment(reader.id,2,'blocked comment'),false);
  } finally {
    await new Promise((resolve,reject)=>app.close((error)=>error?reject(error):resolve()));
  }
});
