# Development status

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

Evidence for partial items comes from the commits and tests listed above. A planned module route alone leaves that requirement in **Not started**.

| ID | Status | Implemented evidence and remaining acceptance |
|---|---|---|
| NRI-01 | Partial | Tested navigation, RTL/LTR, and labeled synthetic metrics and activity. Real metrics, quick actions, ORCID, operational UI states, and tenant isolation remain. |
| NRI-02 | Partial | Personal project CRUD, project PDF versions, project DOI records and access denial are verified. Rich manuscript records, authors, tags, search, notes, tasks, collaboration and publication status remain. |
| NRI-03 | Partial | Project-bound PDF upload, metadata, encrypted persistence, version downloads and deletion are verified. Other formats, browsing by collection, search, reading, annotation, citation import/export and deduplication remain. |
| NRI-04 | Partial | Crossref DOI lookups, dated source links, correction/retraction metadata, local cache, rate limits and unknown/failure outcomes are verified. Agency resolution, additional providers and cross-provider metadata comparison remain. |
| NRI-05 | Not started | Claim modeling, evidence review and exports remain. |
| NRI-06 | Partial | Tested six ordered dimensions and framework wording. Qualitative assessment, evidence history, reviewers and safety/authorization blocking remain. |
| NRI-07 | Not started | Economic models, scenarios and exports remain. |
| NRI-08 | Not started | Providers, consent, verification, limits and usage accounting remain. |
| NRI-09 | Not started | Profiles, discovery, moderation and private sharing remain. |
| NRI-10 | Not started | Invitations, collaboration, notifications and access history remain. |
| NRI-11 | Not started | Conversations, notification preferences and authorization remain. |
| NRI-12 | Not started | Watchlists, dated updates and provenance remain. |
| NRI-13 | Not started | Import, analysis, charts and reproducible exports remain. |
| NRI-14 | Not started | Learning content, exercises and progress remain. |
| NRI-15 | Not started | PDF/DOCX report exports and bilingual templates remain. |
| NRI-16 | Partial | System About view shows the purpose, framework wording, build version and documentation links. Changelog, licensing, privacy, terms and support content remain. |
| NRI-17 | Partial | Separate developer view identifies Nexvary Inc. and links to the official company site. Dedicated confirmed contact information remains. |
| NRI-18 | Partial | Local session lifecycle, project and PDF boundaries, PDF-byte encryption and RTL/LTR are verified. Team RBAC, MFA, recovery, user settings, full accessibility audit and administration remain. |
| NRI-19 | Not started | Entitlements, billing, production deployment and recovery remain. |

Next milestone: P2b, add one independent open reference provider with dated provenance and explicit metadata comparison. Claim-to-source mapping and evidence review follow.
