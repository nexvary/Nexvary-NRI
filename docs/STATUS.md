# Development status

## P0 · Bilingual runnable shell · 2026-11-26

The audit started at `0136a7f` on `main`. The tree contained only AGENTS.md, the four linked Markdown files and the provisional SVG. There was no application or test implementation and no open PR. All 19 functional requirements were unimplemented at that baseline.

- Approved visual source: [dashboard-approved.webp](design/dashboard-approved.webp), commit `b48da574d532df8c38620efd6bc5f12766c44398`.
- Implemented and tested shell: commit `b76a56f8b70298cd407b2b8e7fbe05ff069899dc`. See the [architecture decision](decisions/0001-bilingual-web-shell.md) and [run instructions](../README.md).
- `npm test` passed **5/5** on Node.js 24.22.3. The suite exercises actual HTTP requests, both locales, every module view, the L-READY dimensional order, the About routes and build version, and HTTP error handling.
- In Qt WebEngine, verified Arabic desktop and mobile and English desktop layout, no horizontal overflow at the captured viewports, skip-link focus and destination, language switching, and navigation from the research shortcut. Full keyboard traversal and a screen-reader audit remain open.
- Running interface captures: [Arabic desktop, 1536×900](qa/p0/desktop-ar.webp), [English desktop, 1440×900](qa/p0/desktop-en.webp), and [Arabic mobile, 390×844](qa/p0/mobile-ar.webp).
- P0 runs locally with fixtures and view navigation. Authentication, private workspace storage, tenant isolation, live statistics and external integrations are future work. The repository is public. No paid API calls or cloud deployments were used.

## Functional acceptance

Evidence for partial items is from the P0 commit and actual tests listed above. A planned module route alone leaves that requirement in **Not started**.

| ID | Status | Implemented evidence and remaining acceptance |
|---|---|---|
| NRI-01 | Partial | Tested navigation, RTL/LTR, and labeled synthetic metrics and activity. Real metrics, quick actions, ORCID, operational UI states, and tenant isolation remain. |
| NRI-02 | Not started | Projects, manuscripts, versioning, search and access controls remain. |
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
| NRI-18 | Partial | Tested locale and RTL/LTR selection. Auth, RBAC, tenant boundaries, user settings, accessibility audit and administration remain. |
| NRI-19 | Not started | Entitlements, billing, production deployment and recovery remain. |

Next milestone: P1 identity, tenant boundaries, projects and documents. Select the maintained auth and storage stack first, then verify cross-tenant access denial before enabling private document flows.
