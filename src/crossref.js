const api = 'https://api.crossref.org/works/';
const resolver = 'https://doi.org/';
const responseLimit = 4 * 1024 * 1024;
const requestInterval = 1000;

export function normalizeDoi(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim();
  if (candidate.length > 1100) return null;
  if (/^https?:\/\//i.test(candidate)) {
    if (/\s/.test(candidate)) return null;
    try {
      const url = new URL(candidate);
      if (!['doi.org', 'dx.doi.org'].includes(url.hostname)
        || url.port || url.username || url.password || url.search || url.hash) return null;
      candidate = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return null;
    }
  } else {
    candidate = candidate.replace(/^doi:\s*/i, '');
  }
  if (candidate.length > 512 || !/^10\.\d{4,9}\/[!-~]+$/.test(candidate)
    || candidate.split('/').some((part) => part === '.' || part === '..')) return null;
  return candidate.toLowerCase();
}

function encodeDoi(doi) {
  return doi.split('/').map(encodeURIComponent).join('/');
}

export function crossrefUrl(doi) {
  return api + encodeDoi(doi);
}

export function resolverUrl(doi) {
  return resolver + encodeDoi(doi);
}

function text(value, limit = 400) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function firstText(values) {
  return Array.isArray(values) ? text(values[0]) : '';
}

function dateParts(value) {
  const parts = value?.['date-parts']?.[0];
  if (!Array.isArray(parts)) return '';
  const [year, month, day] = parts;
  if (!Number.isInteger(year) || year < 1 || year > 9999) return '';
  const date = [String(year).padStart(4, '0')];
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    date.push(String(month).padStart(2, '0'));
    const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (Number.isInteger(day) && day >= 1 && day <= daysInMonth[month - 1]) {
      date.push(String(day).padStart(2, '0'));
    }
  }
  return date.join('-');
}

function readUpdates(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => ({
    type: text(item?.type, 80).toLowerCase(),
    doi: normalizeDoi(item?.DOI),
    date: dateParts(item?.updated),
    source: text(item?.source, 80),
  })).filter((item) => item.type || item.doi);
}

function normalizeWork(work) {
  const type = text(work.type, 80);
  const subtype = text(work.subtype, 80);
  const authors = Array.isArray(work.author) ? work.author : [];
  const updatedBy = readUpdates(work['updated-by']);
  const updates = readUpdates(work['update-to']);
  const priority = (item) => ['retraction', 'correction', 'corrigendum', 'erratum', 'expression-of-concern'].includes(item.type);
  const shown = (rows) => rows.sort((a, b) => Number(priority(b)) - Number(priority(a))).slice(0, 30);
  return {
    title: firstText(work.title),
    venue: firstText(work['container-title']),
    publisher: text(work.publisher),
    authors: authors.map((author) => text(author?.name) || [text(author?.given), text(author?.family)].filter(Boolean).join(' '))
      .filter(Boolean).slice(0, 12),
    moreAuthors: authors.length > 12,
    type,
    subtype,
    issued: dateParts(work.issued),
    updatedBy: shown(updatedBy),
    updates: shown(updates),
    updatesTruncated: updatedBy.length > 30 || updates.length > 30,
  };
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

export function createCrossrefClient({ fetchRecord = fetch, now = Date.now } = {}) {
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
      const response = await fetchRecord(crossrefUrl(doi), {
        headers: { Accept: 'application/json', 'User-Agent': 'Nexvary-NRI/0.4.0' },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
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
      const work = payload?.message;
      if (payload?.['message-type'] !== 'work' || !work || normalizeDoi(work.DOI) !== doi) {
        return { status: 'unavailable' };
      }
      return { status: 'found', checkedAt: now(), metadata: normalizeWork(work) };
    } catch {
      return { status: 'unavailable' };
    } finally {
      inFlight = false;
    }
  };
}
