import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const profiles = await mkdtemp(join(tmpdir(), 'nri-visual-'));
const output = process.argv[2] ?? join(profiles, 'screenshots');
const store = openWorkspaceStore();
const email = 'visual@example.test';
store.addAccount(email, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
const { id } = store.credentials(email);
const session = store.newSession(id);
const project = store.createProject(id, { title: 'Source review sample', description: '' });
store.references.save(id, project, {
  doi: '10.0000/visual-example', provider: 'crossref', status: 'found',
  checkedAt: Date.UTC(2026, 10, 26), metadata: { title: 'Illustrative reference snapshot' },
});
const app = createApp(store);
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + app.address().port;

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    socket,
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    async send(method, params = {}) {
      const id = ++sequence;
      const request = Promise.withResolvers();
      pending.set(id, request);
      socket.send(JSON.stringify({ id, method, params }));
      return request.promise;
    },
  };
}

async function inspect(send, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function waitFor(check, description, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser condition timed out: ' + description);
}

const chrome = spawn(process.env.NRI_CHROME ?? 'google-chrome', [
  '--headless', '--enable-logging=stderr', '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  // Hosted CI uses a disposable runner and opens only our synthetic loopback fixture.
  ...(process.env.GITHUB_ACTIONS === 'true' ? ['--no-sandbox'] : []),
  '--user-data-dir=' + profiles, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = new Promise((resolve) => {
  chrome.once('close', resolve);
});
let browserOutput = '';
let launchError;
chrome.on('error', (error) => { launchError = error; });
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', (chunk) => { browserOutput += chunk; });
const clients = [];

try {
  await mkdir(output, { recursive: true });
  const devtools = await waitFor(async () => {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error('Chrome exited before DevTools was available:\n' + browserOutput.trim());
    }
    // Full Chrome publishes the selected port here even when its launcher suppresses stderr.
    const activePort = await readFile(join(profiles, 'DevToolsActivePort'), 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    const port = activePort.split('\n', 1)[0];
    if (/^\d+$/.test(port)) return '127.0.0.1:' + port;
    return browserOutput.match(/DevTools listening on ws:\/\/(127\.0\.0\.1:\d+)/)?.[1];
  }, 'DevTools startup', 150);
  for (const lang of ['ar', 'en']) {
    for (const [name, width, height] of [['desktop', 1440, 920], ['mobile', 390, 844]]) {
      const tabResponse = await fetch('http://' + devtools + '/json/new?about:blank', { method: 'PUT' });
      assert.equal(tabResponse.ok, true);
      const { webSocketDebuggerUrl } = await tabResponse.json();
      const client = connect(webSocketDebuggerUrl);
      clients.push(client);
      await client.ready;
      const { send } = client;
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: name === 'mobile',
      });
      const { success } = await send('Network.setCookie', {
        url: origin, name: 'nri_session', value: session, httpOnly: true, sameSite: 'Strict',
      });
      assert.equal(success, true);
      await send('Page.navigate', { url: origin + '/workspace/assistant?lang=' + lang });
      await waitFor(() => inspect(send, 'Boolean(document.querySelector("select[name=project]"))'), 'Assistant project selector');
      assert.equal(await inspect(send, `(() => {
        const field = document.querySelector('select[name=project]');
        field.value = ${JSON.stringify(project)};
        field.form.requestSubmit();
        return Boolean(field.value);
      })()`), true);
      await waitFor(() => inspect(send, 'Boolean(document.body?.innerText.includes("Illustrative reference snapshot"))'), 'saved source result');
      const layout = await inspect(send, `document.fonts.ready.then(() => ({
        lang: document.documentElement.lang, direction: document.documentElement.dir,
        viewport: window.innerWidth, client: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        svg: Boolean(document.querySelector('nav svg'))
      }))`);
      assert.equal(layout.page, layout.client, 'Assistant layout has no horizontal overflow');
      assert.deepEqual({ lang: layout.lang, direction: layout.direction, viewport: layout.viewport, svg: layout.svg },
        { lang, direction: lang === 'ar' ? 'rtl' : 'ltr', viewport: width, svg: true });
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      const { data } = await send('Page.captureScreenshot', {
        format: 'webp', quality: 83, captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: Math.max(height, Math.ceil(cssContentSize.height)), scale: 1 },
      });
      await writeFile(join(output, `assistant-${lang}-${name}.webp`), Buffer.from(data, 'base64'));
      client.socket.close();
    }
  }
} finally {
  for (const { socket } of clients) socket.close();
  chrome.kill();
  await exited.catch(() => {});
  await new Promise((resolve) => app.close(resolve));
  await rm(profiles, { recursive: true, force: true });
}
