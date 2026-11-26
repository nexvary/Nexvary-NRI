import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createCrossrefClient } from './crossref.js';
import { createOpenAlexClient } from './openalex.js';
import { createOrcidClient, createZenodoClient } from './public-identifiers.js';
import { createLocalReportRenderer } from './reports.js';
import { modules } from './content.js';
import { render } from './render.js';
import { openWorkspaceStore, workspaceDatabasePath } from './store.js';
import { createWorkspaceHandler, readSessionCookie, resolveWorkspaceRoute } from './workspace.js';
import { referenceProjectsPath, workspacePath } from './workspace-view.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const stylesheet = readFileSync(new URL('../public/styles.css', import.meta.url));
const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export function createApp(store = openWorkspaceStore(), {
  crossref = createCrossrefClient(),
  openalex = createOpenAlexClient(),
  orcid = createOrcidClient(),
  zenodo = createZenodoClient(),
  reportRenderer = createLocalReportRenderer(),
} = {}) {
  const workspace = createWorkspaceHandler(store, { crossref, openalex, orcid, zenodo }, version, reportRenderer);

  async function handle(request, response) {
    if (!request.url?.startsWith('/')) {
      response.writeHead(400, securityHeaders).end();
      return;
    }
    const { pathname, searchParams } = new URL(`http://localhost${request.url}`);
    const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
    const route = resolveWorkspaceRoute(pathname);

    const redirect = (location, headers) => {
      response.writeHead(303, { ...securityHeaders, 'Cache-Control': 'no-store', Location: location, ...headers }).end();
    };

    const sendPage = (status, view, page, headers, dashboard) => {
      const answer = request.method === 'HEAD' ? undefined : render({ lang, view, version, page, workspace: dashboard });
      response.writeHead(status, {
        ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': lang, ...headers,
      }).end(answer);
    };

    if (route) {
      const section = { reference: 'references', evidence: 'evidence', readiness: 'l-ready', economics: 'economics', library: 'library', network: 'network', collaboration: 'collaboration', analytics: 'analytics', observatory: 'observatory', report: 'reports', settings: 'settings' };
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

    const view = searchParams.get('view') ?? 'dashboard';
    if (pathname === '/' && view === 'research') {
      redirect(workspacePath(lang));
      return;
    }
    if (pathname === '/' && view === 'dashboard') {
      const session = store.session(readSessionCookie(request.headers.cookie));
      sendPage(200, view, undefined, { 'Cache-Control': 'no-store' }, session ? store.library.dashboard(session.id) : undefined);
      return;
    }
    if (pathname === '/' && view === 'reports') {
      redirect(`/workspace/report-projects?lang=${lang}`);
      return;
    }
    if (pathname === '/' && ['network', 'collaboration', 'analytics', 'observatory', 'settings'].includes(view)) {
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

  const app = createServer({ requestTimeout: 15_000 }, (request, response) => {
    handle(request, response).catch((error) => {
      console.error('NRI HTTP request failed:', error.code ?? error.name);
      if (response.headersSent) response.destroy();
      else response.writeHead(500, { ...securityHeaders, 'Cache-Control': 'no-store' }).end();
    });
  });
  app.once('close', () => store.close());
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('The private workspace preview requires a loopback host.');
  }
  const app = createApp(openWorkspaceStore(workspaceDatabasePath())).listen(port, host, () => {
    const { address, port: selectedPort } = app.address();
    const displayAddress = address.includes(':') ? `[${address}]` : address;
    console.log(`NRI preview: http://${displayAddress}:${selectedPort}`);
  });
}
