import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFile, chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportEncryptedBackup, readBackupKey, restoreEncryptedBackup } from '../src/encrypted-backup.js';
import { backupWorkspace, restoreWorkspace } from '../src/recovery.js';
import { openWorkspaceStore } from '../src/store.js';

test('backs up a live workspace, restores encrypted PDF data and excludes active sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-recovery-'));
  const dbPath = join(directory, 'live.sqlite');
  const bundle = join(directory, 'backup');
  const restored = join(directory, 'restored');
  const tampered = join(directory, 'tampered');
  const live = openWorkspaceStore(dbPath);
  try {
    live.addAccount('recovery@example.test', { salt: randomBytes(16), hash: randomBytes(32) });
    const owner = live.credentials('recovery@example.test').id;
    const session = live.newSession(owner);
    const project = live.createProject(owner, { title: 'Recovery fixture', description: '' });
    const bytes = Buffer.from('%PDF-1.4\nIllustrative recovery test');
    const document = live.documents.create(owner, project, { name: 'Methods.pdf', bytes });
    await backupWorkspace(dbPath, bundle);
    assert.ok(live.session(session));
    const archive = await readFile(join(bundle, 'workspace.sqlite'));
    assert.equal(archive.includes(bytes), false);
    const restoredPath = await restoreWorkspace(bundle, restored);
    const copy = openWorkspaceStore(restoredPath);
    try {
      assert.equal(copy.getProject(owner, project).title, 'Recovery fixture');
      assert.deepEqual(copy.documents.download(owner, project, document, 1).bytes, bytes);
      assert.equal(copy.session(session), undefined);
    } finally {
      copy.close();
    }
    await assert.rejects(restoreWorkspace(bundle, restored), { code: 'EEXIST' });
    await appendFile(join(bundle, 'workspace.sqlite'), 'x');
    await assert.rejects(restoreWorkspace(bundle, tampered), /checksum mismatch/);
    await assert.rejects(stat(tampered), { code: 'ENOENT' });
  } finally {
    live.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('exports and restores authenticated backups without publishing failed restores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nri-encrypted-backup-'));
  const database = join(directory, 'live.sqlite');
  const archive = join(directory, 'backup.nribak');
  const keyPath = join(directory, 'backup.key');
  const restore = join(directory, 'restored');
  const failure = join(directory, 'failed');
  const secret = randomBytes(32);
  const live = openWorkspaceStore(database);
  try {
    await writeFile(keyPath, secret, { mode: 0o600 });
    assert.deepEqual(await readBackupKey(keyPath), secret);
    if (process.platform !== 'win32') {
      await chmod(keyPath, 0o644);
      await assert.rejects(readBackupKey(keyPath), /private regular file/);
    }
    const email = 'encrypted-backup@example.test';
    live.addAccount(email, { salt: randomBytes(16), hash: randomBytes(32) });
    const { id } = live.credentials(email);
    const project = live.createProject(id, { title: 'Confidential research metadata', description: '' });
    const documentBytes = Buffer.from('%PDF-1.4\nFixture for authenticated restoration');
    const document = live.documents.create(id, project, { name: 'Backup fixture.pdf', bytes: documentBytes });
    const session = live.newSession(id);

    await exportEncryptedBackup(database, archive, secret);
    const ciphertext = await readFile(archive);
    assert.equal(ciphertext.includes('Confidential research metadata'), false);
    assert.equal(ciphertext.includes(await readFile(database + '.key')), false);
    await assert.rejects(exportEncryptedBackup(database, archive, secret), { code: 'EEXIST' });
    assert.deepEqual(await readFile(archive), ciphertext);

    await assert.rejects(restoreEncryptedBackup(archive, failure, randomBytes(32)), /authentication failed/);
    const damaged = Buffer.from(ciphertext);
    damaged[damaged.length - 17] ^= 1;
    const tampered = join(directory, 'tampered.nribak');
    await writeFile(tampered, damaged);
    await assert.rejects(restoreEncryptedBackup(tampered, failure, secret), /authentication failed/);
    await writeFile(tampered, ciphertext.subarray(0, 24));
    await assert.rejects(restoreEncryptedBackup(tampered, failure, secret), /Invalid backup size/);
    assert.equal((await readdir(directory)).some((name) => name.startsWith('.nri-recovery-')), false);
    await assert.rejects(stat(failure), { code: 'ENOENT' });

    const restoredPath = await restoreEncryptedBackup(archive, restore, secret);
    const copy = openWorkspaceStore(restoredPath);
    try {
      assert.equal(copy.getProject(id, project).title, 'Confidential research metadata');
      assert.deepEqual(copy.documents.download(id, project, document, 1).bytes, documentBytes);
      assert.equal(copy.session(session), undefined);
      assert.equal(live.session(session).id, id);
    } finally {
      copy.close();
    }
    await assert.rejects(restoreEncryptedBackup(archive, restore, secret), { code: 'EEXIST' });
  } finally {
    live.close();
    await rm(directory, { recursive: true, force: true });
  }
});
