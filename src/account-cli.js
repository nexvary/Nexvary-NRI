import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword, normalizeAddress } from './password.js';
import { openWorkspaceStore, workspaceDatabasePath } from './store.js';

const reset = process.argv[2] === '--reset';
const email = normalizeAddress(process.argv[reset ? 3 : 2] ?? '');
const databasePath = workspaceDatabasePath();
if (process.argv.length !== (reset ? 4 : 3) || !email || (reset && !process.stdout.isTTY)) {
  console.error('Use a private terminal: npm run account:create -- researcher@example.org, or npm run account:reset -- researcher@example.org');
  process.exitCode = 1;
} else if (reset && !existsSync(databasePath)) {
  console.error('The workspace database does not exist. Check NRI_DB_PATH.');
  process.exitCode = 1;
} else {
  const store = openWorkspaceStore(databasePath);
  try {
    const password = randomBytes(24).toString('base64url');
    const credentials = await hashPassword(password);
    if (reset) {
      if (!store.resetPassword(email, credentials)) {
        console.error('No local account uses that email address.');
        process.exitCode = 1;
      }
    } else {
      store.addAccount(email, credentials);
    }
    if (!process.exitCode) console.log(`Account: ${email}\nGenerated password: ${password}`);
  } catch (error) {
    if (error.errcode !== 2067) throw error;
    console.error('An account already uses that email address.');
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
