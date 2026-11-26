# Development log

## 2026-11-26 · P2b OpenAlex acceptance

- Baseline: main at `bf2598a`, OpenAlex draft [PR #5](https://github.com/nexvary/Nexvary-NRI/pull/5) at `598f69a`. No GitHub Actions workflows or runs on either baseline commit.
- Hardened provider DOI matching and open-access links. Added accurate source attribution, an explicit unknown retraction state, and a side-by-side title comparison with responsive stacking.
- Verification: 28 Node.js tests pass, including saved-provider isolation, v3 migration and mismatched upstream DOI rejection. Both live adapters returned public metadata for DOI `10.1038/nature14539`. No paid API calls.
- Remaining sequence: ORCID and Zenodo, claim/evidence review, L-READY, economics, workspace/library, network/collaboration, analytics/observatory, optional AI, reports and release readiness. See the complete 19-module audit in [STATUS.md](STATUS.md).
