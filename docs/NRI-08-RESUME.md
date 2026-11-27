# NRI-08 resumption checkpoint

Owner authorization to resume arrived on 2026-11-27 (Cairo). Keep [draft PR #19](https://github.com/nexvary/Nexvary-NRI/pull/19) open. Branch: `feature/nri-08-source-review`.

- Resumed from `02e2cb4`. The 46 baseline tests pass with the bilingual report renderer enabled.
- Real Chromium QA exercised project selection and saved-source results in Arabic and English at desktop (1440×920) and mobile (390×844) viewport sizes. Captures are linked from [STATUS.md](STATUS.md).
- Historical [CI run 45905875325](https://github.com/nexvary/Nexvary-NRI/actions/runs/45905875325) passed the tests and timed out before Chrome exposed DevTools. The harness now reports failed launch details and uses the hosted CI runner isolation for its synthetic loopback fixture.

Next: preserve offline mode and add encrypted BYOK provider/model settings, then explicit external sharing consent, cited replies with verification and unsupported-claim warnings, usage and budget enforcement, cancellation, timeouts and caching. Resume NRI-11 after NRI-08 acceptance.
