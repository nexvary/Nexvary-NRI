import { dashboardModules } from './entitlements.js';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createAssistantProvider } from './assistant-provider.js';
import { createDoiAgencyClient } from './doi-agency.js';
import { createCrossrefClient } from './crossref.js';
import { createOpenAlexClient } from './openalex.js';
import { createOrcidClient, createZenodoClient, normalizeOrcid } from './public-identifiers.js';
import { createLocalReportRenderer } from './reports.js';
import { modules } from './content.js';
import { render } from './render.js';
import { openWorkspaceStore, workspaceDatabasePath } from './store.js';
import { createWorkspaceHandler, readSessionCookie, resolveWorkspaceRoute } from './workspace.js';
import { referenceProjectsPath, workspacePage, workspacePath } from './workspace-view.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const stylesheet = readFileSync(new URL('../public/styles.css', import.meta.url));
const dashboardNavigation = readFileSync(new URL('../public/dashboard-navigation.js', import.meta.url));
const pdfAssets = new URL('../node_modules/pdfjs-dist/', import.meta.url);
function readerAssets(path) {
  if (path === '/pdf-reader.mjs') return new URL('../public/pdf-reader.mjs', import.meta.url);
  const module = /^\/pdf-assets\/(pdf(?:\.worker)?\.mjs)$/.exec(path);
  if (module) return new URL('build/' + module[1], pdfAssets);
  const font = /^\/pdf-assets\/(cmaps\/[a-z0-9-]+\.bcmap|standard_fonts\/[a-z0-9_.-]+\.(?:ttf|pfb))$/i.exec(path);
  return font ? new URL(font[1], pdfAssets) : undefined;
}
const baseSecurityHeaders = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
};

