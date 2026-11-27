import { crossrefUrl, normalizeDoi } from './crossref.js';
import { createMetadataClient } from './metadata-client.js';

export const doiAgencyUrl = (doi) => crossrefUrl(doi) + '/agency';

export function createDoiAgencyClient(options = {}) {
  return createMetadataClient({
    ...options,
    url: doiAgencyUrl,
    normalize(payload, doi) {
      const message = payload?.message;
      const agency = message?.agency;
      if (normalizeDoi(message?.DOI) !== doi || typeof agency?.id !== 'string'
        || !/^[a-z0-9_-]{1,40}$/i.test(agency.id) || typeof agency.label !== 'string'
        || !agency.label.trim()) return null;
      return { agencyId: agency.id.toLowerCase(), agencyLabel: agency.label.trim().slice(0, 120) };
    },
  });
}
