import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databaseName = 'workspace.sqlite';
const keyName = databaseName + '.key';
const manifestName = 'manifest.json';

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function validateWorkspace(databasePath, keyPath) {
  if ((await stat(keyPath)).size !== 32) throw new Error('Invalid document encryption key size.');
  const fingerprint = await hashFile(keyPath);
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  try {
    if (db.prepare('PRAGMA quick_check').all().some((row) => row.quick_check !== 'ok')) {
      throw new Error('SQLite integrity check failed.');
    }
    if (db.prepare('SELECT fingerprint FROM document_key WHERE id = 1').get()?.fingerprint !== fingerprint) {
      throw new Error('Document key does not match the database.');
    }
  } finally {
    db.close();
  }
}

export async function newDirectory(destination, operation) {
  await mkdir(destination, { mode: 0o700 });
  try {
    return await operation(destination);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function backupWorkspace(source, destination) {
  return newDirectory(destination, async (dir) => {
    const database = join(dir, databaseName);
    const key = join(dir, keyName);
    const sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    try {
      sourceDb.prepare('VACUUM INTO ?').run(database);
    } finally {
      sourceDb.close();
    }
    await chmod(database, 0o600);
    await copyFile(source + '.key', key, constants.COPYFILE_EXCL);
    await chmod(key, 0o600);
    await validateWorkspace(database, key);
    const copy = new DatabaseSync(database);
    try {
      // A restore requires fresh sign-in. Compact the snapshot again to purge old session tokens.
      copy.exec('PRAGMA secure_delete = ON; DELETE FROM sessions; VACUUM;');
    } finally {
      copy.close();
    }
    const manifest = { version: 1, generatedAt: new Date().toISOString(),
      databaseSha256: await hashFile(database), keySha256: await hashFile(key) };
    await writeFile(join(dir, manifestName), JSON.stringify(manifest) + '\n', { mode: 0o600, flag: 'wx', flush: true });
    return manifest;
  });
}

export async function restoreWorkspace(source, destination) {
  const manifestPath = join(source, manifestName);
  if ((await stat(manifestPath)).size > 4096) throw new Error('Invalid backup manifest.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.databaseSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(manifest.keySha256 ?? '')) throw new Error('Unsupported backup manifest.');
  return newDirectory(destination, async (dir) => {
    const database = join(dir, databaseName);
    const key = join(dir, keyName);
    await copyFile(join(source, databaseName), database, constants.COPYFILE_EXCL);
    await copyFile(join(source, keyName), key, constants.COPYFILE_EXCL);
    await Promise.all([chmod(database, 0o600), chmod(key, 0o600)]);
    if (await hashFile(database) !== manifest.databaseSha256 || await hashFile(key) !== manifest.keySha256) {
      throw new Error('Backup checksum mismatch.');
    }
    await validateWorkspace(database, key);
    return database;
  });
}
