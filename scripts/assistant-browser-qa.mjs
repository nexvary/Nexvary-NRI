import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser condition timed out');
}

const chrome = spawn(process.env.NRI_CHROME ?? 'google-chrome', [
  '--headless', '--disable-dev-shm-usage', '--remote-debugging-port=0',
  '--user-data-dir=' + profiles, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(chrome, 'exit');
let browserOutput = '';
let launchError;
chrome.on('error', (error) => { launchError = error; });
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', (chunk) => { browserOutput += chunk; });
const clients = [];

try {
  await mkdir(output, { recursive: true });
  const devtools = await waitFor(() => {
    if (launchError) throw launchError;
    return browserOutput.match(/DevTools listening on ws:\/\/(127\.0\.0\.1:\d+)/)?.[1];
  });
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
      await waitFor(() => inspect(send, 'Boolean(document.querySelector("select[name=project]"))'));
      assert.equal(await inspect(send, `(() => {
        const field = document.querySelector('select[name=project]');
        field.value = ${JSON.stringify(project)};
        field.form.requestSubmit();
        return Boolean(field.value);
      })()`), true);
      await waitFor(() => inspect(send, 'document.body.innerText.includes("Illustrative reference snapshot")'));
      const layout = await inspect(send, `document.fonts.ready.then(() => ({
        lang: document.documentElement.lang, direction: document.documentElement.dir,
        viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
        svg: Boolean(document.querySelector('nav svg'))
      }))`);
      assert.deepEqual(layout, { lang, direction: lang === 'ar' ? 'rtl' : 'ltr', viewport: width, page: width, svg: true });
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
