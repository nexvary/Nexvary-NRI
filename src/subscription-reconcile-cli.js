import { openWorkspaceStore, workspaceDatabasePath } from './store.js';

const store = openWorkspaceStore(workspaceDatabasePath());
try {
  console.log(JSON.stringify(store.licensing.reconcileExpirations()));
} finally {
  store.close();
}
