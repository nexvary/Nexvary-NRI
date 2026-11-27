# Local and HTTPS staging deployment

Install the Node version recorded in CI, OpenSSL for the transport test, and the bilingual report prerequisites in README. Run `npm ci --omit=optional --ignore-scripts` in the release directory. Use a dedicated unprivileged service account, a protected state directory and a tested backup. [Backup, restore and rollback](RECOVERY.md)

## Direct HTTPS configuration

Set the canonical public origin, certificate chain, private key path, and the address and port assigned to the service. The server accepts the configured authority and checks that state-changing requests come from the configured origin. The TLS cookie uses a host prefix and Secure, HttpOnly and SameSite attributes. Sessions expire after 30 idle minutes or eight hours of total lifetime. Updating from earlier versions can require users to sign in again.

Example for an isolated staging host:

```dotenv
NRI_PUBLIC_ORIGIN=https://nri.example.test:8443
HOST=127.0.0.1
PORT=8443
NRI_TLS_CERT_FILE=/etc/nri/tls/fullchain.pem
NRI_REPORT_PYTHON=/opt/nri/report-runtime/bin/python
```

The example systemd unit expects `/etc/nri/nri.env`, loads the TLS key as a credential, and keeps SQLite in its protected state directory. For a manual start, also set `NRI_TLS_KEY_FILE` to the protected private key and set `NRI_DB_PATH` to the selected workspace. Install the pinned Node runtime at `/opt/nri/runtime` or set an absolute `ExecStart` path for it. Use the certificates for the actual host. Keep certificate renewal and service restart under operator control. The service listens on an unprivileged port. For direct external access, set `HOST` to an explicitly approved interface address and configure firewall policy.

Run one application process per SQLite database. Use direct TLS in this configuration. The application uses the socket address for login rate limits and ignores untrusted forwarding headers. Before placing a proxy in front of the service, separately verify its TLS and client-address trust configuration.

### Provisioning module access

HTTPS now starts in enforced entitlement mode by default. Before exposing the service, provision plan grants and assignments in the MFA-protected Control Center. Existing plans start with no module grants. The deployment test must confirm an unassigned account is blocked, an explicitly entitled account can access its own project, and another account's project remains inaccessible. See the [route inventory and rollout rules](ENTITLEMENTS.md).

An isolated loopback preview may use `NRI_ENTITLEMENT_MODE=staging` for compatible fixture behavior. Staging is rejected on non-loopback binds. Keep it isolated from public proxies.

## Verification and operations

- Check `GET /healthz` over verified HTTPS. Saturation and unhealthy responses can be monitored through request status, duration and health events in the service logs.
- Logs contain timestamps, event names, route categories, method, status and duration. Store and rotate the journal according to the local retention policy. Keep private keys, credential material and workspace contents out of operational logs.
- The database and paired workspace key use owner-only file permissions in HTTPS mode on Unix-like hosts. Protect and back up the key with its database. The paired key is required for documents and encrypted account secrets. Key rotation and external key management require a separately tested migration.
- Rehearse upgrade and rollback on a restored copy, check ownership and export paths, and verify PDF/DOCX generation before promoting a release. Concurrent TLS tests exercise 48 reads across eight accounts and verify access isolation. Use representative staging load before setting production capacity and alert thresholds.
- Billing stays disabled. A production endpoint, alert destination and retention settings need operator approval and environment-specific verification.

## Optional encrypted backup timer

On Debian or Ubuntu with systemd credentials support, install `deploy/nri-backup.service` and `deploy/nri-backup.timer` beside the application unit. Create `/var/backups/nri` on a protected encrypted volume with ownership `nri:nri` and mode `0700`. Provision a separate 32-byte archive key at `/etc/nri/backup.key` using the [recovery guide](RECOVERY.md#encrypted-export-and-restore). Keep the key accessible to systemd with owner-only permissions. Adjust paths for the selected host.

After installation, run `systemctl start nri-backup.service`, inspect its journal and restore the archive to a separate staging directory. Enable recurring exports with `systemctl enable --now nri-backup.timer` after the restore drill. Monitor failed units and the age of the latest successful archive using the host's alerting. Set retention and off-host replication with the operator. Keep backup keys separate from replicated archives.

## SQLite workload measurements

Run `node scripts/workspace-load.mjs 24 20` and `node scripts/workspace-load.mjs 48 20` from the checkout. The harness provisions a disposable on-disk SQLite database, warms it with one project per account, and uses one loopback HTTP process with concurrent client sessions. Each round loads the account's project list, checks rejection of another account's direct project URL, and creates a project through the normal form endpoint. It checks every response and the final per-account project count.

| Concurrent clients | Total requests | Requests/sec | Read p95 | Write p95 | Denial p95 | Process RSS at end | SQLite size |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 | 1,440 | 1,142 | 40 ms | 28 ms | 29 ms | 148 MiB | 704,512 B |
| 48 | 2,880 | 1,280 | 57 ms | 46 ms | 46 ms | 211 MiB | 847,872 B |

Measured on 2026-11-27 using Node.js 24.22.3 in the development environment. Both runs completed with all expected results and cross-account denials. RSS includes the client and server in the same process. These short runs support retaining SQLite for the measured workload. On the target host, repeat with realistic data volume, concurrent report rendering and uploads, HTTPS, backups, and a sustained workload before setting capacity limits or evaluating a different database.

### Scheduled subscription expiry

Install `deploy/nri-subscription-reconcile.service` and its companion timer alongside the existing NRI units when provisioning a target host. Enable the timer with `systemctl enable --now nri-subscription-reconcile.timer` after the workspace is initialized. The unprivileged job records due trial, active and grace expirations and their audit entries, processing up to 500 accounts and 500 organizations each run. Expiry is already enforced on requests at the stored timestamp. The job does not charge, initiate renewals, or alter research data.
