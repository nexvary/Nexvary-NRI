import { normalizeAddress } from './password.js';
import { openWorkspaceStore, workspaceDatabasePath } from './store.js';

const [, , input = '', action] = process.argv;
const email = normalizeAddress(input);
if (!email || !['grant-message-moderator', 'revoke-message-moderator'].includes(action)) {
  console.error('Usage: npm run account:role -- EMAIL grant-message-moderator|revoke-message-moderator');
  process.exitCode = 2;
} else {
  const store = openWorkspaceStore(workspaceDatabasePath());
  try {
    const account = store.credentials(email);
    if (!account) {
      console.error('Account unavailable.');
      process.exitCode = 1;
    } else {
      store.messages.setModerator(account.id, action === 'grant-message-moderator');
      console.log('Message moderation role updated.');
    }
  } finally {
    store.close();
  }
}
