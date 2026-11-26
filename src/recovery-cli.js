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
  } else {
    throw new Error('Usage: npm run workspace:backup -- NEW_DIRECTORY or npm run workspace:restore -- BACKUP_DIRECTORY NEW_DIRECTORY');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
