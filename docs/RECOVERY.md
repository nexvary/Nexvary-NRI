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
