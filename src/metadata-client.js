const responseLimit = 2 * 1024 * 1024;
const requestInterval = 1000;

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

export function createMetadataClient({ url, normalize, fetchRecord = fetch, now = Date.now }) {
  let inFlight = false;
  let nextAllowed = 0;
  return async (identifier) => {
    const start = now();
    if (inFlight || nextAllowed > start) {
      return { status: 'limited', retryAfter: Math.max(1, Math.ceil((nextAllowed - start) / 1000)) };
    }
    inFlight = true;
    nextAllowed = start + requestInterval;
    try {
      const response = await fetchRecord(url(identifier), {
        headers: { Accept: 'application/json', 'User-Agent': 'Nexvary-NRI/0.4.0' },
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
      const metadata = normalize(payload, identifier);
      if (!metadata) return { status: 'unavailable' };
      return { status: 'found', checkedAt: now(), metadata };
    } catch {
      return { status: 'unavailable' };
    } finally {
      inFlight = false;
    }
  };
}
