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

Next: extend project team access with explicit owner-controlled grants on documents, reference snapshots, reports and readiness. Cover direct URL and download authorization for every role and after revocation. Continue production readiness from the [functional matrix](STATUS.md#functional-acceptance).
