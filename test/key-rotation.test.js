import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { decryptDocument, encryptDocument } from '../src/document-crypto.js';
import { exportEncryptedBackup, restoreEncryptedBackup } from '../src/encrypted-backup.js';
import { rotateWorkspaceKey } from '../src/key-rotation.js';
import { totp } from '../src/mfa.js';
import { openWorkspaceStore } from '../src/store.js';

const content = Buffer.from('Sample encrypted research');
const providerKey = 'synthetic-provider-fixture';
const messageText = 'Synthetic private chat';
const conv = 'test-conversation';
const now = 1800000000000;

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'nri-rotation-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const database = join(folder,'live.sqlite');
  const store = openWorkspaceStore(database, () => now);
  let owner, other, project, document, token, codes;
  try {
    const credentials = { salt: Buffer.alloc(16), hash: Buffer.alloc(32) };
    store.addAccount('owner@rotation.test', credentials);
    store.addAccount('peer@rotation.test', credentials);
    owner = store.credentials('owner@rotation.test').id;
    other = store.credentials('peer@rotation.test').id;
    project = store.createProject(owner, { title: 'Key rotation', description: '' });
    document = store.documents.create(owner, project, { name: 'fixture.txt', bytes: content });
    token = store.newSession(owner);
    assert.equal(store.assistantSettings.save(owner,'openai','fixture-model',providerKey), true);
    assert.equal(store.mfa.begin(owner), true);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bits = [...store.mfa.pending(owner)].map((character) => alphabet.indexOf(character).toString(2).padStart(5,'0')).join('');
    const secret = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte,2)));
    codes = store.mfa.confirm(owner,totp(secret, now / 30000),token);
    assert.equal(codes.length, 8);
  } finally {
    store.close();
  }
  const key = await readFile(database + '.key');
  const db = new DatabaseSync(database);
  try {
    const [first, second] = [owner, other].sort();
    db.prepare('INSERT INTO conversations(id, first, second) VALUES (?, ?, ?)').run(conv, first, second);
    const domain = createHmac('sha256',key).update('nri-private-message-v1').digest();
    const msg = encryptDocument(domain,conv,'msg',1,Buffer.from(messageText));
    db.prepare('INSERT INTO messages(conversation,sender,crypto_id,created_at,nonce,ciphertext,tag) VALUES (?,?,?,?,?,?,?)')
      .run(conv,owner,'msg',now,msg.nonce,msg.ciphertext,msg.tag);
  } finally {
    db.close();
  }
  return { folder, database, owner, other, project, document, token, codes, key };
}

function verify(path, f, generation, activeSession = false) {
  const store = openWorkspaceStore(path, () => now);
  try {
    assert.deepEqual(store.documents.download(f.owner,f.project,f.document,1).bytes,content);
    assert.equal(store.documents.download(f.other,f.project,f.document,1),undefined);
    assert.equal(store.assistantSettings.configuration(f.owner).apiKey,providerKey);
    assert.equal(store.mfa.enabled(f.owner),true);
    assert.equal(Boolean(store.session(f.token)),activeSession);
    assert.equal(store.mfa.verify(f.owner,f.codes[generation]),true);
    assert.equal(store.mfa.verify(f.owner,f.codes[generation]),false);
  } finally {
    store.close();
  }
  const db = new DatabaseSync(path,{readOnly:true});
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM workspace_key_rotations').get().count;
    assert.equal(count,generation - 1);
  } finally {
    db.close();
  }
}

test('rekeys a snapshot, retains MFA recovery and restores both key generations', async (t) => {
  const f = await fixture(t);
  const backupKey = randomBytes(32);
  const original = join(f.folder,'original.nribak');
  await exportEncryptedBackup(f.database,original,backupKey);
  const first = await rotateWorkspaceKey(f.database,join(f.folder,'generation-2'));
  assert.equal(first.generation,2);
  assert.notDeepEqual(await readFile(first.database + '.key'),f.key);
  verify(first.database,f,2);
  const second = await rotateWorkspaceKey(first.database,join(f.folder,'generation-3'));
  assert.equal(second.generation,3);
  verify(second.database,f,3);
  const db = new DatabaseSync(second.database,{readOnly:true});
  try {
    const row = db.prepare('SELECT * FROM messages').get();
    const key = createHmac('sha256',await readFile(second.database + '.key')).update('nri-private-message-v1').digest();
    assert.equal(decryptDocument(key,conv,'msg',{ ...row, number: 1 }).toString(),messageText);
  } finally {
    db.close();
  }
  const latest = join(f.folder,'latest.nribak');
  await exportEncryptedBackup(second.database,latest,backupKey);
  verify(await restoreEncryptedBackup(latest,join(f.folder,'restored-latest'),backupKey),{...f,codes:f.codes.map((code,i) => i === 3 ? f.codes[4] : code)},3);
  verify(await restoreEncryptedBackup(original,join(f.folder,'restored-original'),backupKey),f,1);
  verify(f.database,f,1,true);
  await copyFile(f.database + '.key',second.database + '.key');
  assert.throws(() => openWorkspaceStore(second.database),/does not match/);
});

test('a killed or corrupt rotation leaves the original workspace available', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const target = join(f.folder,'interrupted');
  const runner = new URL('../src/key-rotation.js',import.meta.url).href;
  const child = spawn(process.execPath,['--input-type=module','-e',
    'const {rotateWorkspaceKey} = await import(process.argv[1]); await rotateWorkspaceKey(process.argv[2],process.argv[3],{beforePublish: () => { process.stdout.write("ready\\n"); return new Promise(() => setInterval(() => {},1000)); }});',
    runner,f.database,target],{ stdio:['ignore','pipe','inherit'] });
  t.after(() => child.kill('SIGKILL'));
  const exited = once(child,'exit');
  const reached = once(child.stdout,'data');
  const [ready] = await Promise.race([reached,exited.then(() => { throw new Error('Rotation did not reach publication.'); })]);
  assert.equal(String(ready).trim(),'ready');
  const peer = new DatabaseSync(f.database,{timeout:20});
  try {
    assert.throws(() => peer.exec('BEGIN IMMEDIATE'), /locked/);
  } finally {
    peer.close();
  }
  child.kill('SIGKILL');
  await exited;
  await assert.rejects(stat(target),{code:'ENOENT'});
  verify(f.database,f,1,true);
  assert.ok((await readdir(f.folder)).some((name) => name.startsWith('.nri-rotation-')));
  const valid = await rotateWorkspaceKey(f.database,target);
  verify(valid.database,f,2);
  const db = new DatabaseSync(f.database);
  db.exec('UPDATE document_versions SET tag = zeroblob(16)');
  db.close();
  const bad = join(f.folder,'invalid');
  await assert.rejects(rotateWorkspaceKey(f.database,bad));
  await assert.rejects(stat(bad),{code:'ENOENT'});
});
