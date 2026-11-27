# Development status

## NRI-10c · Explicit resource grants · 2026-11-27 (Cairo)

Owners can grant a named accepted team member read access to one PDF version, reference snapshot, readiness revision or frozen bilingual report. The grant records author and timestamps. Role changes, membership revocation and blocking invalidate old grants. Report downloads recheck access after rendering. Private owner routes retain their existing protections.

- 60/60 with real report rendering. HTTP tests cover every role, direct routes, foreign origins, immutable report inputs, revoke during rendering and stale invitation access.
- Chromium granted one PDF version in the running application. [Arabic desktop](qa/nri-10/resource-sharing-ar-desktop.webp) · [English mobile](qa/nri-10/resource-sharing-en-mobile.webp).
- Resource grants allow read and download. Editing, provider lookups and private reading notes use their owner-only routes.

## NRI-03c · Embedded PDF versions · 2026-11-27 (Cairo)

The reading page renders an authorized PDF version locally with a pinned PDF.js worker. Page controls and saved reading marks open the exact version/page. Downloads remain available for reading outside NRI.

- 59/59 with real report rendering. HTTP tests cover invalid version IDs, direct unauthorized reader requests and version-specific links.
- Chromium verified rendered pixels and second-page navigation in [Arabic desktop](qa/nri-03/pdf-reader-ar-desktop.webp) and [English mobile](qa/nri-03/pdf-reader-en-mobile.webp).
- The canvas preview exposes page navigation and status. The downloaded PDF remains available for assistive tools.

## NRI-03b · Citation exchange · 2026-11-27 (Cairo)

The project citation library imports and exports BibTeX and RIS. It retains original-format fields and saved provider snapshots, groups normalized DOI and qualified provider identifiers, and suggests title matches for manual review. Merging retains source records and refuses conflicting DOIs. Representative and all-source exports are available. Cross-format exchange maps common bibliographic fields.

- 59/59 with real report rendering. HTTP tests cover account isolation, foreign origins, identifier grouping, merge conflicts and downloads.
- Chromium imported a citation and captured [Arabic desktop](qa/nri-03/citations-ar-desktop.webp) and [English mobile](qa/nri-03/citations-en-mobile.webp).

## NRI-03a · Private collections and PDF reading marks · 2026-11-27 (Cairo)

The library supports named collections of owned PDFs. The reading notes page records bookmarks and annotations against an exact document version and a user-supplied page number. Association removal preserves the document. Document deletion removes dependent reading marks. Account exports include collections and marks.

- 57/57 with real report rendering. HTTP checks verify direct URL isolation, foreign origins, stable version links, escaping, and privacy export/deletion.
- Chromium saved an annotation and captured [Arabic desktop](qa/nri-03/reading-ar-desktop.webp) and [English mobile](qa/nri-03/reading-en-mobile.webp).
- Embedded reading, citation exchange and deduplication remain pending.

## NRI-02a · Manuscript catalog and metadata revisions · 2026-11-27 (Cairo)

The team catalog supports author and tag lists, DOI validation, publication status, search and status filtering. Authorized editors save metadata revisions with attribution. Stale updates are rejected. Existing text versions remain independently reviewable.

- 56/56 with real report rendering. HTTP checks cover authorization, rejected DOI, version conflicts, filtered results and attribution.
- Chromium submitted catalog metadata and captured [Arabic desktop](qa/nri-02/catalog-ar-desktop.webp) and [English mobile](qa/nri-02/catalog-en-mobile.webp).

## NRI-10b · Shared work and invitation notices · 2026-11-27 (Cairo)

Project team members can read shared notes and tasks. Owners, administrators and researchers can add notes/tasks and change task status. Updates record their actor and reject stale state changes. The authenticated navigation shows pending team invitations.

- 56/56 with real report rendering. HTTP checks verify notice clearing, role enforcement, direct route isolation, escaped notes and attributable task changes.
- Chromium created a task and captured [Arabic desktop](qa/nri-10/team-work-ar-desktop.webp) and [English mobile](qa/nri-10/team-work-en-mobile.webp).

## NRI-01a · Private dashboard metrics · 2026-11-27 (Cairo)

The signed-in dashboard shows accepted collaborators, self-reported ORCID, provider-reported tokens and estimated cost for the current UTC day. Data is queried for the active account.

