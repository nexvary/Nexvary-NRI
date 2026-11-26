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