export function createApp(store = openWorkspaceStore(), {
  crossref = createCrossrefClient(),
  agency = createDoiAgencyClient(),
  openalex = createOpenAlexClient(),
  orcid = createOrcidClient(),
  zenodo = createZenodoClient(),
  reportRenderer = createLocalReportRenderer(),
  assistantProvider = createAssistantProvider(),
  tls = undefined,
  log = undefined,
  enforceEntitlements = Boolean(tls),
} = {}) {
  const origin = tls ? new URL(tls.origin) : undefined;
  if (origin && (origin.protocol !== 'https:' || origin.origin !== tls.origin)) {
    throw new Error('NRI public origin must be a canonical HTTPS origin.');
  }
  const securityHeaders = origin ? { ...baseSecurityHeaders, 'Strict-Transport-Security': 'max-age=31536000' } : baseSecurityHeaders;
  const logEvent = (event, fields = {}) => log?.({ time: new Date().toISOString(), event, ...fields });
  const workspace = createWorkspaceHandler(store, { crossref, openalex, orcid, zenodo, agency }, version, reportRenderer, assistantProvider, origin?.origin, enforceEntitlements);

  async function handle(request, response) {
    if (origin && request.headers.host?.toLowerCase() !== origin.host) {
      response.writeHead(421, { ...securityHeaders, 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (!request.url?.startsWith('/')) {
      response.writeHead(400, securityHeaders).end();
      return;
    }
    const { pathname, searchParams } = new URL(`http://localhost${request.url}`);
    const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
    if (pathname === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
      request.nriRoute = 'health';
      let healthy = false;
      try {
        healthy = store.healthy();
      } catch {
        logEvent('health.error');
      }
      response.writeHead(healthy ? 200 : 503, {
        ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8',
      }).end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }));
      return;
    }
    const asset = readerAssets(pathname);
    if (asset && ['GET','HEAD'].includes(request.method)) {
      try {
        const bytes = readFileSync(asset);
        const type = pathname.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
        response.writeHead(200, { ...securityHeaders, 'Content-Type': type,
          'Content-Security-Policy': "default-src 'none'; connect-src 'self'; frame-ancestors 'none'" })
          .end(request.method === 'HEAD' ? undefined : bytes);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        response.writeHead(404,securityHeaders).end();
      }
      return;
    }
    const route = resolveWorkspaceRoute(pathname);
    request.nriRoute = route?.kind ?? 'public';
    const token = readSessionCookie(request.headers.cookie, Boolean(origin));
    if ((route || pathname === '/') && token && !['cross-site','same-site'].includes(request.headers['sec-fetch-site'])) {
      response.once('finish', () => {
        if (response.statusCode >= 400) return;
        try { store.touchSession(token); }
        catch { logEvent('session.activity.error'); }
      });
    }

    const redirect = (location, headers) => {
      response.writeHead(303, { ...securityHeaders, 'Cache-Control': 'no-store', Location: location, ...headers }).end();
    };

    const sendPage = (status, view, page, headers, dashboard) => {
      const session = store.session(token);
      const mayRead = (module) => session && (!enforceEntitlements || store.licensing.allowsModules(session.id, [module]));
      const unread = mayRead(11) && store.messages.notifications(session.id) ? store.messages.unread(session.id) : 0;
      const answer = request.method === 'HEAD' ? undefined : render({ lang, view, version, page, workspace: dashboard, unread, invitations: mayRead(10) ? store.teams.pending(session.id) : 0, theme: session ? store.settings.profile(session.id).theme : 'dark' });
      response.writeHead(status, {
        ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': lang, ...headers,
        ...(view === 'dashboard' && !page ? { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } : {}),
        ...(session ? { 'Cache-Control': 'no-store' } : {}),
      }).end(answer);
    };

    if (route) {
      const section = { reference: 'references', evidence: 'evidence', readiness: 'l-ready', economics: 'economics', library: 'library', network: 'network', collaboration: 'collaboration', analytics: 'analytics', observatory: 'observatory', report: 'reports', settings: 'settings', sharing: 'collaboration', education: 'education', assistant: 'assistant', messages: 'messages' };
      const view = Object.entries(section).find(([key]) => route.kind.startsWith(key))?.[1] ?? 'research';
      const reply = (status, page, headers, body) => {
        const privateHeaders = { 'Cache-Control': 'no-store', ...headers };
        if (page) sendPage(status, view, page, privateHeaders);
        else response.writeHead(status, { ...securityHeaders, ...privateHeaders }).end(request.method === 'HEAD' ? undefined : body);
      };
      await workspace({ request, reply, redirect, route, lang });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...securityHeaders, Allow: 'GET, HEAD' }).end();
      return;
    }
    if (pathname === '/styles.css') {
      response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/css; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : stylesheet);
      return;
    }
    if (pathname === '/dashboard-navigation.js') {
      response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      response.end(request.method === 'HEAD' ? undefined : dashboardNavigation);
      return;
    }

    const view = searchParams.get('view') ?? 'dashboard';
    if (pathname === '/' && view === 'research') {
      redirect(workspacePath(lang));
      return;
    }
    if (pathname === '/' && view === 'dashboard') {
      const session = store.session(token);
      let dashboard;
      if (session && (!enforceEntitlements || store.licensing.allowsModules(session.id, dashboardModules))) {
        const owner = session.id;
        try {
          dashboard = store.library.dashboard(owner);
          dashboard.metrics.collaborations = store.network.collaborations(owner);
          dashboard.orcid = normalizeOrcid(store.network.profile(owner)?.orcid ?? '');
          dashboard.usage = store.assistantUsage.today(owner);
        } catch {
          logEvent('dashboard.load.error');
          const title = lang === 'ar' ? 'لوحة التحكم غير متاحة' : 'Dashboard unavailable';
          const detail = lang === 'ar' ? 'تعذّر تحميل بيانات لوحة التحكم. حاول مرة أخرى بعد قليل.' : 'Dashboard data could not be loaded. Retry in a moment.';
          sendPage(503, view, { title, path: '/', html: `<section class="surface panel detail" role="alert"><h1>${title}</h1><p>${detail}</p><a class="action" href="/?lang=${lang}">${lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</a></section>` }, { 'Cache-Control': 'no-store' });
          return;
        }
      }
      const denied = session && !dashboard;
      sendPage(denied ? 403 : 200, view, denied ? workspacePage(lang, 'entitlement') : undefined,
        { 'Cache-Control': 'no-store' }, dashboard);
      return;
    }
    if (pathname === '/' && view === 'reports') {
      redirect(`/workspace/report-projects?lang=${lang}`);
      return;
    }
    if (pathname === '/' && ['network', 'collaboration', 'analytics', 'observatory', 'settings', 'education', 'assistant', 'messages'].includes(view)) {
      redirect(`/workspace/${view}?lang=${lang}`);
      return;
    }
    if (pathname === '/' && view === 'library') {
      redirect(`/workspace/library?lang=${lang}`);
      return;
    }
    if (pathname === '/' && view === 'economics') {
      redirect(`/workspace/economics-projects?lang=${lang}`);
      return;
    }
    if (pathname === '/' && view === 'l-ready') {
      redirect(`/workspace/readiness-projects?lang=${lang}`);
      return;
    }
    if (pathname === '/' && view === 'evidence') {
      redirect(`/workspace/evidence-projects?lang=${lang}`);
      return;
    }
    if (pathname === '/' && view === 'references') {
      redirect(referenceProjectsPath(lang));
      return;
    }
    const available = pathname === '/' && (Object.hasOwn(modules, view) || view === 'developer');
    sendPage(available ? 200 : 404, available ? view : 'not-found');
  }

  const requestOptions = { requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 };
  const onRequest = (request, response) => {
    if (log) {
      const started = performance.now();
      response.once('finish', () => logEvent('http.request', {
        route: request.nriRoute ?? 'rejected', method: ['GET','HEAD','POST'].includes(request.method) ? request.method : 'OTHER',
        status: response.statusCode, durationMs: Math.round(performance.now() - started),
      }));
    }
    handle(request, response).catch((error) => {
      const code = String(error.code ?? error.name);
      logEvent('http.error', { route: request.nriRoute ?? 'rejected', code: /^[A-Z][A-Z0-9_]{0,40}$/.test(code) ? code : 'INTERNAL' });
      if (response.headersSent) response.destroy();
      else response.writeHead(500, { ...securityHeaders, 'Cache-Control': 'no-store' }).end();
    });
  };
  const app = tls
    ? createTlsServer({ ...requestOptions, cert:tls.cert, key:tls.key, minVersion:'TLSv1.2' }, onRequest)
    : createServer(requestOptions,onRequest);
  app.maxHeadersCount = 60;
  app.once('close', () => store.close());
  return app;
}

