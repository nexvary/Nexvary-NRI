# NRI-08 resumption checkpoint

Owner authorization to resume arrived on 2026-11-27 (Cairo). Keep [draft PR #19](https://github.com/nexvary/Nexvary-NRI/pull/19) open. Branch: `feature/nri-08-source-review`.

- Resumed from `02e2cb4`. The 46 baseline tests pass with the bilingual report renderer enabled.
- Real Chromium QA exercised project selection and saved-source results in Arabic and English at desktop (1440×920) and mobile (390×844) viewport sizes. Captures are linked from [STATUS.md](STATUS.md).
- Historical [CI run 45905875325](https://github.com/nexvary/Nexvary-NRI/actions/runs/45905875325) passed the tests and timed out before Chrome exposed DevTools. The harness now reports failed launch details and uses the hosted CI runner isolation for its synthetic loopback fixture.

NRI-08b adds encrypted per-account OpenAI credentials and offline, OpenAI, or local model settings. `NRI_REPORT_PYTHON=<renderer-python> npm test` passes all 47 tests. Start with `src/assistant-settings.js` and `test/assistant-settings.test.js`.

NRI-08c wires optional loopback answers in `src/assistant-answer.js` and `src/assistant-provider.js`. `NRI_REPORT_PYTHON=<renderer-python> npm test` passes 48/48. The mocked integration test covers account isolation, citation matching, caching and cancellation. Set `NRI_LOCAL_AI_PORT` to the port of an existing loopback OpenAI-compatible server to exercise with a local model.

Next: add an external OpenAI transport behind explicit per-request consent to the displayed metadata and question. Enforce token and cost controls before outbound calls, account for usage in a durable ledger, and extend the existing citation, cancellation, timeout and caching tests to cover the external path. Keep the default Offline and mock outbound requests in tests. Resume NRI-11 after NRI-08 acceptance.
