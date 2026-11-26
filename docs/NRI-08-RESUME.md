# NRI-08 suspension checkpoint

Development paused by the owner on 2026-11-27 (Cairo). Resume only after explicit owner authorization. Keep [draft PR #19](https://github.com/nexvary/Nexvary-NRI/pull/19) open and unmerged.

- Base: main at `0c643a4`. Source and browser harness checkpoint: `52fdebe6d7990ef12e9667c0a0fde9295c6c3221` on `feature/nri-08-source-review`.
- [NRI CI run 45905875325](https://github.com/nexvary/Nexvary-NRI/actions/runs/45905875325) passed all 46 Node tests and failed browser capture. The timeout comes from the condition at line 85 of `scripts/assistant-browser-qa.mjs`. Assistant screenshots for this PR remain pending.
- The Assistant reviews saved, account-scoped source snapshots in Arabic and English without external calls.

## Resume after approval

1. Fetch origin and check the current head of PR #19. Switch to `feature/nri-08-source-review` and fast-forward to its remote tip. Read AGENTS.md and the latest status and development entries.
2. Use the browser and report prerequisites in the NRI CI workflow. Run `npm test` and `node scripts/assistant-browser-qa.mjs /tmp/nri-assistant-qa`. Inspect browser state at the failing condition before changing selectors or waits.
3. Verify Arabic and English at desktop and mobile sizes. Inspect actual captures, commit the screenshots and check the CI artifact and PR checks.
4. Continue NRI-08 in dependency order: preserve the local mode, then implement encrypted BYOK storage and provider/model settings, explicit consent for external data, cited replies with verification and unsupported-claim warnings, usage limits and estimates, cancellation, timeouts and caching. Resume messaging after the Assistant acceptance checks pass.
