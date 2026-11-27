# ADR 0002 · Nexvary-operated commercial SaaS

Status: architecture accepted. Implementation is tracked in the acceptance matrix.

Nexvary Inc. operates the backend centrally on Debian Linux and serves the responsive Arabic RTL and English LTR application over HTTPS. Windows, Linux, macOS, Android and iOS use the browser application. Future desktop and mobile applications may use secured server APIs. Proprietary business logic, entitlement rules and payment credentials belong on the server. Standalone Windows packages containing the backend or license mechanisms are outside the delivery model.

## Entitlement and security boundaries

NRI-20 extends the existing SQLite licensing tables and quota hooks. Keep three independent checks for protected requests: authenticated identity, role and resource authorization, and commercial eligibility for the requested feature. Evaluate eligibility on the server at the start of protected operations and recheck after asynchronous work when delivery may cross a revocation. Production feature policies must deny access when an operation has no applicable entitlement rule. Resource authorization remains mandatory for every shared or private record.

The first increment governs existing metered operations for assigned accounts. Trial, active and grace use plan limits until their expiry, where applicable. Past-due, expired, suspended, cancelled and revoked assignments cannot create projects, store versions, initiate report exports or reserve external AI usage. Existing authorized data reads remain available. Account recovery and security functions are independent of subscriptions. Unassigned accounts retain the existing staging behavior until explicit production provisioning and route enforcement are in place. A comprehensive read-only and data portability policy remains a separate acceptance item.

## Plans and billing

Use configurable Free, Researcher, Professional, Research Team, Enterprise and institutional plans. Keep currency and monthly and annual amounts unset until owner approval. Model module permissions, project and storage capacity, document and export allowances, AI usage, team members, concurrent sessions, trial duration, grace periods and institutional seats in the shared engine. Define the organization and seat ownership model before applying organizational allowances to user operations.

Keep the billing adapter replaceable. Record invoices, payments, renewals, discounts, promotional and complimentary grants, manual institutional subscriptions, refunds and cancellations. Verify provider signatures against the original bounded webhook body before accepting a provider event. Record the provider event identifier with a uniqueness constraint and apply any subscription change and audit event in the same transaction. Exercise the interface with synthetic fixtures. Live payments require separate authorization.

## NRI Control Center

Use a dedicated administration portal with separate owner, billing, support, moderator and security permissions. Require MFA and reauthentication for sensitive changes, and apply CSRF checks, rate limits and auditable server-side role enforcement. Billing and support roles receive only the data needed for their duties. Populate statistics and analytics from actual records.

Track user management, organizations, licenses, plans, active subscriptions, trials, invoices and payments, discount codes, module permissions, storage, quota use, AI consumption, devices and sessions, security events, moderation, system health, backup status, audit, commercial analytics and system settings as portal acceptance items.

## Release verification

Verify isolation with different accounts, organizations and administrative roles, including direct API requests. Verify expiry, suspension, cancellation, revocation, data retention, quota contention and duplicate billing events. Verify HTTPS, database migration, backups and rollback on the target host, and desktop, phone and tablet acceptance in both languages.
