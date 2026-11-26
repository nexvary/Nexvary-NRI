# ADR 0004 · DOI checks and Crossref provenance

- Status: accepted for P2a
- Date: 2026-11-26

## Decision

Use Crossref's public singleton work endpoint after a signed-in user chooses to check a DOI. Send the normalized DOI in a fixed HTTPS request, with no redirects, document contents, identity or project data. The client supports bare DOIs, a DOI prefix and DOI resolver links in the accepted ASCII subset. It encodes reserved characters and preserves slash separators.

A matching Crossref work record is stored with its source URL, the UTC retrieval timestamp and selected bibliographic fields. Crossref's `updated-by` indicates notices affecting the work. Its `update-to` indicates works affected by the looked-up notice. Keep the directions separate and preserve notice type, DOI, date and provenance where provided. The app displays a preprint label when the provider explicitly identifies the record as a preprint. The interface displays up to 12 author entries and up to 30 notices in each direction with a link to the provider record.

A Crossref 404 is a source-specific unknown, while a timeout, invalid response, HTTP error or rate limit indicates a lookup failure. Provider failures do not replace saved results. Crossref metadata does not establish peer review, scientific validity, or the absence of a correction or retraction.

## Storage and request controls

Cache lookups by account and normalized DOI. Keep found records for 24 hours and source-specific misses for 15 minutes. Store a project snapshot separately so expiration of the lookup cache does not remove the saved reference. Ownership filters cover project reads, writes and removal, and each save revalidates the project after network I/O.

Use one active Crossref request per local process with at least one second between request starts, a five-second timeout, a four MiB response limit and backoff for HTTP 429. There are no automatic retries or scheduled lookups. Additional providers, agency resolution, cross-provider comparison, and the evidence review flow remain outside P2a.

## References

- [Crossref REST API access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication)
- [Crossref DOI URL encoding](https://www.crossref.org/documentation/member-setup/constructing-your-dois/suffixes-containing-special-characters)
- [Crossref metadata updates](https://www.crossref.org/documentation/register-maintain-records/maintaining-your-metadata/registering-updates/)
- [Crossref Retraction Watch data](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/)