function assertPrivateFile(path) {
  if (process.platform === 'win32') return;
  const item = statSync(path);
  if (!item.isFile() || (item.mode & 0o077)) throw new Error('Use owner-only permissions for the workspace and private keys.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.NRI_PUBLIC_ORIGIN;
  const certPath = process.env.NRI_TLS_CERT_FILE;
  const keyPath = process.env.NRI_TLS_KEY_FILE;
  if ([origin,certPath,keyPath].some(Boolean) && ![origin,certPath,keyPath].every(Boolean)) {
    throw new Error('Set the HTTPS origin, certificate and key together.');
  }
  const databasePath = workspaceDatabasePath();
  if (origin) {
    assertPrivateFile(keyPath);
    for (const path of [databasePath,databasePath + '.key']) if (existsSync(path)) assertPrivateFile(path);
  }
  const tls = origin ? { origin, cert:readFileSync(certPath), key:readFileSync(keyPath) } : undefined;
  const port = Number(process.env.PORT ?? (tls ? 8443 : 3000));
  const host = process.env.HOST ?? '127.0.0.1';
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  const mode = process.env.NRI_ENTITLEMENT_MODE ?? (tls ? 'enforced' : 'staging');
  if (!['enforced', 'staging'].includes(mode) || (mode === 'staging' && !loopback)) {
    throw new Error('Staging entitlements require a loopback bind.');
  }
  if (!tls && !loopback) {
    throw new Error('An HTTPS configuration is required for a non-loopback host.');
  }
  const log = (event) => console.log(JSON.stringify(event));
  const app = createApp(openWorkspaceStore(databasePath), { tls,log,enforceEntitlements: mode === 'enforced' }).listen(port, host, () => {
    log({ time:new Date().toISOString(), event:'service.listening', transport:tls ? 'https' : 'http',
      port:app.address().port });
  });
  const shutdown = () => app.close();
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
}
