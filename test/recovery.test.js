import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
