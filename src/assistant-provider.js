const outputTokens = 512;
const responseLimit = 64 * 1024;

function localEndpoint(port) {
  if (!/^\d{1,5}$/.test(port ?? '') || Number(port) < 1 || Number(port) > 65535) return undefined;
  return `http://127.0.0.1:${Number(port)}/v1/chat/completions`;
}

function externalPolicy(settings) {
  if (!settings?.model) return undefined;
  const { model } = settings;
  const [inputRate, outputRate, tokens, cost] = [settings.inputRate, settings.outputRate, settings.dailyTokens, settings.dailyCost].map(Number);
  if (![inputRate, outputRate, tokens, cost].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000)) return undefined;
  return {
    model, limits: { tokens, cost },
    // Rates are microdollars per million tokens. Round reservations up.
    cost(input, output) {
      return Math.ceil((input * inputRate + output * outputRate) / 1_000_000);
    },
    estimate(messages) {
      // UTF-8 bytes plus a framing allowance conservatively estimate this text-only request.
      const input = messages.reduce((n, item) => n + Buffer.byteLength(item.content), 128);
      return { tokens: input + outputTokens, cost: this.cost(input, outputTokens) };
    },
  };
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
  openai = {
    model: process.env.NRI_OPENAI_MODEL,
    inputRate: process.env.NRI_OPENAI_INPUT_MICROUSD_PER_MILLION,
    outputRate: process.env.NRI_OPENAI_OUTPUT_MICROUSD_PER_MILLION,
    dailyTokens: process.env.NRI_OPENAI_DAILY_TOKENS,
    dailyCost: process.env.NRI_OPENAI_DAILY_MICROUSD,
  },
} = {}) {
  const endpoint = localEndpoint(localPort);
  async function complete(url, { model, messages, signal }, apiKey) {
    if (!url) throw new Error('Provider unavailable.');
    const deadline = AbortSignal.timeout(timeout);
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) },
      body: JSON.stringify({
        model, messages, stream: false,
        [apiKey ? 'max_completion_tokens' : 'max_tokens']: outputTokens,
      }),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Provider request failed.');
    }
    return readCompletion(response);
  }
  const content = (result) => {
    const text = result?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim() || text.length > 12_000) throw new Error('Invalid provider answer.');
    return text;
  };
  const policy = externalPolicy(openai);
  return {
    localAvailable: Boolean(endpoint),
    policy,
    async generateLocal(input) {
      return content(await complete(endpoint, input));
    },
    async generateExternal(input, apiKey, recordUsage) {
      if (!policy || input.model !== policy.model || !apiKey) throw new Error('External provider unavailable.');
      const result = await complete('https://api.openai.com/v1/chat/completions', input, apiKey);
      const { prompt_tokens: prompt, completion_tokens: completion } = result?.usage ?? {};
      if ([prompt, completion].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000)) {
        recordUsage(prompt, completion, policy.cost(prompt, completion));
      }
      return content(result);
    },
  };
}
