import { createLoginThrottle } from './login-throttle.js';
import { createResourceHandler, resolveResourceRoute } from './resource-sharing.js';
import { handleCitations, resolveCitationRoute } from './citations.js';
import { handleOrganization, resolveOrganizationRoute } from './library-organization.js';
import { handleTeamWork } from './team-work.js';
import { handleLicensing } from './licensing.js';
import { handleTeam, resolveTeamRoute } from './teams.js';
import { createPrivacyHandler } from './privacy.js';
import { handleMessageModeration } from './moderation.js';
import { createMfaSettingsHandler } from './mfa-settings.js';
import { handleMessages, resolveMessageRoute } from './messages.js';
import { createAssistantAnswerHandler } from './assistant-answer.js';
import { handleAssistantSettings } from './assistant-settings.js';
import { showAssistant } from './assistant.js';
import { createDocumentHandler, resolveDocumentRoute } from './documents.js';
import { createEducationHandler } from './education.js';
import { createSharingHandler, resolveSharingRoute } from './sharing.js';
import { settingsPage } from './settings.js';
import { createReportHandler, resolveReportRoute } from './reports.js';
import { createObservatoryHandler, resolveObservatoryRoute } from './observatory.js';
import { handleAnalytics } from './analytics.js';
import { createNetworkHandler } from './network.js';
import { libraryPage } from './library.js';
import { createEconomicsHandler, resolveEconomicsRoute } from './economics.js';
import { createReadinessHandler, resolveReadinessRoute } from './readiness.js';
import { createEvidenceHandler, resolveEvidenceRoute } from './evidence.js';
import { createReferenceHandler, resolveReferenceRoute } from './references.js';
import { readBoundedBody } from './request-body.js';
import { normalizeAddress, verifyPassword } from './password.js';
import { sessionLifetime } from './store.js';
import { loginPath, workspacePage, workspacePath } from './workspace-view.js';

const cookieName = 'nri_session';
const formLimit = 24 * 1024;

export function resolveWorkspaceRoute(pathname) {
  if (pathname === '/login') return { kind: 'login' };
  if (pathname === '/logout') return { kind: 'logout' };
  if (pathname === '/workspace/assistant/answer') return { kind: 'assistant-answer' };
  if (pathname === '/workspace/assistant/settings') return { kind: 'assistant-settings' };
  if (pathname === '/workspace/assistant') return { kind: 'assistant' };
  if (pathname === '/workspace/education') return { kind: 'education' };
  if (pathname === '/workspace/settings/message-moderation') return { kind: 'settings-message-moderation' };
  if (pathname === '/workspace/settings/licensing') return { kind: 'settings-licensing' };
  if (pathname === '/workspace/settings/privacy') return { kind: 'settings-privacy' };
  if (pathname === '/workspace/settings/mfa') return { kind: 'settings-mfa' };
  if (pathname === '/workspace/settings') return { kind: 'settings' };
  if (pathname === '/workspace/analytics') return { kind: 'analytics' };
  if (pathname === '/workspace/network') return { kind: 'network' };
  if (pathname === '/workspace/collaboration') return { kind: 'collaboration' };
  if (pathname === '/workspace/library') return { kind: 'library' };
  if (pathname === '/workspace') return { kind: 'index' };
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})(\/delete)?$/);
  if (match) return { kind: match[2] ? 'delete' : 'project', id: match[1] };
  return resolveResourceRoute(pathname) ?? resolveCitationRoute(pathname) ?? resolveOrganizationRoute(pathname) ?? resolveTeamRoute(pathname) ?? resolveMessageRoute(pathname) ?? resolveDocumentRoute(pathname) ?? resolveReferenceRoute(pathname) ?? resolveEvidenceRoute(pathname) ?? resolveReadinessRoute(pathname) ?? resolveEconomicsRoute(pathname) ?? resolveObservatoryRoute(pathname) ?? resolveReportRoute(pathname) ?? resolveSharingRoute(pathname);
}

function acceptsPost(request, origin) {
  if (origin) return request.headers.origin === origin;
  const port = request.socket.localPort;
  const host = request.headers.host;
  const portSuffix = port === 80 ? '' : `:${port}`;
  const knownAuthority = ['127.0.0.1', '[::1]', 'localhost'].some(
    (hostname) => host === hostname + portSuffix,
  );
  return knownAuthority && request.headers.origin === `http://${host}`;
}

