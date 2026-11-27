# Production entitlement policy

Direct HTTPS defaults to enforced entitlements. The executable permits the compatibility staging mode only on a loopback bind. Do not expose a staging listener through a proxy. The HTTP test fixture can enable enforcement on loopback without TLS.

Before serving external traffic, use an MFA-enrolled licensing operator to create a plan in Control Center, save its module grants, and assign it to test accounts. Existing plans migrate with zero grants. Adding an assignment alone grants no product access. For continuity, rehearse provisioning on a restored workspace before upgrading. Account security, data export, and operator recovery remain reachable during provisioning. Never use public staging mode to work around missing grants.

## Route inventory

The source of truth is the explicit route-kind table in `src/entitlements.js`. Each line applies to every method supported by the route, including HEAD, download, export, and mutation. Composite surfaces require every listed module because their current page or export combines records from those modules. This is commercial eligibility only. Existing ownership, resource grant, participant, role, quota, MFA, origin, and session checks are still required.

| Routes or surfaces | Required module IDs |
|---|---|
| Signed-in dashboard aggregates at `/` | 01, 02, 03, 04, 05, 08, 09 |
| Workspace and project CRUD | 02 |
| Document upload, metadata, version downloads/previews, collections and reader | 03 |
| Library search and citation exchange | 03, 04 |
| Reference picker and project validator | 04 |
| Evidence picker and matrix export | 05 |
| Evidence matrix and linking | 04, 05 |
| Readiness picker | 06 |
| Readiness assessment and source linking | 05, 06 |
| Economics picker, project page and export | 07 |
| AI settings | 08 |
| AI review and answer routes | 04, 08 |
| Researcher network | 09 |
| Collaboration network | 09, 10 |
| Team inbox/work, project invitation and scope-summary sharing routes | 10 |
| Team project, manuscript and scientific review page | 02, 05, 06, 10 |
| Shared resource catalog, grants, versions and exports | 03, 04, 05, 06, 10, 15 |
| Messages and threads | 11 |
| Observatory and topics | 12 |
| CSV analysis and export | 13 |
| Education and learning progress | 14 |
| Report project picker | 15 |
| Project report preview and rendering | 04, 05, 06, 15 |

Signed-in message badges require 11, and invitation badges require 10. An unknown workspace route kind is denied. Unknown URL paths remain 404. Module redirects pass no private data and enforcement runs at their destination. The public anonymous dashboard, About System (16), About Developer (17), stylesheet, PDF reader assets and health probe carry no private workspace data. Login, logout, MFA, account settings, privacy export/deletion, message moderation and Control Center are subscription-independent. Moderation and the two Control Center URLs retain independent administrative checks. Deployment (19) is an operator function, with no customer route. Control Center is part of module 20 but is protected by operator permissions instead of customer plans.

Grant edits replace the full plan grant set in a transaction, reject stale edits, and record an audit event. Every protected request evaluates the current assignment, validity and grants together. Protected asynchronous operations recheck access before persisting or delivering output when they cross an asynchronous boundary. Already dispatched provider requests cannot be retracted by access revocation. Existing authorized account export remains the portability path for accounts with expired or inactive subscriptions. Customer data is preserved.

Organization assignment and role-specific institutional overrides are future work. The current policy only consumes account assignments. A plan grant never confers access to another account's records.
