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

Next: fetch and fast-forward to the PR head. Implement owner-scoped account export and deletion in the authenticated settings routes. Verify foreign-origin denial, destructive confirmation, cleanup of files/credentials/sessions and recovery behavior from paired workspace backups. Continue broader project RBAC, commercial readiness and the other incomplete items in the [functional matrix](STATUS.md#functional-acceptance).
