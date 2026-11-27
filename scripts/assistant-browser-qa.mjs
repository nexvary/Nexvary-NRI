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
const peerEmail = 'coauthor@example.test';
store.addAccount(peerEmail, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
const peer = store.credentials(peerEmail).id;
store.network.save(id, { name: 'NRI Researcher', interests: '', orcid: '', discoverable: true });
store.network.save(peer, { name: 'NRI Coauthor', interests: '', orcid: '', discoverable: true });
store.network.interact(id, peer, 'request');
store.network.interact(peer, id, 'accept');
const thread = store.messages.open(id, peer);
store.messages.send(peer, thread, 'Could we verify the reference metadata before submitting the report?');
const moderatorEmail = 'moderator@example.test';
store.addAccount(moderatorEmail, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
const moderator = store.credentials(moderatorEmail).id;
store.messages.setModerator(moderator, true);
const moderatorSession = store.newSession(moderator);
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
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser condition timed out: ' + description);
}

async function captureLayout(send, kind, lang, name, width, height) {
  const layout = await inspect(send, `document.fonts.ready.then(() => ({
    lang: document.documentElement.lang, direction: document.documentElement.dir,
    viewport: window.innerWidth, client: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    svg: Boolean(document.querySelector('nav svg'))
  }))`);
  assert.equal(layout.page, layout.client, kind + ' layout has no horizontal overflow');
  assert.deepEqual({ lang: layout.lang, direction: layout.direction, viewport: layout.viewport, svg: layout.svg },
    { lang, direction: lang === 'ar' ? 'rtl' : 'ltr', viewport: width, svg: true });
  const { cssContentSize } = await send('Page.getLayoutMetrics');
  const contentHeight = Math.ceil(cssContentSize.height);
  const capture = contentHeight > height ? {
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: contentHeight, scale: 1 },
  } : {};
  const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 83, ...capture });
  await writeFile(join(output, `${kind}-${lang}-${name}.webp`), Buffer.from(data, 'base64'));
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
        setTimeout(() => field.form.requestSubmit(), 0);
        return Boolean(field.value);
      })()`), true);
      await waitFor(() => inspect(send, 'Boolean(document.body?.innerText.includes("Illustrative reference snapshot"))'), 'saved source result');
      await captureLayout(send, 'assistant', lang, name, width, height);
      await send('Page.navigate', { url: origin + '/workspace/messages/' + thread + '?lang=' + lang });
      await waitFor(() => inspect(send, 'Boolean(document.querySelector(".message-list")?.textContent.includes("verify the reference metadata"))'), 'private message thread');
      if (lang === 'ar' && name === 'desktop') {
        await inspect(send, `(() => {
          const field = document.querySelector('textarea[name=text]');
          field.value = 'I checked the saved snapshot and its retrieval date.';
          setTimeout(() => field.form.requestSubmit(field.form.querySelector('button')), 0);
        })()`);
      }
      await waitFor(() => inspect(send, 'Boolean(document.querySelector(".message-list")?.textContent.includes("checked the saved snapshot"))'), 'sent private message');
      await captureLayout(send, 'messages', lang, name, width, height);
      if (lang === 'ar' && name === 'desktop') {
        const [reported] = store.messages.list(peer, thread, null);
        assert.equal(store.messages.report(peer, thread, reported.id, 'other'), 303);
      }
      if ((lang === 'ar' && name === 'desktop') || (lang === 'en' && name === 'mobile')) {
        await send('Page.navigate', { url: origin + '/workspace/settings/mfa?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=begin]"))'), 'MFA settings');
        await captureLayout(send, 'mfa', lang, name, width, height);
        const moderatorCookie = await send('Network.setCookie', {
          url: origin, name: 'nri_session', value: moderatorSession, httpOnly: true, sameSite: 'Strict',
        });
        assert.equal(moderatorCookie.success, true);
        await send('Page.navigate', { url: origin + '/workspace/settings/message-moderation?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=upheld]"))'), 'message moderation queue');
        await captureLayout(send, 'moderation', lang, name, width, height);
      }
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
