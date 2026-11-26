import { readBoundedBody } from './request-body.js';
import { documentsPath, workspacePage } from './workspace-view.js';

const maxFileSize = 8 * 1024 * 1024;
const maxUploadBody = maxFileSize + 64 * 1024;

export function resolveDocumentRoute(pathname) {
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/documents(?:\/([0-9a-f-]{36})(?:(\/delete)|\/versions\/([1-9][0-9]{0,14}))?)?$/);
  if (!match) return;
  const [, id, documentId, deleting, number] = match;
  if (deleting) return { kind: 'delete-document', id, documentId };
  if (number) return { kind: 'download-document', id, documentId, number: Number(number) };
  return { kind: documentId ? 'document' : 'documents', id, documentId };
}

async function readPdf(request) {
  const type = request.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type)) return { status: 415, error: 'invalidPdf' };
  const body = await readBoundedBody(request, maxUploadBody);
  if (!body) return { status: 413, error: 'largePdf' };
  let form;
  try {
    form = await new Response(body, { headers: { 'Content-Type': type } }).formData();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { status: 400, error: 'invalidPdf' };
  }
  const candidates = form.getAll('pdf');
  const file = candidates[0];
  if (candidates.length !== 1 || !(file instanceof File)) return { status: 422, error: 'invalidPdf' };
  if (file.size > maxFileSize) return { status: 413, error: 'largePdf' };
  const name = file.name.normalize('NFC').trim();
  if (name.length > 180 || !/\.pdf$/iu.test(name) || /[\/\\\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name)) {
    return { status: 422, error: 'invalidPdf' };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const header = bytes.subarray(0, 10).toString('latin1');
  const ending = bytes.subarray(-1024).toString('latin1');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header) || !/%%EOF[\r\n\t ]*$/.test(ending)) {
    return { status: 422, error: 'invalidPdf' };
  }
  return { file: { name, bytes } };
}

function disposition(name, version) {
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (character) => (
    '%' + character.charCodeAt(0).toString(16).toUpperCase()
  ));
  return `attachment; filename="document-v${version}.pdf"; filename*=UTF-8''${encoded}`;
}

export function createDocumentHandler(store) {
  let uploads = 0;

  return async function handle({ request, reply, redirect, route, lang, account, stillSignedIn }) {
    const { kind, id, documentId, number } = route;
    const project = store.getProject(account.id, id);
    const document = documentId ? store.documents.get(account.id, id, documentId) : undefined;
    const missing = () => reply(404, workspacePage(lang, 'missing'));
    if (!project || (documentId && !document)) {
      missing();
      return;
    }

    if (kind === 'download-document') {
      const file = store.documents.download(account.id, id, documentId, number);
      if (!file) {
        missing();
        return;
      }
      reply(200, null, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition(file.name, number),
        'Content-Length': file.bytes.length,
      }, file.bytes);
      return;
    }

    const show = (status, error) => {
      const data = documentId
        ? { document, versions: store.documents.versions(account.id, id, documentId) }
        : { documents: store.documents.list(account.id, id) };
      reply(status, workspacePage(lang, kind, { id, project, documentId, error, ...data }));
    };

    if (request.method !== 'POST') {
      show(200);
      return;
    }
    if (kind === 'delete-document') {
      // The workspace handler validates and supplies confirmation before dispatching this action.
      if (store.documents.delete(account.id, id, documentId)) redirect(documentsPath(lang, id));
      else missing();
      return;
    }
    if (uploads >= 2) {
      show(429, 'uploadBusy');
      return;
    }
    uploads++;
    try {
      const { status, file, error } = await readPdf(request);
      if (!stillSignedIn()) {
        redirect(`/login?lang=${lang}`);
        return;
      }
      if (status) {
        show(status, error);
        return;
      }
      const uploaded = documentId
        ? (store.documents.append(account.id, id, documentId, file) && documentId)
        : store.documents.create(account.id, id, file);
      if (uploaded) redirect(documentsPath(lang, id, uploaded));
      else missing();
    } finally {
      uploads--;
    }
  };
}
