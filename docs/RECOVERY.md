# Local workspace recovery

Run recovery commands from the project directory against a workspace you administer. They create a new directory and reject an existing destination.

```sh
NRI_DB_PATH=/path/to/workspace.sqlite npm run workspace:backup -- /private/new-backup
npm run workspace:restore -- /private/new-backup /private/new-restore
NRI_DB_PATH=/private/new-restore/workspace.sqlite npm start
```

The bundle holds a consistent SQLite snapshot, the paired PDF encryption key, and a SHA-256 manifest. The backup tool verifies the data and key pairing. The restore tool validates both hashes and SQLite integrity before use. The restore creates a separate database and requires fresh sign-in. Verify access and expected data on the restored database before switching an active instance to it.

Account and project metadata are stored in plaintext SQLite. PDF bytes are encrypted, and the bundle contains their decryption key. Keep backups on restricted, encrypted storage and never commit or publish them. Checksums detect accidental corruption and are not authentication for an untrusted backup. The local tool does not schedule backups or upload them.

NRI remains a loopback preview. Production deployment needs HTTPS, shared-project authorization, hardened identity, monitoring, operational recovery drills and a hosting decision. Billing is disabled.

## Account deletion and retention

Account deletion requires the current password, an authenticator or recovery code when MFA is enabled, and the typed confirmation. In the live SQLite workspace, one transaction removes the account, credentials, all sessions, owned projects and document versions, conversation history for both participants, moderation reports attached to those conversations, and account-scoped records. Decisions on surviving reports retain their outcome and timestamp with a blank reviewer if the reviewer account is deleted. SQLite secure deletion overwrites deleted records in the active database. Existing filesystem copies, journals, snapshots and user downloads have separate retention.

The app has no scheduled backup retention on a local workspace. The operator controls existing copies and removes expired bundles under their retention policy. A backup taken before deletion can restore the account and its credentials into a separate workspace. Before promoting an older backup, reconcile previously processed deletions. A backup taken after deletion excludes that account and its deleted data. Every restore invalidates stored sessions.

Account export is a sensitive JSON download and includes owned PDF versions as base64. It includes the user's sent message bodies and excludes other participants' message bodies, credential material, recovery codes, session tokens and provider API keys. The response has a 64 MiB limit. Large documents can also be downloaded individually through the owned project library.

Team manuscripts, reviews, notes and tasks belong to their project. Deleting a contributor removes their memberships and clears their identity on surviving project contributions and audit records. Deleting the project owner removes those projects and team records. An export includes manuscript versions, review records, notes and tasks from owned projects or authored by the exporting account.

## Local release and recovery drill

1. Stop writes before a release and create a new protected backup using the commands above.
2. Restore the bundle to a separate directory. Start the candidate build against the restored database on a spare loopback port. Startup applies versioned schema changes transactionally and rejects a database newer than the running build.
3. Check `GET /healthz`, sign in with a test account and verify an owned document, a project team, and any plan limits in use. The health endpoint returns HTTP 200 when the SQLite schema is available and current or 503 on failure. It exposes no account or plan details. Collect its status and service stderr using the operator's existing local monitoring.
4. Promote the candidate only after the drill succeeds. For rollback, select the prior build and restore the pre-upgrade bundle into a separate directory. Reconcile deletions and other writes since the snapshot before switching workspaces. Record the measured restore time and data-loss window during the drill.

The current release binds to loopback. Public hosting, reverse-proxy trust, HTTPS session cookies, production alerts, key administration and disaster-recovery objectives require their own verification before public deployment.
