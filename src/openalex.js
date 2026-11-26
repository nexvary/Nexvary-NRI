const api = 'https://api.openalex.org/works/doi:';
const responseLimit = 2 * 1024 * 1024;
const requestInterval = 1000;

function text(value, limit = 400) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
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
  const openAccessUrl = text(primary.pdf_url ?? primary.landing_page_url);
  return { title, venue, publisher, authors, moreAuthors, type, issued: year, isRetracted, openAccessUrl };
}

async function readJson(response) {
  if (!response.body || Number(response.headers.get('content-length')) > responseLimit) {
    await response.body?.cancel();
    return;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > responseLimit) return;
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(content);
}

function retryDelay(header, now) {
  if (header && /^\d+$/.test(header)) return Math.min(Number(header), 2_147_483) * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 30_000;
}

export function openAlexUrl(doi) {
  return api + doi.split('/').map(encodeURIComponent).join('/');
}

export function createOpenAlexClient({ fetchRecord = fetch, now = Date.now } = {}) {
  let inFlight = false;
  let nextAllowed = 0;
  return async (doi) => {
    const start = now();
    if (inFlight || nextAllowed > start) {
      return { status: 'limited', retryAfter: Math.max(1, Math.ceil((nextAllowed - start) / 1000)) };
    }
    inFlight = true;
    nextAllowed = start + requestInterval;
    try {
      const response = await fetchRecord(openAlexUrl(doi), {
        headers: { Accept: 'application/json', 'User-Agent': 'Nexvary-NRI/0.5.0 (mailto:info@nexvary.com)' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 429) {
        await response.body?.cancel();
        const observed = now();
        const delay = Math.max(requestInterval, retryDelay(response.headers.get('retry-after'), observed));
        nextAllowed = observed + delay;
        return { status: 'limited', retryAfter: Math.ceil(delay / 1000) };
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) return { status: 'not-found', checkedAt: now(), metadata: null };
        return { status: 'unavailable' };
      }
      const payload = await readJson(response);
      if (!payload || typeof payload !== 'object') return { status: 'unavailable' };
      return { status: 'found', checkedAt: now(), metadata: normalizeWork(payload) };
    } catch {
      return { status: 'unavailable' };
    } finally {
      inFlight = false;
    }
  };
}
