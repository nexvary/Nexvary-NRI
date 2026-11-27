import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { link, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { backupWorkspace, newDirectory, validateWorkspace } from './recovery.js';

const signature = Buffer.from('NRIBAK01');
const nonceSize = 12;
const headerSize = signature.length + nonceSize;
const tagSize = 16;
const keySize = 32;
const maxPayload = 32 * 1024 ** 3;
const databaseName = 'workspace.sqlite';
const keyName = databaseName + '.key';

function checkKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== keySize) throw new Error('Expected a 32-byte backup key.');
}

export async function readBackupKey(path) {
  if (!path) throw new Error('Set NRI_BACKUP_KEY_FILE to the backup key file path.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== keySize || (process.platform !== 'win32' && (info.mode & 0o077))) {
      throw new Error('The backup key must be a private regular file containing exactly 32 bytes.');
    }
    const key = Buffer.alloc(keySize);
    await readExactly(file, key, 0);
    return key;
  } finally {
    await file.close();
  }
}

async function withStaging(destination, operation) {
  const staging = await mkdtemp(join(dirname(destination), '.nri-recovery-'));
  try {
    return await operation(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function readExactly(file, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesRead) throw new Error('Truncated backup data.');
    offset += bytesRead;
  }
}

export async function exportEncryptedBackup(source, destination, key) {
  checkKey(key);
  return withStaging(destination, async (staging) => {
    const snapshot = join(staging, 'snapshot');
    await backupWorkspace(source, snapshot);
    const database = await open(join(snapshot, databaseName), 'r');
    try {
      if ((await database.stat()).size + keySize > maxPayload) throw new Error('Backup exceeds the archive size limit.');
      const nonce = randomBytes(nonceSize);
      const header = Buffer.concat([signature, nonce]);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: tagSize });
      cipher.setAAD(header);
      const output = join(staging, 'archive');
      async function* encrypted() {
        yield header;
        yield cipher.update(await readFile(join(snapshot, keyName)));
        for await (const chunk of database.createReadStream({ autoClose: false })) yield cipher.update(chunk);
        yield cipher.final();
        yield cipher.getAuthTag();
      }
      await pipeline(encrypted(), createWriteStream(output, { flags: 'wx', mode: 0o600, flush: true }));
      await link(output, destination);
    } finally {
      await database.close();
    }
  });
}

export async function restoreEncryptedBackup(source, destination, key) {
  checkKey(key);
  return withStaging(destination, async (staging) => {
    const input = await open(source, constants.O_RDONLY | constants.O_NONBLOCK);
    const database = join(staging, databaseName);
    const workspaceKey = join(staging, keyName);
    try {
      const info = await input.stat();
      const { size } = info;
      const sizeWithoutTag = size - tagSize;
      if (!info.isFile() || sizeWithoutTag <= headerSize + keySize || sizeWithoutTag - headerSize > maxPayload) {
        throw new Error('Invalid backup size.');
      }
      const header = Buffer.alloc(headerSize);
      await readExactly(input, header, 0);
      if (!header.subarray(0, signature.length).equals(signature)) throw new Error('Unsupported backup format.');
      const tag = Buffer.alloc(tagSize);
      await readExactly(input, tag, sizeWithoutTag);
      const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(signature.length), { authTagLength: tagSize });
      decipher.setAAD(header);
      decipher.setAuthTag(tag);
      const outputKey = await open(workspaceKey, 'wx', 0o600);
      try {
        async function* decoded() {
          let pendingKeyBytes = keySize;
          const bytes = input.createReadStream({ start: headerSize, end: sizeWithoutTag - 1, autoClose: false });
          for await (const chunk of bytes) {
            const plaintext = decipher.update(chunk);
            const keyBytes = Math.min(pendingKeyBytes, plaintext.length);
            if (keyBytes) {
              await outputKey.writeFile(plaintext.subarray(0, keyBytes));
              pendingKeyBytes -= keyBytes;
            }
            yield plaintext.subarray(keyBytes);
          }
          try {
            yield decipher.final();
          } catch {
            throw new Error('Backup authentication failed.');
          }
        }
        await pipeline(decoded(), createWriteStream(database, { flags: 'wx', mode: 0o600, flush: true }));
        await outputKey.sync();
      } finally {
        await outputKey.close();
      }
    } finally {
      await input.close();
    }
    await validateWorkspace(database, workspaceKey);
    return newDirectory(destination, async (directory) => {
      const target = join(directory, databaseName);
      await link(workspaceKey, join(directory, keyName));
      await link(database, target);
      return target;
    });
  });
}
