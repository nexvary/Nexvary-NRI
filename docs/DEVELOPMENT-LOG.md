# Development log

## 2026-11-26 · P2b OpenAlex acceptance

- Baseline: main at `bf2598a`, OpenAlex draft [PR #5](https://github.com/nexvary/Nexvary-NRI/pull/5) at `598f69a`. No GitHub Actions workflows or runs on either baseline commit.
- Hardened provider DOI matching and open-access links. Added accurate source attribution, an explicit unknown retraction state, and a side-by-side title comparison with responsive stacking.
- Verification: 28 Node.js tests pass, including saved-provider isolation, v3 migration and mismatched upstream DOI rejection. Both live adapters returned public metadata for DOI `10.1038/nature14539`. No paid API calls.
- Published the acceptance fixes at [`b1e1f03`](https://github.com/nexvary/Nexvary-NRI/commit/b1e1f03a083997bbac930de5599fd4af47ebcfff). Qt WebEngine passed the live two-provider flow and independent removal. Desktop and mobile captures are linked in STATUS.md.
- Remaining sequence: ORCID and Zenodo, claim/evidence review, L-READY, economics, workspace/library, network/collaboration, analytics/observatory, optional AI, reports and release readiness. See the complete 19-module audit in [STATUS.md](STATUS.md).

## 2026-11-26 · P2c public ORCID and Zenodo identifiers

- P2b merged into main at [`2dce2b4`](https://github.com/nexvary/Nexvary-NRI/commit/2dce2b495a0674e1ab2f6ce35d23bee394c290ed).
- P2c adds provider-specific input validation, fixed public endpoints, bounded lookup and dated private project snapshots. Unknown provider values are rejected before making any external request. ORCID lookup and OAuth account linking are separate acceptance requirements.
- `npm test`: 29/29. Live browser acceptance passed with both providers, independent removal, and Arabic desktop and English mobile captures. Next milestone is claim-to-source mapping and human evidence review.

## 2026-11-26 · P2d evidence intelligence

- P2c merged into main at [`94ca38e`](https://github.com/nexvary/Nexvary-NRI/commit/94ca38effbced353605869d4656e344789e19d9d).
- Added a private evidence matrix with source snapshots, human review and versioned JSON export. 30/30 Node tests passed. Browser verification covered claim creation, provenance linkage and review in both locales.
- Next milestone: per-use qualitative L-READY assessment. Team reviewer permissions remain pending.

## 2026-11-26 · P3 L-READY

- P2d merged into main at [`580b089`](https://github.com/nexvary/Nexvary-NRI/commit/580b08919aa40924dee093842c6b6a12bf49a610).
- Added per-use qualitative assessments with immutable revision snapshots, reviewed sources, recorded gaps and explicit safety and authorization blockers.
- 32/32 Node tests passed. Browser acceptance exercised a blocked assessment in Arabic desktop and English mobile. Economic feasibility and sensitivity analysis follow.

## 2026-11-26 · P4 economics

- P3 merged into main at [`8bcef24`](https://github.com/nexvary/Nexvary-NRI/commit/8bcef2421881fb0aa4a95b9b9162fc8625fef269).
- Added comparable hypothetical scenarios, break-even, one-variable sensitivities and a versioned JSON export.
- 34/34 Node tests passed. Browser acceptance verified a saved scenario in Arabic desktop and English mobile. Scientific library and workspace come next.

## 2026-11-26 · P4b scientific library and dashboard

- P4 merged into main at [`0b65081`](https://github.com/nexvary/Nexvary-NRI/commit/0b65081aafa0324b5fa931db2239c146dc9fd0d0).
- Added scoped library search and replaced sample dashboard records with real account data. 35/35 Node tests passed. Browser acceptance exercised a live Crossref lookup, Arabic dashboard and English mobile search.
- Researcher profiles and permissions are next. Rich library and manuscript workflows remain open.

## 2026-11-26 · P4c research network

- P4b merged into main at [`1401e0d`](https://github.com/nexvary/Nexvary-NRI/commit/1401e0df6992aba475cc775b823a3a4ea167cbe9).
- Added opt-in discovery, follow/block and scoped collaboration requests. 36/36 Node tests passed. Bilingual browser acceptance verified profile opt-in and a local request.
- Role-based project sharing and verified ORCID account linking remain separate release work.

## 2026-11-26 · P4d scientific analytics

- P4c merged into main at [`eba9742`](https://github.com/nexvary/Nexvary-NRI/commit/eba9742304654c26fc9b269b2201bfb4c597d6b4).
- Added private, request-scoped CSV analysis, descriptive metrics, histogram, outlier flags and reproducible JSON export. 38/38 Node tests passed and browser verification exercised both locales.
- Technology observatory follows.

## 2026-11-26 · P4e technology observatory

- P4d merged into main at [`db65e09`](https://github.com/nexvary/Nexvary-NRI/commit/db65e092b6775cb65bc15ea08223127c3e9f33f1).
- Added private watchlists, saved searches, and dated source updates with preserved metadata. 39/39 Node tests passed. Browser verification used captured public Zenodo metadata in both locales.
- Bilingual PDF and DOCX report generation follows.

## 2026-11-26 · P6 Report Studio

- P4e merged into main at [`e992ce4`](https://github.com/nexvary/Nexvary-NRI/commit/e992ce4f75f1119868ebfbbd67f004ca6b4e327c).
- Added versioned PDF/DOCX exports with private project sources, evidence and L-READY results. 41/41 tests passed with the renderer enabled, including actual authenticated bilingual downloads. Browser captures record the download controls.
- Security and release verification follow. Optional AI remains disabled.

## 2026-11-26 · P7 local security and recovery

- P6 merged into main at [`b727312`](https://github.com/nexvary/Nexvary-NRI/commit/b727312602957d4310fd168de266b23176afffd5).
- Added session controls and a bounded security audit, verified backups/restores, and a read-only CI workflow with real bilingual report rendering. 43/43 tests passed locally with the renderer enabled. Settings screenshots verify Arabic desktop and English mobile.
- Commercial deployment, billing, verified ORCID OAuth ownership, optional AI, richer manuscript tools and project-scoped collaboration authorization are still open.

## 2026-11-27 · P7b scoped project sharing

- P7 merged into main at [`45bbdde`](https://github.com/nexvary/Nexvary-NRI/commit/45bbddee57d6e36f87d85caedefeb7722c270f44) after [GitHub Actions run 45901615488](https://github.com/nexvary/Nexvary-NRI/actions/runs/45901615488) succeeded.
- Added explicit summary-reader invitations with acceptance, decline, revoke and block-driven access removal. 44/44 local tests passed, and both locales were exercised in the browser.
- Shared notes, tasks and wider roles remain pending. Optional AI, verified ORCID OAuth, production identity and billing still need external credentials, defined entitlements or owner operating decisions as applicable.

## 2026-11-27 · P7c research learning library

- P7b merged into main at [`d8b6a5f`](https://github.com/nexvary/Nexvary-NRI/commit/d8b6a5f335ef76e458a2fe04cdc5aa5ebc3b888d) after [GitHub Actions run 45902068331](https://github.com/nexvary/Nexvary-NRI/actions/runs/45902068331) succeeded.
- Added two bilingual lessons with local scoring and a descriptive-statistics simulation. 45/45 local tests passed with PDF/DOCX rendering enabled. Both locales were exercised in Qt WebEngine.

## 2026-11-27 · NRI-08a local source review

- Resumed from remote main at `0c643a4`, the merge of PR #18.
- Replaced the Assistant placeholder with a signed-in bilingual source review. Uses saved, owner-scoped snapshots, including historical provider notices. The local review uses no external APIs.
- Targeted regression: 6/6. Full suite: 45 passed, zero failures and one optional report-renderer integration test skipped locally. Browser captures are pending.
- Continue with BYOK, explicit external sharing consent and metered, cited answers before starting messaging.

## 2026-11-27 · NRI-08a visual acceptance after resumption

- Resumed draft PR #19 at `02e2cb4`. The baseline passes 46/46 with the bilingual renderer.
- Exercised saved-source review in Chromium in both languages and at desktop and mobile sizes. The four captures are linked from [STATUS.md](STATUS.md).
- The old CI run timed out during DevTools startup. Added launch diagnostics and a hosted-runner launch setting for the isolated fixture.

## 2026-11-27 · NRI-08b provider preferences and encrypted BYOK

- Added bilingual provider/model settings and account-bound encryption for OpenAI keys using the existing paired workspace key. Saving preferences makes no provider requests.
- Full regression with real reports: 47/47. Recaptured the Assistant after adding the settings link.
- Browser QA can discover Chrome through DevToolsActivePort and checks overflow independently of vertical scrollbar width.

## 2026-11-27 · NRI-08c optional local cited answers

- Added bounded loopback generation with saved-source citation matching and unsupported citation warnings, plus a short scoped cache, cancellation and deadline.
- 48/48 with real report rendering. Provider checks used only mocked responses. External generation and the durable usage and cost ledger remain.

## 2026-11-27 · NRI-08d external consent and estimated spend controls

- Added opt-in OpenAI transport, consent tied to disclosed reference snapshots, daily reservations and provider-reported usage. Mocked tests verify consent and budget denial, citation results and cache hits.
- No live OpenAI calls were made. NRI-11 is the next acceptance milestone.

## 2026-11-27 · NRI-11 private researcher messages

- Added participant-scoped direct threads, encrypted text, read markers, an in-app notification preference, blocking, reporting and send/report limits. Conversation creation uses accepted collaboration relationships.
- 50/50 with real report rendering. Chromium sent a message and captured both languages at desktop and mobile sizes. See [STATUS.md](STATUS.md) for the captures and next milestone.

## 2026-11-27 · NRI-18a optional authenticator MFA

- Added password-confirmed setup and deactivation, encrypted TOTP seeds, one-use recovery codes, and transactional revocation of other sessions whenever MFA changes.
- 51/51 with real report rendering. Real browser captures cover bilingual security settings.

## 2026-11-27 · NRI-18b scoped report review

- Added a locally provisioned moderator role and decision queue limited to reported messages. Review conflicts, immutable decisions and live role revocation are verified.
- 52/52 with real report rendering. Chromium captured bilingual report review. Remaining NRI-18 work starts with account export and deletion.

## 2026-11-27 · NRI-18c account privacy

- Added password/MFA-confirmed data export and transactional deletion with explicit confirmation.
- Verified isolation, credential and data removal, and restoration semantics for pre- and post-deletion backups. Chromium exercised export and captured the privacy page.

## 2026-11-27 · NRI-10a project team roles and review

- Added five team roles, version-bound invitations, role-aware contribution and review, and attributable access and version history.
- 54/54 with real report rendering. Chromium created a manuscript and captured both locales.

## 2026-11-27 · NRI-19a local licensing and readiness

- Added MFA-gated operator plans, dated entitlements, project and external token ceilings, audit history and a SQLite health endpoint.
- 55/55 with real report rendering. Chromium saved a plan and captured bilingual layouts. The recovery guide records deployment rehearsal and rollback for the loopback release.

## 2026-11-27 · NRI-01a private dashboard data

- Connected accepted collaborator counts, the user’s self-reported ORCID and metered usage to the signed-in dashboard.
- 56/56 with real report rendering. Chromium captured Arabic desktop and English mobile.

## 2026-11-27 · NRI-10b project work and invitations

- Added team notes, concurrent-safe task status changes, attributable audit events, and pending invitation notices.
- 56/56 with real report rendering. Chromium created a task and captured both locales.

## 2026-11-27 · NRI-02a manuscript catalog

- Added searchable authors, tags, publication status and DOI with independently attributable metadata revisions.
- 56/56 with real report rendering. Chromium saved catalog metadata and captured Arabic desktop and English mobile.

## 2026-11-27 · NRI-03a collections and reading marks

- Added private PDF collections, bookmarks, and version-specific reading annotations. Included all three in account export and deletion coverage.
- 57/57 with real report rendering. Chromium saved an annotation and captured both locales.

## 2026-11-27 · NRI-03b citation exchange

- Added private BibTeX/RIS exchange, source provenance, DOI and provider identifier grouping and controlled merges.
- 59/59 with real report rendering. Chromium imported a citation in the running app.

## 2026-11-27 · NRI-03c embedded PDF versions

- Added local PDF.js rendering, version selection, page navigation and reading mark links.
- 59/59 with real report rendering. Chromium verified actual page pixels and navigation, and npm audit found no reported vulnerabilities in installed dependencies.

## 2026-11-27 · NRI-10c resource sharing

- Added read-only, per-recipient grants tied to a specific membership acceptance. Verified snapshot scope, direct route protections and revocation during report generation.
- 60/60 with real report rendering. Chromium granted an individual PDF version and captured both languages.

## 2026-11-27 · NRI-19b transport and operations

- Added direct TLS staging, secure cookies, idle session expiry, independent login limits, JSON request logs and a hardened service template.
- 62/62 with real report rendering, 48 concurrent TLS reads, verified migration and rollback, and Chromium regression. Updated WeasyPrint and pip following the Python dependency audit.

## 2026-11-27 · NRI-19c quotas

- Added configurable PDF storage and UTC daily report limits with transactional checks, refunds on failed rendering or access revocation, and bilingual operator controls.
- 62/62 with real report rendering. Chromium verified saving a quota-enabled plan.

## 2026-11-27 · Release acceptance increment

- Added Crossref DOI agency lookups with dated private snapshots and explicit unavailable and missing outcomes.
- Completed the bilingual developer page and expanded About System with methodology, release history, support and legal drafts for owner review.
- 64/64 tests passed with the real bilingual renderer. Chromium captured both About views at both viewport sizes in both locales.

## 2026-11-27 · Local account recovery

- Added private-terminal operator password reset with per-account session revocation, stale-credential rejection and a user-visible security event.
- Verified v26 migration, existing audit history and cross-account isolation. Full local suite with the real bilingual renderer passes 65/65.

## 2026-11-27 · Encrypted workspace backup

- Added authenticated archive export and restore, preserving local paired bundles for compatibility.
- Verified preservation of PDF content and isolation of failed restores, with 66/66 local tests. Added optional systemd backup units with syntax verification.

## 2026-11-27 · Local concurrent workspace load

- Ran 24- and 48-client mixed read/write/isolation workloads against disposable on-disk SQLite stores. The runs completed 1,440 and 2,880 requests respectively with no unexpected outcomes. Recorded throughput, latency and resource measurements in [DEPLOYMENT.md](DEPLOYMENT.md#sqlite-workload-measurements).

## 2026-11-27 · Hosted browser regression reliability

- Wait for a responsive DevTools endpoint, bound browser commands, close completed tabs and print the Chrome diagnostic tail when a run fails. Existing visual assertions remain active.
- Added bilingual System and Developer captures in both viewport sizes to the existing Chromium suite.


## 2026-11-27 · Private TXT documents

- Added versioned UTF-8 TXT uploads and escaped previews, with private downloads, filtering and shared storage quotas. [CI passed](https://github.com/nexvary/Nexvary-NRI/actions/runs/46009913116) at `1d4d604`.

## 2026-11-27 · Private DOCX documents

- Added bounded archive and XML validation and escaped plain-text previews. Security tests cover malformed XML, DTD declarations, ZIP traversal and expansion limits, macros and external relationships. [CI passed](https://github.com/nexvary/Nexvary-NRI/actions/runs/46010490212) at `7004239`.

## 2026-11-27 · Recoverable workspace key rotation

- Added offline SQLite snapshot rotation for document bytes, messages, MFA secrets and provider credentials, with version history and recovery-code preservation. [CI passed 71/71](https://github.com/nexvary/Nexvary-NRI/actions/runs/46011042141) on `ca3fde9` with a killed-child interruption test and encrypted backup rollback.

## 2026-11-27 · Independent L-READY decisions

- Added accepted-reviewer-only decisions with an independence declaration, one write per revision and attributable history. Current-revision decisions appear in Report Studio. [Regression and browser evidence](https://github.com/nexvary/Nexvary-NRI/actions/runs/46011593215).

## 2026-11-27 · NRI-20 account subscription lifecycle

- Adopted the centralized Debian SaaS architecture and added NRI-20 to the acceptance matrix.
- Migrated existing assignments as active with their prior expiry dates. Added audited, validated state changes, trials and current-password confirmation in the existing operator console.
- Project creation, document storage, report rendering and external AI reservations use the effective subscription state. Existing private data and resource access checks are preserved.
- Local regression: 73 passed, zero failed, zero skipped, with the pinned bilingual report renderer. Hosted browser verification follows in PR #19.

## 2026-11-27 · Reference-to-evidence provenance

- Link to an evidence form with the selected provider snapshot prefilled. Bind the submission to identifier, provider, retrieval time and metadata. A refreshed record requires a new selection even when the lookup timestamp is identical.
- Report Studio preserves the cited snapshot and surfaces conflicting saved retraction flags and claims without a reviewed supporting link eligible as evidence.
- Local regression: 73 passed, zero failed, zero skipped, including actual bilingual PDF and DOCX rendering.

## 2026-11-27 · NRI Control Center foundation

- Added a separate bilingual Control Center at `/control-center` for existing licensed operators with confirmed MFA. The previous licensing path uses the same handler and checks.
- All commercial mutations require rate-limited current-password confirmation and an active session. Existing origin protection and transactional audit writes apply.
- Local regression: 73 passed, zero failed, zero skipped, with actual bilingual PDF and DOCX rendering.

## 2026-11-27 · Sandbox billing event ingress

- Added a provider-independent verifier contract with a synthetic HMAC adapter. The adapter authenticates the original bytes, checks a five-minute timestamp window, and rejects malformed or oversized envelopes.
- Schema v31 records normalized invoice, payment, refund, renewal and cancellation events with a unique provider and event ID. Identical retries are idempotent and conflicting retries preserve the first event.
- This increment exposes an internal interface only. Invoice projections, subscription reconciliation and administration are pending. Local regression: 74 passed, zero failed, zero skipped.

## 2026-11-27 · Production entitlement gate

- Added schema v32 for explicit module grants, a default-deny HTTP route inventory and strict HTTPS defaults. Existing plan assignments need explicit grants before serving external traffic.
- Added audited plan grant management to the existing MFA and password-confirmed Control Center. Plan permissions remain independent of account and resource authorization.
- Local regression with the actual bilingual renderer: 75 passed, zero failed, zero skipped. Verifies TLS default-deny, isolated project access, plan edit conflicts, and in-flight report revocation. [Hosted CI and browser regression passed for the recovered SHA](https://github.com/nexvary/Nexvary-NRI/actions/runs/46067500586).


## 2026-11-27 · Institutional subscriptions and seats

- Published the original v33 seat configuration on draft PR #19. Schema v34 adds organizations, operator-managed memberships and subscriptions, seat allocation and revocation, and attributable institutional audit records.
- Institutional seats feed the same server-side module and quota checks as individual assignments. Existing personal assignments take precedence. Membership and private resource permissions remain independent.
- The deterministic regression covers competing allocations, revocation, expiry, blocked direct requests, unauthorized administration and post-expiry account export.

## 2026-11-27 · Configurable plan pricing

- Added optional ISO currency and independently configurable monthly and annual prices in integer minor units. Existing plans stay unpriced. Pricing edits and clearing require the existing MFA and password checks and are audited.
- Local regression: 76 passed, zero failed, zero skipped, including protected pricing edits and bilingual report rendering. Price configuration does not initiate billing.

## 2026-11-27 · Scoped sandbox billing review

- Exposed the existing signed synthetic ledger in a bilingual, paginated Control Center view. Owners and explicitly assigned billing reviewers with MFA can read the ledger. Billing review does not confer licensing writes or access to research.
- The local operator CLI can grant or revoke `billing-reviewer`. No payment endpoint or live payment provider was added.
- Local regression: 77 passed, zero failed, zero skipped, with signed synthetic invoice display and access and revocation checks. The preceding [pricing](https://github.com/nexvary/Nexvary-NRI/actions/runs/46070596059) and [institutional seat](https://github.com/nexvary/Nexvary-NRI/actions/runs/46070436861) increments passed hosted regression and browser QA.

## 2026-11-27 · Post-expiry document portability

- Added a paginated list of owned document versions on the account Privacy screen. Downloads use existing password, conditional MFA, session and document ownership checks, independent of a subscription.
- Direct requests for other accounts' files are denied. The full account archive keeps its existing size limit and individual downloads support large libraries.
