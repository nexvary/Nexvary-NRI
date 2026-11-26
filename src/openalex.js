import { normalizeDoi } from './crossref.js';
import { createMetadataClient } from './metadata-client.js';

const api = 'https://api.openalex.org/works/doi:';

function text(value, limit = 400) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function safeOpenAccessUrl(value) {
  try {
    const url = new URL(text(value, 2048));
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    return '';
  }
  return '';
}

function normalizeWork(work) {
  const title = text(Array.isArray(work.title) ? work.title[0] : work.title);
  const primary = work.primary_location ?? {};
  const venue = text(primary.source?.display_name);
  const publisher = text(primary.source?.host_organization_name);
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  const authors = authorships
    .map((a) => text(a?.author?.display_name))
    .filter(Boolean)
    .slice(0, 12);
  const moreAuthors = authorships.length > 12;
  const type = text(work.type);
  const year = Number.isInteger(work.publication_year) && work.publication_year > 0 && work.publication_year < 10000
    ? String(work.publication_year)
    : '';
  const isRetracted = work.is_retracted === true;
  const best = work.best_oa_location;
  const openAccessUrl = [
    best?.pdf_url, best?.landing_page_url,
    ...(primary.is_oa === true ? [primary.pdf_url, primary.landing_page_url] : []),
  ].map(safeOpenAccessUrl).find(Boolean) ?? '';
  return { title, venue, publisher, authors, moreAuthors, type, issued: year, isRetracted, openAccessUrl };
}

export function openAlexUrl(doi) {
  return api + doi.split('/').map(encodeURIComponent).join('/');
}

export function createOpenAlexClient(options = {}) {
  return createMetadataClient({
    ...options,
    url: openAlexUrl,
    normalize: (payload, doi) => normalizeDoi(payload?.doi) === doi ? normalizeWork(payload) : null,
  });
}
