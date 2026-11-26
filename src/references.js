import { normalizeDoi } from './crossref.js';
import { referencePage } from './reference-view.js';
import { loginPath, projectReferencesPath, workspacePage } from './workspace-view.js';

const allowedProviders = ['crossref', 'openalex'];

export function resolveReferenceRoute(pathname) {
  if (pathname === '/workspace/reference-projects') return { kind: 'reference-projects' };
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/references$/);
  if (match) return { kind: 'references', id: match[1] };
}

export function createReferenceHandler(store, crossref, openalex) {
  const adapters = { crossref, openalex };
  return async function handle({ request, reply, redirect, route, lang, account, form, stillSignedIn }) {
    const { kind, id } = route;
    const owner = account.id;
    if (kind === 'reference-projects') {
      reply(200, referencePage(lang, { projects: store.listProjects(owner) }));
      return;
    }

    const project = store.getProject(owner, id);
    const missing = () => reply(404, workspacePage(lang, 'missing'));
    if (!project) {
      missing();
      return;
    }
    const show = (status, error, input, provider, headers) => reply(status, referencePage(lang, {
      id, project, error, input, provider, records: store.references.list(owner, id),
    }), headers);

    if (request.method !== 'POST') {
      show(200);
      return;
    }
    const input = (form.get('doi') ?? '').slice(0, 1101);
    const doi = normalizeDoi(input);
    if (!doi) {
      show(422, 'invalid', input, form.get('provider') ?? 'crossref');
      return;
    }
    const action = form.get('action') ?? 'check';
    const selectedProvider = allowedProviders.includes(form.get('provider')) ? form.get('provider') : 'crossref';

    if (action === 'remove') {
      store.references.remove(owner, id, doi, selectedProvider);
      redirect(projectReferencesPath(lang, id));
      return;
    }
    if (action !== 'check') {
      reply(400);
      return;
    }

    const adapter = adapters[selectedProvider];
    const cached = store.references.cached(owner, doi, selectedProvider);
    const result = cached ?? await adapter(doi);
    if (!stillSignedIn()) {
      redirect(loginPath(lang));
      return;
    }
    if (result.status === 'limited') {
      show(429, `limited-${selectedProvider}`, input, selectedProvider, { 'Retry-After': String(result.retryAfter) });
      return;
    }
    if (result.status === 'unavailable') {
      show(503, `unavailable-${selectedProvider}`, input, selectedProvider);
      return;
    }
    if (!store.references.save(owner, id, { ...result, doi, provider: selectedProvider }, !cached)) {
      missing();
      return;
    }
    redirect(projectReferencesPath(lang, id));
  };
}