- 56/56 with real report rendering. Cross-account HTTP acceptance verifies identity, collaboration counts and metered usage.
- Chromium captures: [Arabic desktop](qa/nri-01/dashboard-ar-desktop.webp) and [English mobile](qa/nri-01/dashboard-en-mobile.webp).

## NRI-19a · Local licensing and readiness · 2026-11-27 (Cairo)

An MFA-protected operator console manages plans, assignments, expiration, owned-project limits, and daily external AI token entitlements. Limits are enforced at project creation and Assistant reservation. The console shows aggregate data and an attributable change history. `/healthz` checks SQLite schema readiness and the [local release drill](RECOVERY.md#local-release-and-recovery-drill) covers migration, backup and rollback.

- 55/55 with real report rendering. HTTP acceptance verifies operator/MFA gating, foreign-origin rejection, expiry, plan ceilings, and readiness responses.
- Chromium saved a plan and captured [Arabic desktop](qa/nri-19/licensing-ar-desktop.webp) and [English mobile](qa/nri-19/licensing-en-mobile.webp).
- Billing remains disabled. The platform runs as a local preview and production deployment and monitoring remain pending.

## NRI-10a · Project team permissions and review · 2026-11-27 (Cairo)

Projects have owner, administrator, researcher, reviewer and read-only roles in a dedicated team workspace. Role changes require renewed acceptance, and owner-to-member blocking revokes team access. Manuscript revisions and manuscript/evidence reviews record their participants and timestamps. Stale manuscript edits are rejected.

- 54/54 with the real report renderer. HTTP acceptance covers role delegation, invitation consent, direct URL isolation, version conflicts, attributable reviews, revocation and blocking.
- Chromium created a manuscript and captured [Arabic desktop](qa/nri-10/team-ar-desktop.webp) and [English mobile](qa/nri-10/team-en-mobile.webp).
- Team access covers manuscripts and evidence review. The owner workspace continues to govern PDFs, project settings, reports and readiness records.

## NRI-18c · Account export and deletion · 2026-11-27 (Cairo)

Authenticated users can export their account data and owned PDFs or permanently delete the live account. Both actions require password confirmation and a fresh MFA or recovery code when configured. Deletion also requires typing DELETE. The transaction removes credentials, sessions, owned projects, linked documents and messaging data. The [retention and recovery policy](RECOVERY.md#account-deletion-and-retention) describes backup behavior.

- 53/53 with the real report renderer. HTTP coverage verifies MFA replay rejection, explicit confirmation, cross-origin and cross-account isolation, credential and private data cleanup, and restores from before and after deletion.
- Chromium exercised the export and captured [Arabic desktop](qa/nri-18/privacy-ar-desktop.webp) and [English mobile](qa/nri-18/privacy-en-mobile.webp).

## NRI-18b · Scoped message moderation · 2026-11-27 (Cairo)

A local operator can grant or revoke the message moderator role. Moderators see reported messages and can record one attributed decision per report. The rest of a conversation remains participant-only. Moderators cannot adjudicate their own reports or reports about messages they sent.

- 52/52 with real report rendering. HTTP coverage verifies direct-route denial, live role revocation, review conflicts, report scope, escaped evidence and immutable decisions.
- Real Chromium captures: [Arabic desktop](qa/nri-18/moderation-ar-desktop.webp) and [English mobile](qa/nri-18/moderation-en-mobile.webp).

## NRI-18a · Account MFA and recovery codes · 2026-11-27 (Cairo)

Signed-in accounts can enable time-based authenticator codes after password re-verification. The secret is encrypted at rest and setup expires in ten minutes. Enrollment issues eight one-use recovery codes. Login rejects replayed authenticator and recovery codes. Activation and deactivation revoke other sessions in the same transaction.

- 51/51 with real report rendering. HTTP coverage includes legacy password sign-in, setup confirmation, authentication code reuse, recovery code use and replay, new session issuance and revocation.
- Real Chromium capture of [Arabic desktop](qa/nri-18/mfa-ar-desktop.webp) and [English mobile](qa/nri-18/mfa-en-mobile.webp) settings.

## NRI-11 · Private researcher messaging · 2026-11-27 (Cairo)

Accepted collaborators can open a shared private thread. Each participant has independent unread state and a preference for in-app unread notifications. Both block directions prevent sends. Users can report received messages by category. Message bodies are encrypted in SQLite with a purpose-specific key derived from the paired workspace key.

- 50/50 regression tests with the PDF/DOCX renderer. HTTP acceptance covers participant and origin authorization, account isolation, encrypted storage, reporting privacy, read markers, notification preferences, blocking and rate limiting.
- Real Chromium exercised sending and rendering a message in four viewports using illustrative accounts. Captures: [Arabic desktop](qa/nri-11/messages-ar-desktop.webp), [Arabic mobile](qa/nri-11/messages-ar-mobile.webp), [English desktop](qa/nri-11/messages-en-desktop.webp), [English mobile](qa/nri-11/messages-en-mobile.webp).
- NRI-18b provides the scoped review console for persisted reports.

## NRI-08d · External consent and usage limits · 2026-11-27 (Cairo)

OpenAI chat completions are opt-in through an operator-configured model and rate policy. Each request requires explicit consent for the current question and displayed source metadata. The SQLite ledger reserves per-account daily tokens and estimated USD cost before sending, and records usage reported by the provider. Input tokens and cost are estimates based on configured rates. Reservations remain charged against the internal limit when provider usage is unavailable.

- External calls use a fixed HTTPS endpoint and tests inject a mock transport. The tests cover absent and stale consent, reservations before calls, reported usage, cache reuse and budget denial.
- Offline review and optional local generation remain available. The feature accepts saved reference metadata and excludes manuscript contents. Citation matching verifies identifiers against those records, with scientific support left for human review.

## NRI-08c · Local cited answers · 2026-11-27 (Cairo)

An optional loopback OpenAI-compatible model can answer questions from saved reference titles and provenance in Arabic and English. Answers display matched saved identifiers and flag unsupported citation IDs. A citation match verifies the saved record, while scientific support remains a human review step. Offline source review continues to work without a model.

- 48/48 regression tests pass with the bilingual PDF/DOCX renderer. Mocked integration covers provider request bounds, project isolation, citation matching, escaped output, cache hits, and cancellation.
- Local requests have a 512-token output cap, a 15-second deadline, and a bounded five-minute process cache. Project names, descriptions, and documents are excluded from provider requests.
- External OpenAI generation, explicit sharing consent, and durable usage and cost controls are pending.

## NRI-08b · Private provider settings · 2026-11-27 (Cairo)

The Assistant has a bilingual, account-scoped provider settings page with Offline, OpenAI, and local OpenAI-compatible model selections. The OpenAI key is encrypted in SQLite with an account-bound AES-256-GCM key derived from the existing workspace key. The form never echoes the key. Switching to Offline or Local removes the stored OpenAI credential.

- 47/47 with the bilingual PDF/DOCX renderer enabled. The new HTTP regression covers origin enforcement, account isolation, model update, persistence, key removal, and plaintext absence in the database.
- The configuration form performs zero provider calls. The OpenAI credential remains inactive pending external request controls.

## NRI-08a · Local source review · 2026-11-27 (Cairo)

The signed-in Assistant reviews a project's saved provider snapshots and links back to the reference validator. It filters by title or identifier and shows the provider, retrieval date, and editorial or retraction notices. Missing provider results and unknown retraction status remain explicit. The page makes no external requests.

- Baseline: main at `0c643a4` (merged PR #18).
- Targeted tests: 6 passed. The full Node suite passed 45 tests, with the bilingual report renderer integration test skipped because the optional local report runtime was unavailable.
- HTTP acceptance covered English and Arabic, guest redirects, cross-account denial, escaped metadata, provider-status distinctions, bounded results and a read-only route. Chromium submitted the project selector and verified the saved source, text direction and viewport width at all four sizes. Captures: [Arabic desktop](qa/nri-08a/assistant-ar-desktop.webp), [Arabic mobile](qa/nri-08a/assistant-ar-mobile.webp), [English desktop](qa/nri-08a/assistant-en-desktop.webp), [English mobile](qa/nri-08a/assistant-en-mobile.webp).
- Resumption regression: 46/46 with the real PDF/DOCX renderer enabled.
- Next: BYOK provider and model selection, consent for external data, grounded answers, durable usage and cost limits, cancellation and caching. NRI-11 follows.

## P7c · Bilingual research learning library · 2026-11-27 (Cairo)

Added lessons on reference provenance and descriptive statistics, server-graded quizzes with account-scoped progress, and an illustrative mean-versus-median simulation backed by the analytics engine.

- 45/45 Node tests passed with the report renderer enabled. The learning test covers scoring, input validation and private progress.
- Qt WebEngine verified quiz completion and the simulation on [Arabic desktop](qa/p7c/education-ar-desktop.webp) and [English mobile](qa/p7c/education-en-mobile.webp).

## P7b · Scoped project summary sharing · 2026-11-27 (Cairo)

Project owners can invite discoverable researchers to read a summary. The recipient must accept. The scoped role exposes the project title and description. Existing access controls continue to protect files, references, evidence and reports. Owners can revoke access. Blocking revokes access in both directions, with an activity record.

- 44/44 Node tests passed, including invite consent, recipient identity, direct-route isolation, revoke, block and no reinstatement after unblock.
- Qt WebEngine verified the invitation flow and audit display on [Arabic desktop](qa/p7b/sharing-ar-desktop.webp) and [English mobile](qa/p7b/sharing-en-mobile.webp).

## P7 · Local security and recovery baseline · 2026-11-26

Added private account security settings with session revocation and a bounded sign-in/sign-out audit trail. The recovery CLI backs up SQLite and its paired document key with integrity validation, then restores to a fresh directory with active sessions removed.

- 43/43 Node tests passed with the real report renderer enabled. The suite exercises cross-account and origin boundaries, session revocation, tamper detection and encrypted PDF recovery.
- Qt WebEngine verified the settings audit view on [Arabic desktop](qa/p7/settings-ar-desktop.webp) and [English mobile](qa/p7/settings-en-mobile.webp).
- [Local recovery instructions](RECOVERY.md) record deployment and backup boundaries. This remains a loopback preview.

## P6 · Bilingual PDF and DOCX reports · 2026-11-26

The private Report Studio renders PDF and DOCX files locally with dated citations, provider notices, evidence matrices, L-READY findings and limitations. Reports include the app and template versions. The optional Python renderer and font prerequisites are documented in README.md.

- 41/41 Node tests passed with the local renderer enabled. The authenticated download routes returned actual PDFs and valid DOCX archives in both languages. Arabic PDF text extraction and DOCX bidi markup were verified.
- Qt WebEngine verified the download controls on [Arabic desktop](qa/p6/reports-ar-desktop.webp) and [English mobile](qa/p6/reports-en-mobile.webp).

## P4e · Technology observatory · 2026-11-26

Added private topic watchlists, saved library searches, and dated update notes with original reference snapshots and retrieval timestamps. Watchlist updates support keyword filtering and use manually selected project sources. No automated polling is configured.

- 39/39 Node tests passed, including cross-account denials, date checks, filters and source snapshot retention.
- Qt WebEngine verified both locales using captured public Zenodo metadata and an illustrative update note. Captures: [Arabic desktop](qa/p4e/observatory-ar-desktop.webp) · [English mobile](qa/p4e/observatory-en-mobile.webp).

## P4d · Descriptive scientific analytics · 2026-11-26

Signed-in users can import a UTF-8 CSV file or paste CSV, select a numeric column and label its unit. The analysis calculates descriptive measures, histogram bins and potential IQR outliers. JSON export records the values, units, calculation version and results for reproduction. CSV data is processed in memory for the request.

- 38/38 Node tests passed, including format validation, exact fixture summaries, multipart upload, deterministic export, cache headers and origin checks.
- Qt WebEngine verified results and the histogram on [Arabic desktop](qa/p4d/analytics-ar-desktop.webp) and [English mobile](qa/p4d/analytics-en-mobile.webp) using illustrative measurements.

## P4c · Researcher directory and collaboration requests · 2026-11-26

Signed-in researchers can opt in to discovery, search by name and interests, follow or block peers and send collaboration requests. Recipients can accept or decline. Profiles and request relationships are removed from discovery when the researcher opts out. The optional ORCID iD is self-reported.

- 36/36 Node tests passed, including opt-in, block boundaries, independent recipient authorization and private project denial after accepting a request.
- Qt WebEngine verified opt-in and a local collaboration request using two test accounts. Captures: [Arabic desktop](qa/p4c/network-ar-desktop.webp) · [English mobile](qa/p4c/network-en-mobile.webp).
- Project invitations, shared project authorization, reporting and moderation, posts and messages remain pending.

## P4b · Private library and operational dashboard · 2026-11-26

The dashboard now uses signed-in workspace counts, recent projects and library activity. The scientific library searches and filters private PDFs and saved reference metadata across projects. The dashboard and module navigation use multicolor SVG icons.

- 35/35 Node tests passed, including guest and cross-account isolation, filters and live dashboard counts.
- Qt WebEngine verified the signed-in dashboard and a library search after saving a live Crossref lookup. Captures: [Arabic dashboard](qa/p4b/dashboard-ar-desktop.webp) · [English mobile library](qa/p4b/library-en-mobile.webp).
- Collections, annotations, BibTeX/RIS, richer manuscript workflows, verified researcher profiles and team permissions remain pending.

## P4 · Hypothetical economics and sensitivity · 2026-11-26

Private projects support saved one-year operating scenarios, currency and output units, capacity and utilization assumptions, exact minor-unit calculations, break-even, and one-variable sensitivity to utilization and sale price. The JSON export includes assumptions, calculation version and results. Taxes, financing, capital expenditure and exchange-rate conversion remain outside this model.

- 34/34 Node tests passed, including boundary cases, calculations, comparisons and private export.
- Qt WebEngine verified a saved hypothetical scenario in both locales. Captures: [Arabic desktop](qa/p4/economics-ar-desktop.webp) · [English mobile](qa/p4/economics-en-mobile.webp).

## P3 · Qualitative L-READY assessment · 2026-11-26

Added private assessments for a specific intended use, with six independent dimensions, four qualitative categories, reviewed source links, limitations, reviewer and immutable revisions. Safety and authorization blockers take precedence. No aggregate score is calculated.

- 32/32 Node tests passed, including blocker precedence, project isolation, reviewed-source requirements and rejection of stale revisions.
- Qt WebEngine verified a blocked assessment and bilingual responsive layout. Captures: [Arabic desktop](qa/p3/readiness-ar-desktop.webp) · [English mobile](qa/p3/readiness-en-mobile.webp).
- Governance and reviewer inputs are manually reported in the private workspace. Independent team reviews remain pending collaboration roles.

## P2d · Claim-source evidence and review · 2026-11-26

Private projects now support claim statements, links to saved source snapshots, study type, limitations, supporting/conflicting/inconclusive relationships and an owner review decision with rationale. Evidence snapshots survive removal of the originating reference check. The owner can download a versioned JSON evidence matrix.

- 30/30 Node tests pass, including v4 migration, duplicate-link prevention, review integrity, project separation and unauthorized export denial.
- Qt WebEngine verified claim creation, source linkage and review against a live Crossref reference with illustrative claim text. Captures: [Arabic desktop](qa/p2d/evidence-ar-desktop.webp) · [English mobile](qa/p2d/evidence-en-mobile.webp).
- Team reviewers, review revisions and report-studio output remain pending.

## P2c · Public ORCID and Zenodo identifiers · 2026-11-26

Adds public ORCID iD and published Zenodo record lookups to the private project reference workspace. Public name, publisher-supplied record metadata, source URL and retrieval time stay with the project. ORCID identity ownership is unverified. Zenodo supports version DOIs issued by Zenodo. Agency resolution, arbitrary DOIs on Zenodo, verified ORCID account linking and public researcher profiles remain open.

- Node.js 24.22.3: 29/29 tests pass, including authorization, cache reuse, identifier validation and provider provenance.
- Live public ORCID and Zenodo lookups passed in the reference workspace. Qt WebEngine confirmed responsive layouts and that removing Zenodo preserved the ORCID snapshot. Captures: [Arabic desktop](qa/p2c/references-ar-desktop.webp) · [English mobile](qa/p2c/references-en-mobile.webp).

## P2b · OpenAlex comparison · 2026-11-26

[PR #5](https://github.com/nexvary/Nexvary-NRI/pull/5) adds provider-specific snapshots and cache entries, schema v4 migration, and bilingual comparison. The acceptance changes verify the DOI returned by OpenAlex, restrict open-access links to reported HTTPS locations, and preserve provider attribution and unknown retraction status.

- Node.js 24.22.3: 28/28 tests pass. Coverage includes provider rate limits, v3 migration, independent removal, mismatched DOI rejection and open-access link validation.
- Live Crossref and OpenAlex adapter checks returned public metadata for DOI `10.1038/nature14539`.
- Qt WebEngine verified sign-in, project creation, live DOI checks, comparison, independent removal, and no horizontal overflow. Captures: [Arabic desktop, 1536×900](qa/p2b/references-ar-desktop.webp) and [English mobile, 390×844](qa/p2b/references-en-mobile.webp).

## P2b · OpenAlex multi-provider DOI checks with side-by-side comparison · 2026-11-26

P2b starts from P2a at `fa4318c`. All changes are on branch `feature/p2b-openalex-provider`. It adds the OpenAlex Works API as an independent reference provider with per-provider caching, schema migration, and a side-by-side comparison view that prompts users to check both providers and shows differences between results.

- `npm test` passed **27/27** on Node.js 24.22.3. Five new tests cover: OpenAlex URL normalization; metadata normalization, retraction flag and 404/500 handling; concurrent call limiting and retry-after; full multi-provider check/cache/remove flow; and SQLite migration from P2a schema (v3→v4, adds `provider` column to both reference tables with `'crossref'` default for existing rows).
- Live browser test with real Crossref and OpenAlex requests for DOI `10.1038/nature12373` confirmed: Crossref check saves with source, retrieval time and editorial update notice; OpenAlex check saves alongside it with title, article type, full authors, Open access copy link; "Both providers have been checked" comparison note appears; provider blocks display side-by-side with layout CSS (`.provider-comparison`, `.provider-block`, `.comparison-note`, `.provider-select`).
- `src/openalex.js` is a new polite-pool adapter: `User-Agent: Nexvary-NRI/0.5.0 (mailto:info@nexvary.com)`, 1000ms minimum interval, single concurrent call, retry-after header respect. It normalizes title, type, venue, publisher, authors, issued year, retraction flag and open-access URL.
- Both providers share one DOI entry per project; removing one provider's record leaves the other's intact. Provider selection is explicit in the form; unknown providers silently default to Crossref.
- Results are dated per provider to their individual retrieval times. Crossref's structured update/retraction chain is preserved; OpenAlex uses a boolean `is_retracted` flag. Neither provider's absence constitutes a DOI-invalid or globally-retracted finding. Full accessibility audit, agency resolution, additional providers, claim-to-source mapping and evidence review remain.
- No paid services or deployments were used.

## P2a · Crossref DOI checks and provenance · 2026-11-26

P2a starts from draft P1b at `9cb6863`. Commit `fa4318c00febf65e8d2f559e89624f0c37cb6960` adds a bilingual project reference validator, a public Crossref adapter, dated provenance snapshots, and account-scoped caching. See the [P2a architecture decision](decisions/0004-crossref-reference-provenance.md).

- `npm test` passed **22/22** on Node.js 24.22.3. Coverage includes DOI normalization, fixed-host URL encoding, update direction, rate limits, source-specific misses, account/project isolation, migration, cache expiry and preservation of saved records on provider failure.
- A live Crossref request through the new adapter returned a public record with one correction and one retraction in the incoming notices. No fixture citation was sent during the live check.
- Qt WebEngine verified the project DOI flow, saved source and retrieval time, Arabic desktop and English mobile layout, and preservation of the existing record when the simulated provider failed. Running captures use synthetic provider responses: [Arabic desktop, 1536×900](qa/p2a/references-ar-desktop.webp) and [English mobile, 390×844](qa/p2a/references-en-mobile.webp).
- Crossref is the only provider in P2a. Its 404 does not establish global DOI status. The app does not verify peer review or the work's scientific validity. Full accessibility audit, metadata comparisons, other providers and evidence review remain pending. No paid services or deployments were used.

## P1b · Private PDF uploads and versions · 2026-11-26

P1b starts from draft P1a at `9780ae5`. Commit `185df9207e1eb952252d81f0c5c7b75396cb2a2f` adds private PDFs inside projects, immutable versions with file name/date/size, downloads by version and confirmed file deletion. It migrates P1a SQLite data and encrypts PDF bytes with a separate local key. See the [P1b architecture decision](decisions/0003-private-pdf-versions.md) and [run instructions](../README.md).

- `npm test` passed **17/17** on Node.js 24.22.3. It covered intact attachment downloads, sequential and concurrent uploads, cross-account and cross-project denial, rejected file size/type/origin, cascade deletion, database migration and restart, missing or wrong key, and authentication-tag failure.
- Qt WebEngine verified the project-to-files path, two PDF uploads using the browser file input, both version links, and layout at the Arabic desktop and English mobile widths. The attachment bytes and response headers were verified separately by the HTTP suite. Full keyboard traversal and the screen-reader audit remain open.
- Running captures with synthetic data: [Arabic desktop, 1536×900](qa/p1b/history-ar-desktop.webp) and [English mobile, 390×844](qa/p1b/history-en-mobile.webp).
- Local preview with an 8 MiB per-PDF limit and plaintext file and project metadata. Rich library tools, other file formats, malware scanning, encrypted metadata, key rotation, production hosting and backup orchestration remain pending. No paid services or deployments were used.

## P1a · Local accounts and private projects · 2026-11-26

P1a starts from the open P0 draft at `8ff5ccf`. Commit `41adf6020f0a167658c621a4f7afcbbae32edcd4` adds terminal-provisioned accounts, sign-in and sign-out, persistent personal project workspaces and bilingual create, view, edit and delete actions. See the [P1a architecture decision](decisions/0002-local-private-workspace.md) and [run instructions](../README.md).

- `npm test` passed **11/11** on Node.js 24.22.3. Tests cover the P0 shell, session creation, rotation, revocation and expiry, write-origin and input checks, login limits, durable SQLite state and denial of cross-account project reads, edits and deletes.
- Qt WebEngine verified local account login, project creation and editing, navigation back to the list and logout. The Arabic desktop and English mobile project pages fit the captured viewport widths. Full keyboard traversal and the screen-reader audit remain open.
- Running captures with synthetic project data: [Arabic desktop, 1536×900](qa/p1a/project-ar-desktop.webp) and [English mobile, 390×844](qa/p1a/project-en-mobile.webp).
- This is a loopback preview with a personal account boundary. Project metadata is plaintext in local SQLite. Team roles, MFA, account recovery, manuscript and document handling, encrypted storage, audit and backups remain pending. No paid services or deployments were used.

## P0 · Bilingual runnable shell · 2026-11-26

The audit started at `0136a7f` on `main`. The tree contained only AGENTS.md, the four linked Markdown files and the provisional SVG. There was no application or test implementation and no open PR. All 19 functional requirements were unimplemented at that baseline.

- Approved visual source: [dashboard-approved.webp](design/dashboard-approved.webp), commit `b48da574d532df8c38620efd6bc5f12766c44398`.
- Implemented and tested shell: commit `b76a56f8b70298cd407b2b8e7fbe05ff069899dc`. See the [architecture decision](decisions/0001-bilingual-web-shell.md) and [run instructions](../README.md).
- `npm test` passed **5/5** on Node.js 24.22.3. The suite exercises actual HTTP requests, both locales, every module view, the L-READY dimensional order, the About routes and build version, and HTTP error handling.
- In Qt WebEngine, verified Arabic desktop and mobile and English desktop layout, no horizontal overflow at the captured viewports, skip-link focus and destination, language switching, and navigation from the research shortcut. Full keyboard traversal and a screen-reader audit remain open.
- Running interface captures: [Arabic desktop, 1536×900](qa/p0/desktop-ar.webp), [English desktop, 1440×900](qa/p0/desktop-en.webp), and [Arabic mobile, 390×844](qa/p0/mobile-ar.webp).
- P0 runs locally with fixtures and view navigation. Authentication, private workspace storage, tenant isolation, live statistics and external integrations are future work. The repository is public. No paid API calls or cloud deployments were used.

## Functional acceptance

Compared all 19 requirements with the application routes, persistence, renderer and test suite on the P2b branch. Modules with only shell navigation are **Not started**. The current dashboard reads account-scoped data from the library and project store. The workspace, file and reference handlers have functional tests, and About and L-READY shell behavior is covered in `test/shell.test.js`.

| ID | Status | Implemented evidence and remaining acceptance |
|---|---|---|
| NRI-01 | Partial | Verified real private project, PDF, reference and evidence counts, recent activity, sign-in/empty states and account isolation. Accepted collaborator counts, self-reported ORCID and metered cost are verified. Verified ORCID ownership remains. |
| NRI-02 | Partial | Personal project CRUD, project PDF versions, project DOI records and access denial are verified. The team workspace adds versioned manuscripts and author attribution. Catalog search, authors, tags, DOI and publication revisions are verified, alongside team notes and tasks. Wider document integration remains. |
| NRI-03 | Partial | Project-bound PDF upload, metadata, encrypted persistence, version downloads and deletion are verified. Cross-project search and type filtering for PDFs and saved sources are verified. Private PDF collections, version-specific bookmarks and annotations are verified. BibTeX/RIS exchange, DOI/provider grouping and controlled merging are verified. Embedded PDF reading is verified. Other document formats remain. |
| NRI-04 | Partial | Crossref and OpenAlex DOI lookups, dated per-provider source links, correction/retraction metadata, per-provider local cache, rate limits and unknown/failure outcomes are verified. Side-by-side provider comparison view implemented. Agency resolution, additional providers, claim-to-source mapping and evidence review remain. |
| NRI-05 | Partial | Claims, dated source snapshots, study type, limitations, conflicting evidence, owner review and JSON export are verified. Team reviewers can file attributable reviews alongside immutable review history. |
| NRI-06 | Partial | Six ordered dimensions, four qualitative categories, project evidence links, revision history, reviewer and safety/authorization blockers are verified. Independent team reviewer roles remain. |
| NRI-07 | Verified | One-year operating model with explicit assumptions, currency, units, capacity, sensitivity, scenario comparison and reproducible JSON export. |
| NRI-08 | Verified | NRI-08a exercises private saved-source review, provenance and retraction/editorial warnings in `test/assistant.test.js`. NRI-08b adds private encrypted BYOK storage, offline/provider selection and model settings in `test/assistant-settings.test.js`. NRI-08c verifies mocked local cited answers, cancellation and bounded caching in `test/assistant-answer.test.js`. NRI-08d verifies external consent, mocked OpenAI requests and durable reservations in the same test suite. |
| NRI-09 | Partial | Opt-in profiles, search, follow and block, bounded requests and private profile isolation verified. Verified ORCID ownership, posts, groups, publication sharing and moderation remain. |
| NRI-10 | Partial | Collaboration requests and scoped project-summary invitations, acceptance/decline, revoke and access history are verified. Team invitations, five roles, revocation, audit history and manuscript/evidence review are verified. NRI-10b verifies in-app invitation notices, shared notes and tasks. Explicit resource grants extend read access to individual document versions, reference snapshots, readiness revisions and frozen reports. |
| NRI-11 | Verified | Private direct conversations, independent unread state, in-app notification preferences, reports, participant and origin checks, blocking, encrypted message bodies and rate limits verified in `test/messages.test.js` and Chromium. |
| NRI-12 | Verified | Private watchlists, saved library searches, date-stamped manual updates, filters and provider provenance. |
| NRI-13 | Verified | Bounded UTF-8 CSV import, numeric validation, descriptive metrics, histogram, IQR outlier flags, units and reproducible JSON export. |
| NRI-14 | Verified | Bilingual starter lessons, quizzes, model-backed illustrative simulation and private progress. |
| NRI-15 | Verified | Versioned Arabic/English PDF and DOCX downloads with citations, evidence, L-READY findings and limitations. Requires the documented local renderer. |
| NRI-16 | Partial | System About view shows the purpose, framework wording, build version and documentation links. Changelog, licensing, privacy, terms and support content remain. |
| NRI-17 | Partial | Separate developer view identifies Nexvary Inc. and links to the official company site. Dedicated confirmed contact information remains. |
| NRI-18 | Partial | Local authentication, session revocation, account audit, authorization, encrypted PDF bytes, RTL/LTR and verified recovery are implemented. NRI-18a adds optional MFA and one-use recovery codes. NRI-18b adds the operator-managed message moderator role and scoped report review. Project team RBAC is verified for manuscripts and evidence review. Password/account recovery, accessibility audit and broader administration remain. |
| NRI-19 | Partial | Local restore and regression workflow configuration are implemented. Local plans, entitlement limits, an MFA-protected operator console, migration/restore drills and schema health checks are verified. Approved hosting, production security and monitoring, and optional billing remain. |

Next milestone: transport, session, operational and deployment hardening.
