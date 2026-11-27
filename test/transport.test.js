import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/password.js';
import { openWorkspaceStore, sessionIdle } from '../src/store.js';
import { createLoginThrottle } from '../src/login-throttle.js';

test('login throttle limits accounts and addresses independently and releases concurrent slots', () => {
  let now = 1000;
  const throttle = createLoginThrottle(() => now);
  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(throttle.begin('address-' + attempt,'name@example.test'),0);
    throttle.finish();
  }
  assert.ok(throttle.begin('new-address','name@example.test') > 0);
  assert.equal(throttle.begin('new-address','other@example.test'),0);
  assert.equal(throttle.begin('different-address','someone@example.test'),0);
  assert.equal(throttle.begin('third','third@example.test'),1);
  throttle.finish();
  throttle.finish();
  now += 60_001;
  assert.equal(throttle.begin('new-address','name@example.test'),0);
  throttle.finish();
});

test('HTTPS uses secure cookies, origin checks and private operational logs under concurrent use', async (t) => {
  const folder = await mkdtemp(join(tmpdir(),'nri-tls-'));
  t.after(() => rm(folder,{recursive:true,force:true}));
  const certificate = join(folder,'cert.pem');
  const privateKey = join(folder,'key.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=nri.test',
    '-addext','subjectAltName=DNS:nri.test,IP:127.0.0.1','-keyout',privateKey,'-out',certificate],{stdio:'ignore'});
  const [cert,key] = await Promise.all([readFile(certificate),readFile(privateKey)]);
  let now = Date.now();
  const store = openWorkspaceStore(':memory:', () => now);
  const password = 'fixture password for transport';
  const credentials = await hashPassword(password);
  const clients = Array.from({length:8},(_,index) => {
    const email = 'transport-' + index + '@example.test';
    store.addAccount(email,credentials);
    const { id } = store.credentials(email);
    store.createProject(id,{title:'Private project ' + index,description:''});
    const token = store.newSession(id);
    return { email,token,cookie:'__Host-nri_session=' + token };
  });
  const site = 'https://nri.test';
  const logs = [];
  const app = createApp(store,{tls:{origin:site,cert,key},log:(event) => logs.push(event)});
  app.listen(0,'127.0.0.1');
  await once(app,'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const send = (path,{cookie,method='GET',body,host='nri.test',origin=site}={}) => new Promise((resolve,reject) => {
    const stream = request({hostname:'127.0.0.1',port:app.address().port,servername:'nri.test',ca:cert,path,method,agent:false,
      headers:{host,...(cookie ? {cookie} : {}),...(body ? {origin,'Content-Type':'application/x-www-form-urlencoded'} : {})}},(res) => {
      const chunks = [];
      res.on('data',(chunk) => chunks.push(chunk));
      res.on('end',() => resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',reject);
    });
    stream.on('error',reject);
    stream.end(body);
  });
  assert.equal((await send('/healthz',{host:'other.test'})).status,421);
  assert.equal((await send('/healthz')).headers['strict-transport-security'],'max-age=31536000');
  const form = new URLSearchParams({email:clients[0].email,password}).toString();
  assert.equal((await send('/login?lang=en',{method:'POST',body:form,origin:'https://other.test'})).status,403);
  const login = await send('/login?lang=en',{method:'POST',body:form});
  assert.equal(login.status,303);
  assert.match(login.headers['set-cookie'][0],/^__Host-nri_session=.*HttpOnly; SameSite=Strict;.*; Secure$/);
  assert.equal((await send('/workspace',{cookie:'nri_session=' + clients[0].token})).status,303);
  assert.equal((await send('/workspace',{cookie:clients[0].cookie + '; ' + clients[0].cookie})).status,303);
  const outcomes = await Promise.all(clients.flatMap((client,index) => Array.from({length:6},async () => {
    const result = await send('/workspace?lang=en',{cookie:client.cookie});
    assert.equal(result.status,200);
    assert.match(result.body,new RegExp('Private project ' + index + '(?=<)'));
    return result;
  })));
  assert.equal(outcomes.length,48);
  now += sessionIdle - 60_000;
  assert.equal((await send('/workspace',{cookie:clients[0].cookie})).status,200);
  now += 60_001;
  assert.equal((await send('/workspace',{cookie:clients[0].cookie})).status,200);
  assert.equal((await send('/workspace',{cookie:clients[1].cookie})).status,303);
  assert.ok(logs.some(({event,route,status}) => event === 'http.request' && route === 'index' && status === 200));
  assert.doesNotMatch(JSON.stringify(logs),/fixture password|transport-0@example|Private project|nri_session|\?lang/);
});
