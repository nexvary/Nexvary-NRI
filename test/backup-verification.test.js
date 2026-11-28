import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportEncryptedBackup } from '../src/encrypted-backup.js';
import { totp } from '../src/mfa.js';
import { hashPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

test('security-role backup verification authenticates and validates real restores with durable results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-control-backup-check-'));
  const database = join(directory, 'workspace.sqlite');
  const backupDirectory = join(directory, 'backups');
  const backupKeyFile = join(directory, 'backup.key');
  await mkdir(backupDirectory);
  const key = randomBytes(32);
  await writeFile(backupKeyFile, key, { mode: 0o600 });
  await chmod(backupKeyFile, 0o600);
  let store;
  try {
    store = openWorkspaceStore(database, Date.now, { backupDirectory, backupKeyFile });
    const email = 'backup-admin@example.test';
    store.addAccount(email, await hashPassword('synthetic backup operator password'));
    const actor = store.credentials(email).id;
    store.licensing.setOperator(actor, true);
    const token = store.newSession(actor);
    assert.equal(store.mfa.begin(actor), true);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bits = [...store.mfa.pending(actor)].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
    const secret = Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
    assert.equal(store.mfa.confirm(actor, totp(secret, Math.floor(Date.now() / 30_000)), token).length, 8);
    const archiveName = 'workspace-20261128T000000Z.nribak';
    const archive = join(backupDirectory, archiveName);
    await exportEncryptedBackup(database, archive, key);
    const damagedName = 'workspace-20261128T000001Z.nribak';
    const damaged = Buffer.from(await readFile(archive));
    damaged[Math.floor(damaged.length / 2)] ^= 1;
    await writeFile(join(backupDirectory, damagedName), damaged);

    assert.equal((await store.operations.verifyBackup(actor, archiveName)).status, 'verified');
    assert.equal((await store.operations.verifyBackup(actor, damagedName)).status, 'failed');
    assert.equal((await store.operations.verifyBackup('unprivileged', archiveName)).status, 'forbidden');
    const history = await store.operations.backupHistory(actor);
    assert.equal(history.files.find((file) => file.name === archiveName).verification.result, 'verified');
    assert.equal(history.files.find((file) => file.name === damagedName).verification.result, 'failed');

    const password = 'synthetic backup operator password';
    const app = createApp(store);
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const origin = `http://127.0.0.1:${app.address().port}`;
    const cookie = `nri_session=${token}`;
    const securityPath = '/control-center/security?lang=en';
    const securityPage = await fetch(origin + securityPath, { headers: { cookie } });
    assert.equal(securityPage.status, 200);
    assert.match(await securityPage.text(), /Authenticate and restore-check archive/);
    const check = await fetch(origin + securityPath, { method: 'POST', redirect: 'manual', headers: { origin, cookie },
      body: new URLSearchParams({ intent: 'verify-backup', 'backup-name': archiveName, password }) });
    assert.equal(check.status, 303);
    assert.match(check.headers.get('location'), /verification=verified/);
    const checkedPage = await fetch(origin + check.headers.get('location'), { headers: { cookie } });
    assert.match(await checkedPage.text(), /Authenticated restore passed/);
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    store = openWorkspaceStore(database, Date.now, { backupDirectory, backupKeyFile });
    assert.equal((await store.operations.backupHistory(actor)).files.find((file) => file.name === archiveName).verification.result, 'verified');
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
