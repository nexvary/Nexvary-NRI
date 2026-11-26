# ADR 0001 · Bilingual web shell

- Status: accepted for P0
- Date: 2026-11-26

## Context

The first milestone needs a responsive web shell with Arabic and English, a clear boundary between demo and live data, and a reproducible run without external services. Persistence, identity and private documents arrive in P1.

## Decision

Use the Node.js 22+ standard library for the P0 HTTP server and tests. Render semantic HTML on the server with one stylesheet and no client build step. The language and view are URL parameters, so locale-specific pages are bookmarkable and the language switch can retain the selected module. English uses LTR and Arabic uses RTL within the reference's fixed desktop rails. The preview runs on loopback by default and reads only local presentation data.

Keep translated copy and fixtures outside the HTTP layer. The framework, storage and deployment choices for private data remain open for P1. Prefer a web modular monolith with module-level interfaces. Before persistence, select a maintained authentication and storage stack and define tenant ownership, access checks on every data path, auditable mutations, migrations, recovery and cross-tenant authorization tests.

## Consequences

P0 needs neither package installation nor a database. Language and navigation work with JavaScript disabled. Full-page requests are the cost of this design. The preview has no workspace state, identity, live integrations or billing.
