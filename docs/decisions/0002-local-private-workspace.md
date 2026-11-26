# ADR 0002 · Local accounts and project ownership

- Status: accepted for P1a
- Date: 2026-11-26

## Decision

Keep the existing HTTP and HTML shell. Use parameterized SQLite queries through `node:sqlite` and a numbered startup migration for a single-process local preview on Node.js 24.16 or newer. The operator provisions accounts in a local terminal. Each account acts as one personal workspace. The application derives the workspace from the active session and includes its owner ID in every project lookup and mutation.

Generate passwords during local provisioning. Store salted scrypt hashes, and store a SHA-256 digest of each randomly generated session token. Sessions expire after eight hours and are revoked at sign-out or replaced when signing in with an existing session. The loopback HTTP preview sets an HttpOnly, SameSite=Strict cookie and requires a matching local Origin for writes. Login limits bound the cost of password verification in this single local process. Private responses use no-store.

SQLite is a local development dependency. Project metadata is stored in plaintext with owner-only permissions for newly created files on POSIX systems. The public dashboard continues to display synthetic fixtures. Deployment identity, TLS and Secure cookies, team membership and roles, MFA and recovery, encrypted document storage, audit and backup/recovery remain future work.

## References

- [Node.js 24 SQLite API](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
