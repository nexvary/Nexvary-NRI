# NRI-08 resumption checkpoint

Owner authorization to resume arrived on 2026-11-27 (Cairo). Keep [draft PR #19](https://github.com/nexvary/Nexvary-NRI/pull/19) open. Branch: `feature/nri-08-source-review`.

- Resumed from `02e2cb4`. The 46 baseline tests pass with the bilingual report renderer enabled.
- Real Chromium QA exercised project selection and saved-source results in Arabic and English at desktop (1440×920) and mobile (390×844) viewport sizes. Captures are linked from [STATUS.md](STATUS.md).
- Historical [CI run 45905875325](https://github.com/nexvary/Nexvary-NRI/actions/runs/45905875325) passed the tests and timed out before Chrome exposed DevTools. The harness now reports failed launch details and uses the hosted CI runner isolation for its synthetic loopback fixture.

NRI-08b adds encrypted per-account OpenAI credentials and offline, OpenAI, or local model settings. `NRI_REPORT_PYTHON=<renderer-python> npm test` passes all 47 tests. Start with `src/assistant-settings.js` and `test/assistant-settings.test.js`.

NRI-08c wires optional loopback answers in `src/assistant-answer.js` and `src/assistant-provider.js`. `NRI_REPORT_PYTHON=<renderer-python> npm test` passes 48/48. The mocked integration test covers account isolation, citation matching, caching and cancellation. Set `NRI_LOCAL_AI_PORT` to the port of an existing loopback OpenAI-compatible server to exercise with a local model.

NRI-08d adds mocked and gated external OpenAI chat completions, explicit consent bound to the displayed source snapshots, and a durable per-account ledger with estimated token and cost reservations. See the operator settings in [README.md](../README.md).

NRI-11 adds private messaging for accepted collaborators, encrypted message text, independent read markers, in-app notifications, blocking and reporting. The report console is part of NRI-18. Run `NRI_REPORT_PYTHON=<renderer-python> npm test` and `node scripts/assistant-browser-qa.mjs /tmp/nri-visual-qa`. The latter covers both the Assistant and messaging.

NRI-18a adds optional authenticator MFA, one-use recovery codes and transactional revocation of other sessions when MFA changes. The new verification tests are in `test/mfa.test.js`.

NRI-18b adds the local operator-managed message moderator role and report decisions, with private threads still participant-only. See `src/message-store.js`, `src/moderation.js` and `test/messages.test.js`. Full regression: 52/52. The browser harness now captures Assistant, messaging, MFA settings and report review.

NRI-18c adds credential-confirmed account export/deletion in `src/privacy.js` and `src/privacy-store.js`. `test/privacy.test.js` covers isolation, deletion and restore behavior. Keep the backup policy in [RECOVERY.md](RECOVERY.md#account-deletion-and-retention) aligned with future data stores.

NRI-10a adds project team roles, invitation consent, manuscript versions, and manuscript/evidence review. See `src/team-store.js`, `src/teams.js` and `test/teams.test.js`. Full regression: 54/54 with real report rendering.

NRI-19a adds local plan assignments, project and daily external AI limits, an MFA-protected operator console and SQLite health reporting. See `src/licensing-store.js`, `src/licensing.js`, `test/licensing.test.js`, and [RECOVERY.md](RECOVERY.md#local-release-and-recovery-drill). Full regression: 55/55.

NRI-01a adds private dashboard collaborator counts, self-reported ORCID and daily metered usage. See `test/library.test.js`. Full regression: 56/56.

NRI-10b adds role-scoped team notes and tasks, attributable task transitions, and pending invitation notices. See `src/team-work.js`, `src/team-store.js` and `test/teams.test.js`. Full regression: 56/56.

NRI-02a adds manuscript catalog search, authors, tags, publication status, DOI and attributable metadata revisions. See `src/team-store.js`, `src/teams.js` and `test/teams.test.js`. Full regression: 56/56.

NRI-03a adds private PDF collections, bookmarks and annotations with stable version references. See `src/library-organization.js`, `test/library.test.js` and `test/privacy.test.js`. Full regression: 57/57.

NRI-03b adds BibTeX/RIS exchange, DOI and provider identifier grouping, title candidates and audited merges, with source preservation. See `src/citation-formats.js`, `src/citation-store.js` and `test/citations.test.js`. Full regression: 59/59.

NRI-03c adds embedded PDF versions and page-linked reading marks. Install pinned browser assets with `npm ci --omit=optional --ignore-scripts`. See `public/pdf-reader.mjs`, `src/library-organization.js`, and `test/library.test.js`. Full regression: 59/59.

NRI-10c adds explicit version/snapshot sharing for documents, references, readiness and reports. See `src/resource-sharing.js`, `src/resource-store.js`, and `test/resource-sharing.test.js`. Full regression: 60/60.

NRI-19b adds opt-in HTTPS, host-prefixed cookies, session idle expiry, bounded login throttling, operational logs and a [staging guide](DEPLOYMENT.md). See `test/transport.test.js`. Full regression: 62/62. A v22-to-v25 migration and rollback from a paired backup were rehearsed. The report and installer dependencies were updated after auditing.

NRI-19c adds transactional PDF storage and report-export limits, covering owned and shared reports. Full regression: 62/62 with the report renderer. The operator interface was exercised in Chromium.

Next: close the remaining [functional acceptance items](STATUS.md#functional-acceptance), including verified ORCID ownership, catalog workflows and production key rotation. Public deployment and billing remain subject to owner approval.

Release acceptance increment from `596c855`: DOI registration agency lookups through Crossref, bilingual System and Developer pages, and 64/64 tests with real bilingual exports. See the [acceptance matrix and Chromium captures](STATUS.md#functional-acceptance). Continue with owner-authenticated ORCID, document and manuscript integration, secure recovery and key rotation. Final NRI legal documents remain pending owner review.

Operator recovery increment: `npm run account:reset -- researcher@example.org` requires a private terminal and the existing workspace database. Migration preserves security history and password reset preserves MFA. Self-service recovery and workspace key rotation remain open.

Encrypted backup increment: use `workspace:export` and `workspace:import` with a separate private 32-byte key file. The restore integration test covers authentication and PDF recovery. See [RECOVERY.md](RECOVERY.md) and the optional timer in [DEPLOYMENT.md](DEPLOYMENT.md). Key rotation must account for existing MFA recovery digests as well as encrypted records.

The bounded SQLite load harness covers project-list reads, project creation and cross-account direct routes. The [deployment guide](DEPLOYMENT.md#sqlite-workload-measurements) records both measurements and remaining target-host checks.

The Chromium CI harness now verifies DevTools readiness and bounds command waits. It captures 38 views including the System and Developer pages. Remaining visual acceptance includes tablet coverage, keyboard and screen-reader tests, and screens outside the harness.


Private TXT upload, preview, versioning and quota enforcement passed [CI](https://github.com/nexvary/Nexvary-NRI/actions/runs/46009913116). Both document types use the existing encrypted storage and project access rules.


Private DOCX upload and plain-text preview passed [CI](https://github.com/nexvary/Nexvary-NRI/actions/runs/46010490212). Install Python 3.10+ for DOCX upload and preview. `NRI_DOCX_PYTHON` may select a specific interpreter.


Workspace key rotation passed [CI](https://github.com/nexvary/Nexvary-NRI/actions/runs/46011042141) on disposable workspaces. Follow [RECOVERY.md](RECOVERY.md#workspace-encryption-key-rotation) for staging, promotion and rollback.


Independent L-READY review is available in Project team. Accepted reviewers record a declaration and a revision-bound decision. See [CI evidence](https://github.com/nexvary/Nexvary-NRI/actions/runs/46011593215). Wider scientific review and researcher network work remain open.

NRI-20 adds account lifecycle states to the existing licensing store in schema v30. See [ADR 0002](decisions/0002-commercial-saas.md) and `test/licensing.test.js`. Next, inventory module operations and implement default-deny production entitlement policy before introducing organization subscriptions or billing. The existing console is an interim operator interface.

The [Control Center](https://github.com/nexvary/Nexvary-NRI/actions/runs/46015054306) is mounted at `/control-center`. Its licensing forms require current-password confirmation in an MFA-enabled operator session. Schema v31 adds `store.billing.accept(adapter, envelope)` and a synthetic signed adapter. No public billing endpoint is registered. The next billing increment needs durable invoice/payment projections and explicit subscription reconciliation.

Priority 1 introduces schema v32 with explicit plan module grants and a default-deny route inventory. Configure grants in Control Center before enabling external access. See [deployment](DEPLOYMENT.md#provisioning-module-access) and [private development](PRIVATE-DEVELOPMENT.md). Use an approved private repository for CI and browser verification of the local commit.