export function readSessionCookie(header = '', secure = false) {
  const name = (secure ? '__Host-' : '') + cookieName + '=';
  const matches = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(name));
  const value = matches.length === 1 ? matches[0].slice(name.length) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

function sessionCookie(token, maxAge, secure) {
  const name = (secure ? '__Host-' : '') + cookieName;
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function readForm(request, limit = formLimit) {
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase()
    !== 'application/x-www-form-urlencoded') return { status: 415 };

  const body = await readBoundedBody(request, limit);
  return body ? { fields: new URLSearchParams(body.toString('utf8')) } : { status: 413 };
}

function projectFields(form) {
  return {
    title: (form.get('title') ?? '').trim(),
    description: (form.get('description') ?? '').trim(),
  };
}

export function createWorkspaceHandler(store, providers, version, reportRenderer, assistantProvider, origin) {
  const handlePrivacy = createPrivacyHandler(store);
  const handleMfaSettings = createMfaSettingsHandler(store);
  const handleAssistantAnswer = createAssistantAnswerHandler(store, assistantProvider);
  const handleDocuments = createDocumentHandler(store);
  const handleNetwork = createNetworkHandler(store);
  const handleObservatory = createObservatoryHandler(store);
  const handleResources = createResourceHandler(store, version, reportRenderer);
  const handleReports = createReportHandler(store, version, reportRenderer);
  const handleSharing = createSharingHandler(store);
  const handleEducation = createEducationHandler(store);
  const handleEconomics = createEconomicsHandler(store);
  const handleReadiness = createReadinessHandler(store);
  const handleEvidence = createEvidenceHandler(store);
  const handleReferences = createReferenceHandler(store, providers);
  const throttle = createLoginThrottle();

  return async function handle({ request, reply, redirect, route, lang }) {
    const { kind, id } = route;
    const show = (status, pageKind, options, headers) => {
      reply(status, workspacePage(lang, pageKind, options), headers);
    };
    const postOnly = kind === 'delete' || kind === 'logout' || kind === 'delete-document';
    const allowed = postOnly ? ['POST'] : ['GET', 'HEAD'];
    if (!postOnly && !['download-document', 'preview-document', 'reference-projects', 'evidence-projects', 'evidence-export', 'readiness-projects', 'economics-projects', 'economics-export', 'library', 'report-projects', 'sharing-project', 'assistant'].includes(kind)) allowed.push('POST');
    const method = request.method;
    if (!allowed.includes(method)) {
      reply(405, null, { Allow: allowed.join(', ') });
      return;
    }

    const token = readSessionCookie(request.headers.cookie, Boolean(origin));
    let form;
    if (method === 'POST') {
      if (!acceptsPost(request, origin)) {
        reply(403);
        return;
      }
      if (!['logout', 'documents', 'document', 'analytics'].includes(kind)) {
        const { status, fields } = await readForm(request, kind === 'citations' ? 1024 * 1024 : kind === 'team-project' ? 160 * 1024 : formLimit);
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

      const email = normalizeAddress(form.get('email') ?? '');
      const retryAfter = throttle.begin(request.socket.remoteAddress ?? '',email);
      if (retryAfter) {
        show(429, 'login', { error: 'rateLimit' }, { 'Retry-After': String(retryAfter) });
        return;
      }
      try {
        const password = form.get('password') ?? '';
        const credentials = email ? store.credentials(email) : undefined;
        const valid = await verifyPassword(password.slice(0, 128), credentials);
        const code = (form.get('mfa-code') ?? '').slice(0, 32);
        if (!valid || password.length > 128 ||
          (store.mfa.enabled(credentials.id) && !store.mfa.verify(credentials.id, code))) {
          show(401, 'login', { error: 'credentials' });
          return;
        }
        const session = store.signIn(credentials, token);
        if (!session) {
          show(401, 'login', { error: 'credentials' });
          return;
        }
        redirect(workspacePath(lang), { 'Set-Cookie': sessionCookie(session, sessionLifetime, Boolean(origin)) });
      } finally {
        throttle.finish();
      }
      return;
    }

    if (!account) {
      redirect(loginPath(lang));
      return;
    }
    if (kind === 'logout') {
      store.signOut(account.id, token);
      redirect(loginPath(lang), { 'Set-Cookie': sessionCookie('', 0, Boolean(origin)) });
      return;
    }

    if (kind.startsWith('messages')) {
      handleMessages({ request, reply, redirect, route, lang, account, form, store });
      return;
    }
    if (kind === 'assistant-answer') {
      await handleAssistantAnswer({ request, reply, lang, form, account, stillSignedIn: () => store.session(token)?.id === account.id });
      return;
    }
    if (kind === 'assistant-settings') {
      handleAssistantSettings({ reply, redirect, lang, form, store, account });
      return;
    }
    if (kind === 'assistant') {
      showAssistant({ reply, request, lang, store, account });
      return;
    }
    if (kind === 'education') {
      handleEducation({ request, reply, lang, account, form });
      return;
    }
    if (kind === 'shared-resources') {
      await handleResources({ request,reply,redirect,route,lang,account,form,stillSignedIn: () => store.session(token)?.id === account.id });
      return;
    }
    if (kind === 'team-work') {
      handleTeamWork({ request, reply, redirect, route, lang, account, form, store });
      return;
    }
    if (kind.startsWith('team')) {
      handleTeam({ request, reply, redirect, route, lang, account, form, store });
      return;
    }
    if (kind.startsWith('sharing')) {
      handleSharing({ request, reply, redirect, route, lang, account, form });
      return;
    }
    if (kind === 'settings-message-moderation') {
      handleMessageModeration({ request, reply, redirect, lang, account, form, store });
      return;
    }
    if (kind === 'settings-licensing') {
      await handleLicensing({ request, reply, redirect, lang, account, token, form, store });
      return;
    }
    if (kind === 'settings-privacy') {
      await handlePrivacy({ reply, redirect, lang, account, form, token, expiredCookie: sessionCookie('', 0, Boolean(origin)) });
      return;
    }
    if (kind === 'settings-mfa') {
      await handleMfaSettings({ reply, redirect, lang, account, token, form });
      return;
    }
    if (kind === 'settings') {
      if (method === 'POST') {
        if (form.get('intent') !== 'revoke-others') {
          reply(422);
          return;
        }
        store.revokeOtherSessions(account.id, token);
        redirect(`/workspace/settings?lang=${lang}`);
        return;
      }
      reply(200, settingsPage(store, lang, account, token));
      return;
    }

    if (kind.startsWith('report')) {
      await handleReports({ request, reply, route, lang, account, form, stillSignedIn: () => store.session(token)?.id === account.id });
      return;
    }
    if (kind.startsWith('observatory')) {
      handleObservatory({ request, reply, redirect, route, lang, account, form });
      return;
    }
    if (kind === 'analytics') {
      await handleAnalytics({ request, reply, lang, stillSignedIn: () => store.session(token)?.id === account.id });
      return;
    }
    if (kind === 'network' || kind === 'collaboration') {
      handleNetwork({ request, reply, redirect, route, lang, account, form });
      return;
    }
    if (kind === 'citations') {
      handleCitations({request,reply,redirect,route,lang,account,form,store});
      return;
    }
    if (kind.startsWith('library-')) {
      handleOrganization({ request, reply, redirect, route, lang, account, form, store });
      return;
    }
    if (kind === 'library') {
      reply(200, libraryPage(lang, new URL('http://localhost' + request.url), store, account.id));
      return;
    }
    if (kind.startsWith('economics')) {
      handleEconomics({ request, reply, redirect, route, lang, account, form });
      return;
    }

    if (kind.startsWith('readiness')) {
      handleReadiness({ request, reply, redirect, route, lang, account, form });
      return;
    }

    if (kind.startsWith('evidence')) {
      handleEvidence({ request, reply, redirect, route, lang, account, form });
      return;
    }

    const stillSignedIn = () => store.session(token)?.id === account.id;
    if (['references', 'reference-projects'].includes(kind)) {
      await handleReferences({ request, reply, redirect, route, lang, account, form, stillSignedIn });
      return;
    }

    if (['documents', 'document', 'delete-document', 'download-document', 'preview-document'].includes(kind)) {
      if (kind === 'delete-document' && form.get('confirm') !== 'yes') {
        reply(400);
        return;
      }
      await handleDocuments({
        request, reply, redirect, route, lang, account,
        stillSignedIn,
      });
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
    const created = store.createProject(account.id, values);
    if (!created) {
      show(429, 'index', { account, projects: store.listProjects(account.id), values, error: 'projectLimit' });
      return;
    }
    redirect(workspacePath(lang, created));
  };
}
