# NRI functional requirements — owner baseline
All items below are required roadmap scope, not claims of implementation. Track each ID in STATUS.md with Not started / Partial / Verified / Blocked, test evidence and commit. A static page, mock or disabled button is not completion.
| ID | Module | Required functionality and acceptance |
|---|---|---|
| NRI-01 | Dashboard | Real project, library, network, evidence and cost metrics; recent activity, quick actions, ORCID profile, empty/loading/error states; verify navigation and data isolation. |
| NRI-02 | Research workspace | CRUD projects, manuscripts, versions, authors, tags, search, notes, tasks, collaborators, permissions, publication status and DOI; verify version history and access denial. |
| NRI-03 | Scientific library | PDF/document upload, metadata, folders, collections, search, filters, reading, annotations, bookmarks, citations, BibTeX/RIS import/export, deduplication; respect copyright and access rights. |
| NRI-04 | Reference validator | Crossref, OpenAlex, ORCID, Zenodo; optional PubMed, DOAJ, arXiv adapters; DOI resolution, metadata comparison, correction/retraction indicators where supported, dated provenance, unknown states, rate limits and caching; no invented references. |
| NRI-05 | Evidence intelligence | Claim-source mapping, study type, limitations, supporting/conflicting evidence, review workflow, evidence matrix, traceable exports; no automatic claim of scientific validity. |
| NRI-06 | L-READY | Six dimensions L scientific evidence, R independent verification, E economics, A availability, D safety/governance, Y societal value; intended use, four qualitative evidence categories, source links, reviewer, limitations, revision history, gaps and safety/authorization blockers; no aggregate score or certification claims. |
| NRI-07 | Economics | Cost assumptions, units, currency, capacity, sensitivity and scenario comparisons, reproducible calculations and export; label hypothetical models. |
| NRI-08 | AI assistant | Optional BYOK/provider adapters, explicit document consent, cited answers, source verification, model selection, usage limits, token/cost ledger, cancellation, caching; core works without AI; no paid calls by default. |
| NRI-09 | Research network | Researcher profiles, ORCID linking, interests, discover/search, follow/unfollow, posts, comments, reactions, groups, collaboration requests, sharing authorized publications, private/public visibility, block/report, moderation, spam limits; verify private content cannot leak. |
| NRI-10 | Collaboration | Project invitations, roles, shared notes, tasks, activity history, accept/reject/revoke access, notifications. |
| NRI-11 | Messages | Private conversations, unread counts, notification preferences, blocking/reporting, authorization and rate limits. |
| NRI-12 | Technology observatory | Topic watchlists, dated source updates, filters, saved searches and provenance; no unapproved paid polling. |
| NRI-13 | Scientific analytics | CSV import, validation, descriptive statistics, charts, outlier flags, units and reproducible exports; no unsupported scientific inference. |
| NRI-14 | Education | Learning library, bilingual tutorials, safe conceptual simulations, quizzes, progress tracking. |
| NRI-15 | Report studio | PDF/DOCX reports, citations, evidence tables, L-READY findings, limitations, version and bilingual templates; verify actual exported files. |
| NRI-16 | About system | Purpose, version from build metadata, changelog, documentation, licenses, privacy, terms, support, framework limitations. |
| NRI-17 | About developer | Nexvary Inc., https://nexvary.com, verified company links and contact; no fabricated partnerships or endorsements. |
| NRI-18 | Settings/admin | Auth, MFA, recovery, RBAC, tenant isolation, profile, Arabic/English RTL/LTR, theme, accessibility, privacy, account export/deletion, audit, backup/restore, moderation console, integration settings and usage limits. |
| NRI-19 | Commercial readiness | Configurable plans/entitlements, usage accounting, optional billing integration only with owner approval; deployment, migration, monitoring, security and recovery documentation. |
## Visual acceptance
Use owner-approved dark glossy reference, metallic silver frames, meaningful multicolor icons, readable contrast, clear sidebar and separate About System/About Developer tabs. Responsive desktop/mobile web, RTL mirrored where appropriate, no clipped text, accessible keyboard navigation. Logos only where authorized; integration logos do not imply partnership. Reference numbers are mock data, not production metrics. Capture actual running screenshots.
## Execution
Read AGENTS.md and all referenced files; compare IDs against actual code and tests; choose next dependency-ready milestone, implement bounded batch, run targeted tests, update STATUS.md, commit and open draft PR. Never merge without approval. No paid services or unbounded agent loops. Architecture remains subject to ADR; no app platform or stack has been finalized.
