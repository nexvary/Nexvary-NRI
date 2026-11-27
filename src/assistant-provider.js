const outputTokens = 512;
const responseLimit = 64 * 1024;

function localEndpoint(port) {
  if (!/^\d{1,5}$/.test(port ?? '') || Number(port) < 1 || Number(port) > 65535) return undefined;
  return `http://127.0.0.1:${Number(port)}/v1/chat/completions`;
}

async function readCompletion(response) {
  if (!response.body) throw new Error('Missing provider response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) throw new Error('Provider response too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAssistantProvider({
  fetchImpl = fetch, localPort = process.env.NRI_LOCAL_AI_PORT, timeout = 15_000,
} = {}) {
  const endpoint = localEndpoint(localPort);
  return {
    localAvailable: Boolean(endpoint),
    async generateLocal({ model, messages, signal }) {
      if (!endpoint) throw new Error('Local provider unavailable.');
      const deadline = AbortSignal.timeout(timeout);
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: outputTokens, stream: false }),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Provider request failed.');
      }
      const result = await readCompletion(response);
      const content = result?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim() || content.length > 12_000) throw new Error('Invalid provider answer.');
      return content;
    },
  };
}
