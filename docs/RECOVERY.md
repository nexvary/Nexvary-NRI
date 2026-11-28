# Local workspace recovery

## Encrypted export and restore

Generate a separate random 32-byte backup key on a trusted operator host. Keep it on restricted, encrypted storage, with an independently protected recovery copy. The key file must have owner-only access. Set only its **path** in the environment.

```sh
(umask 077 && set -C && openssl rand 32 > /private/nri-backup.key)
export NRI_BACKUP_KEY_FILE=/private/nri-backup.key
NRI_DB_PATH=/path/to/workspace.sqlite npm run workspace:export -- /private/workspace.nribak
npm run workspace:import -- /private/workspace.nribak /private/new-restore
```

The versioned archive uses AES-256-GCM with a random nonce and a full-length authentication tag. It protects both SQLite metadata and the paired workspace key. Retain access to the backup key used for each archive. Import authenticates the archive and checks SQLite integrity and key pairing before making the database available. Active sessions are removed from snapshots. Import and export refuse to overwrite destinations.

Use a protected, encrypted volume for the destination parent directory. Temporary decrypted data lives inside a private staging directory there. A process killed mid-operation may leave a `.nri-recovery-*` directory or an incomplete restore directory. With the process stopped, remove those leftovers and retry with a new destination. Use only a database returned by a successful import. Each archive supports up to 32 GiB of plaintext payload. Allow space for the working snapshot and archive to coexist.

## Local paired backup directories

Run recovery commands from the project directory against a workspace you administer. They create a new directory and reject an existing destination.

```sh
NRI_DB_PATH=/path/to/workspace.sqlite npm run workspace:backup -- /private/new-backup
npm run workspace:restore -- /private/new-backup /private/new-restore
NRI_DB_PATH=/private/new-restore/workspace.sqlite npm start
```

The bundle holds a consistent SQLite snapshot, the paired PDF encryption key, and a SHA-256 manifest. The backup tool verifies the data and key pairing. The restore tool validates both hashes and SQLite integrity before use. The restore creates a separate database and requires fresh sign-in. Verify access and expected data on the restored database before switching an active instance to it.

Account and project metadata are stored in plaintext SQLite. PDF bytes are encrypted, and the bundle contains their decryption key. Keep backups on restricted, encrypted storage and never commit or publish them. Checksums detect accidental corruption and are not authentication for an untrusted backup. The local tool does not schedule backups or upload them.

The default preview binds to loopback. Direct HTTPS staging is available through the [deployment guide](DEPLOYMENT.md). Public production deployment and operational recovery objectives require verification on the selected host. Billing is disabled.

## Account deletion and retention

Account deletion requires the current password, an authenticator or recovery code when MFA is enabled, and the typed confirmation. In the live SQLite workspace, one transaction removes the account, credentials, all sessions, owned projects and document versions, private collections and reading marks, conversation history for both participants, moderation reports attached to those conversations, and account-scoped records. Decisions on surviving reports retain their outcome and timestamp with a blank reviewer if the reviewer account is deleted. SQLite secure deletion overwrites deleted records in the active database. Existing filesystem copies, journals, snapshots and user downloads have separate retention.

The optional backup timer exports encrypted archives. Retention remains operator-managed. The operator controls existing copies and removes expired bundles under their retention policy. A backup taken before deletion can restore the account and its credentials into a separate workspace. Before promoting an older backup, reconcile previously processed deletions. A backup taken after deletion excludes that account and its deleted data. Every restore invalidates stored sessions.

Account export is a sensitive JSON download and includes owned PDF versions as base64. It includes the user's sent message bodies and excludes other participants' message bodies, credential material, recovery codes, session tokens and provider API keys. The response has a 64 MiB limit. Large documents can also be downloaded individually through the owned project library.

Team manuscripts, reviews, notes and tasks belong to their project. Deleting a contributor removes their memberships and clears their identity on surviving project contributions and audit records. Deleting the project owner removes those projects and team records. An export includes manuscript text and metadata revisions, review records, notes and tasks from owned projects or authored by the exporting account.

## Local release and recovery drill

1. Stop writes before a release and create a new protected backup using the commands above.
2. Restore the bundle to a separate directory. Start the candidate build against the restored database on a spare loopback port. Startup applies versioned schema changes transactionally and rejects a database newer than the running build.
3. Check `GET /healthz`, sign in with a test account and verify an owned document, a project team, and any plan limits in use. The health endpoint returns HTTP 200 when the SQLite schema is available and current or 503 on failure. It exposes no account or plan details. Collect its status and service stderr using the operator's existing local monitoring.
4. Promote the candidate only after the drill succeeds. For rollback, select the prior build and restore the pre-upgrade bundle into a separate directory. Reconcile deletions and other writes since the snapshot before switching workspaces. Record the measured restore time and data-loss window during the drill.

Use the configured direct HTTPS mode for staging. Public hosting, production alerts, key rotation, and disaster-recovery objectives require their own verification before public deployment.


## Workspace encryption key rotation

Stop all service processes using the source before preparing and checking a rotated copy. Use a protected encrypted volume and a new destination directory.

```sh
NRI_DB_PATH=/private/current/workspace.sqlite npm run workspace:rotate-key -- /private/new-generation
```

Rotation takes a SQLite writer lock, snapshots the source, and migrates the candidate in one database transaction. It verifies the document, message, MFA seed and provider credential envelopes with the new key. Existing one-time recovery codes retain their purpose-specific HMAC key, wrapped under the new workspace key. The audit table records the generation and time. The source remains available for rollback and is never switched by the command.

An interrupted run can leave a private `.nri-rotation-*` staging directory or a destination containing only a key. Keep the original source in service or roll back to it, remove incomplete staging directories with the process stopped, then run again with a new destination. Only promote a candidate after authenticated restore and application smoke tests. Keep the old workspace and compatible backup for the approved rollback window, then retire them under the operator's storage and key-retention policy. Ordinary file deletion does not guarantee sanitization on SSDs, copy-on-write filesystems or snapshots. Pre-rotation backups still contain their original workspace key and require the archive key used to protect them.

Application-layer encryption covers document bytes, private message bodies, authenticator seeds, provider API credentials and the wrapped recovery HMAC key. Filenames, project metadata, manuscript text and other structured SQLite fields can remain readable on disk. Store the live SQLite database and paired key separately from archives, with restricted permissions and volume encryption.
