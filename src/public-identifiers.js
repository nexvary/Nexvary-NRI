import { normalizeDoi } from './crossref.js';
import { createMetadataClient } from './metadata-client.js';

function text(value, limit = 400) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function normalizeOrcid(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().replace(/^https:\/\/orcid\.org\//i, '').toUpperCase();
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/.test(id)) return null;
  const digits = id.replaceAll('-', '');
  const sum = [...digits.slice(0, 15)].reduce((total, digit) => (total + Number(digit)) * 2, 0);
  const check = (12 - (sum % 11)) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check)) ? id : null;
}

export function normalizeZenodoDoi(input) {
  const doi = normalizeDoi(input);
  return /^10\.5281\/zenodo\.[1-9]\d{0,15}$/.test(doi ?? '') ? doi : null;
}

export const zenodoUrl = (doi) => 'https://zenodo.org/api/records/' + doi.split('.').at(-1);
export const orcidUrl = (id) => 'https://pub.orcid.org/v3.0/' + id + '/person';

export function createOrcidClient(options = {}) {
  return createMetadataClient({
    ...options,
    url: orcidUrl,
    normalize: (record, id) => {
      const name = record?.name;
      if (!record || (name?.path && name.path !== id)) return null;
      if (name?.visibility === 'public' && name.path === id) {
        const fullName = [text(name['given-names']?.value), text(name['family-name']?.value)].filter(Boolean).join(' ');
        return { title: text(name['credit-name']?.value) || fullName };
      }
      // A successful public-person response may omit the name.
      return Object.hasOwn(record, 'name') && name === null ? { title: '' } : null;
    },
  });
}

export function createZenodoClient(options = {}) {
  return createMetadataClient({
    ...options,
    url: zenodoUrl,
    normalize: (record, doi) => {
      const data = record?.metadata;
      if (!data || record.status !== 'published' || normalizeDoi(record.doi ?? data.doi) !== doi) return null;
      const creators = Array.isArray(data.creators) ? data.creators : [];
      return {
        title: text(data.title),
        authors: creators.slice(0, 12).map((creator) => text(creator?.name)).filter(Boolean),
        moreAuthors: creators.length > 12,
        type: text(data.resource_type?.title),
        issued: text(data.publication_date, 32),
        license: text(data.license?.id, 100),
      };
    },
  });
}
