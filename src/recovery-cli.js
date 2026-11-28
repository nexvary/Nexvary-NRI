import { rotateWorkspaceKey } from './key-rotation.js';
import { exportEncryptedBackup, readBackupKey, restoreEncryptedBackup } from './encrypted-backup.js';
import { resolve } from 'node:path';
import { backupWorkspace, restoreWorkspace } from './recovery.js';
import { workspaceDatabasePath } from './store.js';

const [command, source, destination, ...rest] = process.argv.slice(2);
try {
  if (command === 'backup' && source && !destination && rest.length === 0) {
    await backupWorkspace(workspaceDatabasePath(), resolve(source));
    console.log('Workspace backup verified and saved.');
  } else if (command === 'restore' && source && destination && rest.length === 0) {
    const database = await restoreWorkspace(resolve(source), resolve(destination));
    console.log('Workspace restored to ' + database);
  } else if (command === 'export' && source && !destination && rest.length === 0) {
    const key = await readBackupKey(process.env.NRI_BACKUP_KEY_FILE);
    await exportEncryptedBackup(workspaceDatabasePath(), resolve(source), key);
    console.log('Encrypted workspace backup saved.');
  } else if (command === 'import' && source && destination && rest.length === 0) {
    const key = await readBackupKey(process.env.NRI_BACKUP_KEY_FILE);
    const database = await restoreEncryptedBackup(resolve(source), resolve(destination), key);
    console.log('Authenticated workspace restored to ' + database);
  } else if (command === 'rotate-key' && source && !destination && rest.length === 0) {
    const rotated = await rotateWorkspaceKey(workspaceDatabasePath(), resolve(source));
    console.log('Verified workspace key generation ' + rotated.generation + ' prepared at ' + rotated.database);
  } else {
    throw new Error('Usage: npm run workspace:backup -- NEW_DIRECTORY or npm run workspace:restore -- BACKUP_DIRECTORY NEW_DIRECTORY, workspace:export -- NEW_ARCHIVE, or workspace:import -- ARCHIVE NEW_DIRECTORY, or workspace:rotate-key -- NEW_DIRECTORY');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
