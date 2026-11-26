import { randomBytes } from 'node:crypto';
import { hashPassword, normalizeAddress } from './password.js';
import { openWorkspaceStore, workspaceDatabasePath } from './store.js';

const email = normalizeAddress(process.argv[2] ?? '');
if (process.argv.length !== 3 || !email) {
  console.error('Usage: npm run account:create -- researcher@example.org');
  process.exitCode = 1;
} else {
  const store = openWorkspaceStore(workspaceDatabasePath());
  try {
    const password = randomBytes(24).toString('base64url');
    store.addAccount(email, await hashPassword(password));
    console.log(`Account: ${email}\nGenerated password: ${password}`);
  } catch (error) {
    if (error.errcode !== 2067) throw error;
    console.error('An account already uses that email address.');
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
