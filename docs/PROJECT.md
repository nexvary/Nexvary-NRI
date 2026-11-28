# Product charter
NRI is a bilingual Arabic/English research and technology intelligence platform for independent researchers, universities, companies and investors. Mission: from scientific evidence to strategic decisions.
## Modules
Research Manager: projects, manuscripts, versions, tags, PDF metadata, search and private storage.
Reference Validator: DOI resolution, Crossref/OpenAlex/Zenodo metadata, ORCID identifiers; record retrieval dates, provenance, corrections and unknown status.
Evidence Intelligence: claim-to-source links, evidence type, limitations, conflicting findings, human review.
L-READY: six dimensions L scientific evidence, R verification, E economics, A availability, D safety/governance, Y societal value. Per intended use classify evidence as unavailable, preliminary, independent within limited scope, or integrated and fit for use. Record source, date, reviewer, limitations and decision. No aggregate score; missing required authorization or unsafe use blocks readiness. Based on the owner's proposed research framework; not independently validated or accredited.
Economic Analytics: transparent assumptions, units, sensitivity analysis; distinguish hypothetical models from forecasts.
AI Assistant: optional provider adapters, citations, human verification, consent and cost limits; core works without AI.
Technology Observatory: tracked topics and dated source updates, no unapproved recurring paid jobs.
Report Studio: reproducible PDF/DOCX exports with references, limitations and version.
Licensing & Subscription Management (NRI-20): commercial plans, server-side entitlements, subscription lifecycle, sandbox billing interfaces and the NRI Control Center.
## Delivery
P0 architecture decision and minimal runnable bilingual shell; P1 auth, projects, documents; P2 reference/evidence; P3 L-READY; P4 economics; P5 optional AI; P6 reports; P7 billing and release QA. Centralized responsive HTTPS SaaS on Debian Linux, operated by Nexvary Inc. See [ADR 0002](decisions/0002-commercial-saas.md). Multi-tenant isolation, RBAC, encryption, audit logs, backups, accessibility, RTL and automated tests. Use synthetic fixtures only in public repo. No secrets or private manuscripts.
