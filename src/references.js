import { normalizeDoi } from './crossref.js';
import { normalizeOrcid, normalizeZenodoDoi } from './public-identifiers.js';
import { referencePage } from './reference-view.js';
import { loginPath, projectReferencesPath, workspacePage } from './workspace-view.js';

const normalize = { crossref: normalizeDoi, openalex: normalizeDoi, orcid: normalizeOrcid, zenodo: normalizeZenodoDoi };

export function resolveReferenceRoute(pathname) {
  if (pathname === '/workspace/reference-projects') return { kind: 'reference-projects' };
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/references$/);
  if (match) return { kind: 'references', id: match[1] };
}

export function createReferenceHandler(store, adapters) {
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
    const provider = form.get('provider') ?? 'crossref';
    if (!Object.hasOwn(normalize, provider)) {
      reply(400);
      return;
    }
    const doi = normalize[provider](input);
    if (!doi) {
      const error = provider === 'crossref' || provider === 'openalex' ? 'invalid' : 'invalid-' + provider;
      show(422, error, input, provider);
      return;
    }
    const action = form.get('action') ?? 'check';

    if (action === 'remove') {
      store.references.remove(owner, id, doi, provider);
      redirect(projectReferencesPath(lang, id));
      return;
    }
    if (action !== 'check') {
      reply(400);
      return;
    }

    const adapter = adapters[provider];
    const cached = store.references.cached(owner, doi, provider);
    const result = cached ?? await adapter(doi);
    if (!stillSignedIn()) {
      redirect(loginPath(lang));
      return;
    }
    if (result.status === 'limited') {
      show(429, `limited-${provider}`, input, provider, { 'Retry-After': String(result.retryAfter) });
      return;
    }
    if (result.status === 'unavailable') {
      show(503, `unavailable-${provider}`, input, provider);
      return;
    }
    if (!store.references.save(owner, id, { ...result, doi, provider: provider }, !cached)) {
      missing();
      return;
    }
    redirect(projectReferencesPath(lang, id));
  };
}
