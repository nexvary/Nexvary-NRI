import { normalizeAddress, verifyPassword } from './password.js';
import { sessionLifetime } from './store.js';
import { loginPath, workspacePage, workspacePath } from './workspace-view.js';

const cookieName = 'nri_session';
const formLimit = 24 * 1024;
const loginWindow = 60_000;
const maxLoginAttempts = 12;
const maxConcurrentLogins = 2;

export function resolveWorkspaceRoute(pathname) {
  if (pathname === '/login') return { kind: 'login' };
  if (pathname === '/logout') return { kind: 'logout' };
  if (pathname === '/workspace') return { kind: 'index' };
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})(\/delete)?$/);
  if (match) return { kind: match[2] ? 'delete' : 'project', id: match[1] };
}

function acceptsPost(request) {
  const port = request.socket.localPort;
  const host = request.headers.host;
  const portSuffix = port === 80 ? '' : `:${port}`;
  const knownAuthority = ['127.0.0.1', '[::1]', 'localhost'].some(
    (hostname) => host === hostname + portSuffix,
  );
  return knownAuthority && request.headers.origin === `http://${host}`;
}

function readSessionCookie(header = '') {
  const value = header.match(/(?:^|;\s*)nri_session=([A-Za-z0-9_-]{43})(?:;|$)/);
  return value?.[1];
}

function sessionCookie(token, maxAge) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

async function readForm(request) {
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase()
    !== 'application/x-www-form-urlencoded') return { status: 415 };

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > formLimit) {
      request.resume();
      return { status: 413 };
    }
    chunks.push(chunk);
  }
  return { fields: new URLSearchParams(Buffer.concat(chunks).toString('utf8')) };
}

function projectFields(form) {
  return {
    title: (form.get('title') ?? '').trim(),
    description: (form.get('description') ?? '').trim(),
  };
}

export function createWorkspaceHandler(store) {
  let windowStarted = 0;
  let attempts = 0;
  let inFlight = 0;

  return async function handle({ request, reply, redirect, route, lang }) {
    const { kind, id } = route;
    const show = (status, pageKind, options, headers) => {
      reply(status, workspacePage(lang, pageKind, options), headers);
    };
    const postOnly = kind === 'delete' || kind === 'logout';
    const method = request.method;
    if ((!postOnly && !['GET', 'HEAD', 'POST'].includes(method)) || (postOnly && method !== 'POST')) {
      reply(405, null, { Allow: postOnly ? 'POST' : 'GET, HEAD, POST' });
      return;
    }

    const token = readSessionCookie(request.headers.cookie);
    let form;
    if (method === 'POST') {
      if (!acceptsPost(request)) {
        reply(403);
        return;
      }
      if (kind !== 'logout') {
        const { status, fields } = await readForm(request);
        if (status) {
          reply(status);
          return;
        }
        form = fields;
      }
    }
    const account = store.session(token);

    if (kind === 'login') {
      if (method !== 'POST') {
        if (account) redirect(workspacePath(lang));
        else show(200, 'login');
        return;
      }

      const now = Date.now();
      if (now - windowStarted >= loginWindow) {
        windowStarted = now;
        attempts = 0;
      }
      if (attempts >= maxLoginAttempts || inFlight >= maxConcurrentLogins) {
        show(429, 'login', { error: 'rateLimit' }, { 'Retry-After': String(Math.ceil((windowStarted + loginWindow - now) / 1000)) });
        return;
      }
      attempts++;
      inFlight++;
      try {
        const email = normalizeAddress(form.get('email') ?? '');
        const password = form.get('password') ?? '';
        const credentials = email ? store.credentials(email) : undefined;
        const valid = await verifyPassword(password.slice(0, 128), credentials);
        if (!valid || password.length > 128) {
          show(401, 'login', { error: 'credentials' });
          return;
        }
        const session = store.newSession(credentials.id);
        store.revokeSession(token);
        redirect(workspacePath(lang), { 'Set-Cookie': sessionCookie(session, sessionLifetime) });
      } finally {
        inFlight--;
      }
      return;
    }

    if (!account) {
      redirect(loginPath(lang));
      return;
    }
    if (kind === 'logout') {
      store.revokeSession(token);
      redirect(loginPath(lang), { 'Set-Cookie': sessionCookie('', 0) });
      return;
    }

    const project = id ? store.getProject(account.id, id) : undefined;
    if (id && !project) {
      show(404, 'missing');
      return;
    }
    if (method !== 'POST') {
      if (id) show(200, 'project', { id, values: project });
      else show(200, 'index', { account, projects: store.listProjects(account.id) });
      return;
    }
    if (kind === 'delete') {
      if (form.get('confirm') !== 'yes') {
        reply(400);
        return;
      }
      if (!store.deleteProject(account.id, id)) show(404, 'missing');
      else redirect(workspacePath(lang));
      return;
    }

    const values = projectFields(form);
    if (!values.title || values.title.length > 120 || values.description.length > 2000) {
      const error = 'invalid';
      if (id) show(422, 'project', { id, values, error });
      else show(422, 'index', { account, projects: store.listProjects(account.id), values, error });
      return;
    }
    if (id) {
      if (!store.updateProject(account.id, id, values)) show(404, 'missing');
      else redirect(workspacePath(lang, id));
      return;
    }
    redirect(workspacePath(lang, store.createProject(account.id, values)));
  };
}
