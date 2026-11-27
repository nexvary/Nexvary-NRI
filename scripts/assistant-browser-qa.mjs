import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { totp } from '../src/mfa.js';
import { hashPassword } from '../src/password.js';
import { createApp } from '../src/server.js';
import { openWorkspaceStore } from '../src/store.js';

const profiles = await mkdtemp(join(tmpdir(), 'nri-visual-'));
const output = process.argv[2] ?? join(profiles, 'screenshots');
const store = openWorkspaceStore();
const email = 'visual@example.test';
const fixturePassword = 'browser fixture password';
store.addAccount(email, await hashPassword(fixturePassword));
const { id } = store.credentials(email);
const session = store.newSession(id);
const project = store.createProject(id, { title: 'Source review sample', description: '' });
const pages = ['NRI READING SAMPLE', 'VERSION-SCOPED ANNOTATIONS'].map((line) =>
  '0.08 0.22 0.40 rg 20 95 300 36 re f 1 g BT /F1 16 Tf 30 108 Td (' + line + ') Tj ET');
const contents = (stream) => '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  ...[6, 7].map((stream) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 340 150] /Resources << /Font << /F1 5 0 R >> >> /Contents ${stream} 0 R >>`),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ...pages.map(contents),
];
let fixturePdf = '%PDF-1.4\n';
const offsets = objects.map((object, index) => {
  const offset = fixturePdf.length;
  fixturePdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  return offset;
});
const xref = fixturePdf.length;
fixturePdf += 'xref\n0 8\n0000000000 65535 f \n' + offsets.map((offset) =>
  String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
  'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
const sampleDocument = store.documents.create(id, project, { name: 'Reference review.pdf', bytes: Buffer.from(fixturePdf) });
const textDocument = store.documents.create(id, project, {
  name: 'Research notes.txt', bytes: Buffer.from('Research notes\nملاحظات البحث <source>'),
});
const collection = store.organization.create(id, 'Research methods');
store.organization.membership(id, project, sampleDocument, collection, true);
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
assert.equal(store.teams.grant(id,project,peer,'reviewer'),true);
const [roleInvitation] = store.teams.inbox(peer);
assert.equal(store.teams.decide(peer,project,'reviewer',roleInvitation.invitation,'accepted'),true);
const thread = store.messages.open(id, peer);
store.messages.send(peer, thread, 'Could we verify the reference metadata before submitting the report?');
const moderatorEmail = 'moderator@example.test';
store.addAccount(moderatorEmail, { salt: Buffer.alloc(16), hash: Buffer.alloc(32) });
const moderator = store.credentials(moderatorEmail).id;
store.messages.setModerator(moderator, true);
const moderatorSession = store.newSession(moderator);
store.licensing.setOperator(moderator, true);
assert.equal(store.mfa.begin(moderator), true);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bits = [...store.mfa.pending(moderator)].map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
const seed = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
assert.equal(store.mfa.confirm(moderator, totp(seed, Math.floor(Date.now() / 30_000)), moderatorSession).length, 8);
const app = createApp(store);
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + app.address().port;

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('Chrome DevTools disconnected.'));
    pending.clear();
  });
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
      const deadline = setTimeout(() => request.reject(new Error('DevTools command timed out: ' + method)), 15_000);
      try {
        socket.send(JSON.stringify({ id, method, params }));
        return await request.promise;
      } finally {
        clearTimeout(deadline);
        pending.delete(id);
      }
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
    const address = /^\d+$/.test(port) ? '127.0.0.1:' + port
      : browserOutput.match(/DevTools listening on ws:\/\/(127\.0\.0\.1:\d+)/)?.[1];
    if (!address) return;
    try {
      const response = await fetch('http://' + address + '/json/version', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).webSocketDebuggerUrl) return address;
    } catch {
      // Chrome can announce DevTools before it accepts requests.
    }
  }, 'DevTools startup', 250);
  for (const lang of ['ar', 'en']) {
    for (const [name, width, height] of [['desktop', 1440, 920], ['mobile', 390, 844]]) {
      const tabResponse = await fetch('http://' + devtools + '/json/new?about:blank', { method: 'PUT', signal: AbortSignal.timeout(5000) });
      assert.equal(tabResponse.ok, true);
      const { id: tabId, webSocketDebuggerUrl } = await tabResponse.json();
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
      await send('Page.navigate', { url: origin + '/workspace/projects/' + project + '/documents/' +
        textDocument + '/versions/1/preview?lang=' + lang });
      await waitFor(() => inspect(send,
        'document.querySelector(".document-text-preview")?.textContent.includes("ملاحظات البحث <source>")'),
      'private TXT preview');
      await captureLayout(send, 'txt-preview', lang, name, width, height);
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
        await send('Page.navigate', { url: origin + '/?lang=' + lang });
        const tokenLabel = lang === 'ar' ? 'الرموز التي أبلغ عنها المزوّد' : 'Provider-reported tokens';
        await waitFor(() => inspect(send, 'document.body?.textContent.includes(' + JSON.stringify(tokenLabel) + ')'), 'private dashboard metrics');
        await captureLayout(send, 'dashboard', lang, name, width, height);
        const teamUrl = origin + '/workspace/projects/' + project + '/team?lang=' + lang;
        if (lang === 'ar') {
          await send('Page.navigate', { url: teamUrl });
          await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=save]"))'), 'manuscript form');
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=save]');
            button.form.elements.title.value = 'Illustrative methods draft';
            button.form.elements.body.value = 'Verify each source and record the retrieval date.';
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        } else {
          const [draft] = store.teams.view(id, project).manuscripts;
          await send('Page.navigate', { url: teamUrl + '&manuscript=' + draft.id });
        }
        await waitFor(() => inspect(send, 'location.search.includes("manuscript=") && document.body?.textContent.includes("Verify each source")'), 'saved manuscript version');
        await captureLayout(send, 'team', lang, name, width, height);
        if (lang === 'ar') {
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=metadata]');
            button.closest('details').open = true;
            button.form.elements.authors.value = 'Sample team';
            button.form.elements.tags.value = 'research methods';
            button.form.elements.stage.value = 'submitted';
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        }
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("textarea[name=authors]")?.value.includes("Sample team"))'), 'saved manuscript metadata');
        await captureLayout(send, 'catalog', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/projects/' + project + '/team/work?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=task]"))'), 'team task form');
        if (lang === 'ar') {
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=task]');
            button.form.elements.text.value = 'Verify the source metadata';
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        }
        await waitFor(() => inspect(send, 'document.body?.textContent.includes("Verify the source metadata")'), 'created team task');
        await captureLayout(send, 'team-work', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/projects/' + project + '/documents/' + sampleDocument + '/reading?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=add-mark]"))'), 'reading marks form');
        if (lang === 'ar') {
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=add-mark]');
            button.form.elements.page.value = 1;
            button.form.elements.kind.value = 'annotation';
            button.form.elements.text.value = 'Record the review date.';
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        }
        await waitFor(() => inspect(send, 'Boolean(document.querySelector(".message-list")?.textContent.includes("Record the review date."))'), 'saved reading annotation');
        const renderedPdf = () => inspect(send, `(() => {
          const canvas = document.querySelector('[data-pdf-reader] canvas');
          if (!canvas || canvas.hidden) return false;
          const pixel = canvas.getContext('2d').getImageData(Math.round(canvas.width * .91), Math.round(canvas.height * .32), 1, 1).data;
          return pixel[0] < 100 && pixel[1] < 140 && pixel[2] > pixel[0];
        })()`);
        await waitFor(renderedPdf, 'rendered PDF pixels');
        await inspect(send, 'document.querySelector("[data-next]").click()');
        await waitFor(() => inspect(send, 'new URL(location.href).searchParams.get("page") === "2"'), 'reader second page');
        await captureLayout(send, 'pdf-reader', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/projects/' + project + '/citations?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=import]"))'), 'citation import form');
        if (lang === 'ar') {
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=import]');
            button.form.elements.data.value = '@article{fixture, title={Illustrative catalog citation}, author={Sample team}}';
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        }
        await waitFor(() => inspect(send, 'document.body?.textContent.includes("Illustrative catalog citation")'), 'imported citation');
        await captureLayout(send, 'citations', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/projects/' + project + '/shared-resources?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=share]"))'), 'resource grant form');
        if (lang === 'ar') {
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=share]');
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        }
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=revoke]"))'), 'approved document grant');
        await captureLayout(send, 'resource-sharing', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/settings/mfa?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=begin]"))'), 'MFA settings');
        await captureLayout(send, 'mfa', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/settings/privacy?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=export]"))'), 'account privacy settings');
        await captureLayout(send, 'privacy', lang, name, width, height);
        if (lang === 'ar') {
          const downloads = join(profiles, 'downloads');
          await mkdir(downloads, { recursive: true });
          await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=export]');
            button.form.elements.password.value = ${JSON.stringify(fixturePassword)};
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
          const exported = await waitFor(() => readFile(join(downloads, 'nri-account-export.json'), 'utf8').catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          }), 'reauthenticated JSON download');
          assert.equal(JSON.parse(exported).account.email, email);
        }
        const moderatorCookie = await send('Network.setCookie', {
          url: origin, name: 'nri_session', value: moderatorSession, httpOnly: true, sameSite: 'Strict',
        });
        assert.equal(moderatorCookie.success, true);
        await send('Page.navigate', { url: origin + '/workspace/settings/message-moderation?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=upheld]"))'), 'message moderation queue');
        await captureLayout(send, 'moderation', lang, name, width, height);
        await send('Page.navigate', { url: origin + '/workspace/settings/licensing?lang=' + lang });
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("button[value=save]"))'), 'operator licensing form');
        if (lang === 'ar') {
          await inspect(send, `(() => {
            const button = document.querySelector('button[value=save]');
            button.form.elements.plan.value = 'research';
            button.form.elements['project-limit'].value = 10;
            button.form.elements['ai-tokens'].value = 5000;
            button.form.elements['storage-mib'].value = 250;
            button.form.elements['daily-reports'].value = 3;
            setTimeout(() => button.form.requestSubmit(button), 0);
          })()`);
        }
        await waitFor(() => inspect(send, 'Boolean(document.querySelector("select[name=plan] option[value=research]"))'), 'saved workspace plan');
        await captureLayout(send, 'licensing', lang, name, width, height);
      }
      for (const view of ['about', 'developer']) {
        await send('Page.navigate', { url: origin + '/?lang=' + lang + '&view=' + view });
        await waitFor(() => inspect(send, `location.search.includes('view=${view}') &&
          Boolean(document.querySelector('.tabs [aria-current="page"]'))`), view + ' navigation');
        await captureLayout(send, view, lang, name, width, height);
      }
      client.socket.close();
      const closed = await fetch('http://' + devtools + '/json/close/' + tabId,
        { signal: AbortSignal.timeout(3000) });
      assert.equal(closed.ok, true);
      await closed.text();
    }
  }
} catch (error) {
  if (browserOutput.trim()) console.error(browserOutput.trim().slice(-12000));
  throw error;
} finally {
  for (const { socket } of clients) socket.close();
  chrome.kill();
  await exited.catch(() => {});
  await new Promise((resolve) => app.close(resolve));
  await rm(profiles, { recursive: true, force: true });
}
