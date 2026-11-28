# Private development migration

The verified public baseline is draft PR #19 at `5f7de45`. Preserve its branch and draft status. Owner approval is required for any visibility change or transfer of source to a private destination.

1. Confirm the owner-approved private destination and who should have access. If changing visibility in place, verify the effect on PR #19, existing collaborations, GitHub Actions, fork access and branch protections before making the change. If using a separate private repository, leave public PR #19 open as a draft and create a private draft with the approved source and the continuation checkpoint.
2. Inventory public branches, tags, release archives, workflow uploads and known mirrors. Treat anything previously public as already disclosed. Review whether historically exposed credentials need rotation before granting CI access.
3. Copy only reviewed source, history and synthetic fixtures into the private destination. Keep databases, backups, credentials, customer files and real payment data outside GitHub source and artifacts. Grant least-privilege access and verify required checks and artifact visibility with the owner.
4. Push the verified entitlement commit only after the private destination is confirmed. Run full regression and Chromium workflows there and record commit, run ID and artifact links with the acceptance matrix.
5. Build from the private source for Debian delivery. Review generated client assets, package manifests and releases for proprietary server content. Complete dependency license review, an SBOM and the owner-approved commercial licensing policy before release.

The current entitlement change is committed locally pending an authorized private destination. Public repository settings and production hosts are outside this milestone.
