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

## Verification and operations

- Check `GET /healthz` over verified HTTPS. Saturation and unhealthy responses can be monitored through request status, duration and health events in the service logs.
- Logs contain timestamps, event names, route categories, method, status and duration. Store and rotate the journal according to the local retention policy. Keep private keys, credential material and workspace contents out of operational logs.
- The database and paired workspace key use owner-only file permissions in HTTPS mode on Unix-like hosts. Protect and back up the key with its database. The paired key is required for documents and encrypted account secrets. Key rotation and external key management require a separately tested migration.
- Rehearse upgrade and rollback on a restored copy, check ownership and export paths, and verify PDF/DOCX generation before promoting a release. Concurrent TLS tests exercise 48 reads across eight accounts and verify access isolation. Use representative staging load before setting production capacity and alert thresholds.
- Billing stays disabled. A production endpoint, alert destination and retention settings need operator approval and environment-specific verification.
