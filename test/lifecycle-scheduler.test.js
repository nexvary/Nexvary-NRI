import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { totp } from '../src/mfa.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('server startup and timer reconcile expired subscriptions with durable audit events', async () => {
  let now=1_800_000_000_000;
  const store=openWorkspaceStore(':memory:',()=>now);
  const password={salt:randomBytes(16),hash:randomBytes(32)};
  store.addAccount('lifecycle-operator@example.test',password);
  store.addAccount('lifecycle-customer@example.test',password);
  const operator=store.credentials('lifecycle-operator@example.test').id;
  store.licensing.setOperator(operator,true);
  const token=store.newSession(operator);
  assert.equal(store.mfa.begin(operator),true);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits=[...store.mfa.pending(operator)].map((letter)=>alphabet.indexOf(letter).toString(2).padStart(5,'0')).join('');
  const seed=Buffer.from(bits.match(/.{8}/g).map((byte)=>Number.parseInt(byte,2)));
  assert.equal(store.mfa.confirm(operator,totp(seed,Math.floor(now/30_000)),token).length,8);
  assert.equal(store.licensing.save(operator,'scheduled',1,0),303);
  assert.equal(store.licensing.assign(operator,'lifecycle-operator@example.test','scheduled',now-1),303);
  const app=createApp(store,{lifecycleIntervalMs:10});
  app.listen(0,'127.0.0.1');
  await once(app,'listening');
  try {
    assert.equal(store.licensing.dashboard(operator).recent[0].action,'expiry:active:expired');
    assert.equal(store.licensing.assign(operator,'lifecycle-customer@example.test','scheduled',now+1),303);
    now+=2;
    await new Promise((resolve)=>setTimeout(resolve,35));
    const expiries=store.licensing.dashboard(operator).recent.filter(({action})=>action==='expiry:active:expired');
    assert.equal(expiries.length,2);
  } finally {
    await new Promise((resolve,reject)=>app.close((error)=>error?reject(error):resolve()));
  }
});
