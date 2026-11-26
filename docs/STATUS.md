# Development status

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
| NRI-02 | Partial | Personal project CRUD and cross-account access denial are verified. Manuscripts, versions, authors, tags, search, notes, tasks, collaboration, publication status and DOI remain. |
| NRI-03 | Not started | Library persistence, document handling, reading and citation tools remain. |
| NRI-04 | Not started | Provider adapters, resolution, comparison and provenance remain. |
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
| NRI-18 | Partial | Local sign-in/out, session expiry and personal project boundaries are tested, along with RTL/LTR. Team RBAC, MFA, recovery, user settings, accessibility audit and administration remain. |
| NRI-19 | Not started | Entitlements, billing, production deployment and recovery remain. |

Next milestone: P1b private documents and version metadata. Define storage encryption and access rules first, then verify project-bound uploads and downloads across two personal workspaces.
