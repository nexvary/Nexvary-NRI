import { normalizeAddress } from './password.js';
import { openWorkspaceStore, workspaceDatabasePath } from './store.js';

const [, , input = '', action] = process.argv;
const email = normalizeAddress(input);
if (!email || !['grant-message-moderator', 'revoke-message-moderator', 'grant-license-operator', 'revoke-license-operator', 'grant-billing-reviewer', 'revoke-billing-reviewer',
  'grant-support-reviewer', 'revoke-support-reviewer', 'grant-security-reviewer', 'revoke-security-reviewer'].includes(action)) {
  console.error('Usage: npm run account:role -- EMAIL grant-message-moderator|revoke-message-moderator|grant-license-operator|revoke-license-operator|grant-billing-reviewer|revoke-billing-reviewer|grant-support-reviewer|revoke-support-reviewer|grant-security-reviewer|revoke-security-reviewer');
  process.exitCode = 2;
} else {
  const store = openWorkspaceStore(workspaceDatabasePath());
  try {
    const account = store.credentials(email);
    if (!account) {
      console.error('Account unavailable.');
      process.exitCode = 1;
    } else {
      const enabled = action.startsWith('grant-');
      if (action.endsWith('license-operator')) store.licensing.setOperator(account.id, enabled);
      else if (action.endsWith('billing-reviewer')) store.billing.setReviewer(account.id, enabled);
      else if (action.endsWith('support-reviewer')) store.operations.setReviewer(account.id, 'support', enabled);
      else if (action.endsWith('security-reviewer')) store.operations.setReviewer(account.id, 'security', enabled);
      else store.messages.setModerator(account.id, enabled);
      console.log('Account role updated.');
    }
  } finally {
    store.close();
  }
}
