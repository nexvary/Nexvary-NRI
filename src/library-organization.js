import { randomUUID } from 'node:crypto';
import { documentsPath, escapeHtml } from './workspace-view.js';

export const organizationSchema = `
  CREATE TABLE IF NOT EXISTS library_collections (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, UNIQUE(owner_id, name)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS collection_documents (
    collection_id TEXT NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY(collection_id, document_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS collection_documents_document ON collection_documents(document_id);
  CREATE TABLE IF NOT EXISTS document_marks (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version INTEGER NOT NULL, page INTEGER NOT NULL CHECK(page > 0),
    kind TEXT NOT NULL CHECK(kind IN ('bookmark','annotation')),
    text TEXT NOT NULL, recorded_at INTEGER NOT NULL,
    FOREIGN KEY(document_id, version) REFERENCES document_versions(document_id, number) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS document_marks_document ON document_marks(document_id, recorded_at DESC, id);
  PRAGMA user_version = 22;
`;

export const folderSchema = `
  CREATE TABLE IF NOT EXISTS library_folders (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, UNIQUE(owner_id, name)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS folder_documents (
    folder_id TEXT NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY(folder_id, document_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS folder_documents_document ON folder_documents(document_id);
  PRAGMA user_version = 42;
`;

export function organizationStore(db, now, transact) {
  const collections = db.prepare(`SELECT c.id,c.name,count(d.document_id) AS total
    FROM library_collections c LEFT JOIN collection_documents d ON d.collection_id=c.id
    WHERE c.owner_id=? GROUP BY c.id ORDER BY c.name,c.id LIMIT 51 OFFSET ?`);
  const collection = db.prepare('SELECT id,name FROM library_collections WHERE owner_id=? AND id=?');
  const create = db.prepare('INSERT OR IGNORE INTO library_collections VALUES (?,?,?)');
  const remove = db.prepare('DELETE FROM library_collections WHERE owner_id=? AND id=?');
  const documents = db.prepare(`SELECT d.id,d.title,d.project_id FROM collection_documents link
    JOIN documents d ON d.id=link.document_id JOIN projects p ON p.id=d.project_id
    WHERE p.owner_id=? AND link.collection_id=? ORDER BY d.title,d.id LIMIT 51 OFFSET ?`);
  const ownerDocument = db.prepare(`SELECT d.id,d.title FROM documents d JOIN projects p ON p.id=d.project_id
    WHERE p.owner_id=? AND p.id=? AND d.id=?`);
  const attach = db.prepare('INSERT OR IGNORE INTO collection_documents VALUES (?,?)');
  const detach = db.prepare('DELETE FROM collection_documents WHERE collection_id=? AND document_id=?');
  const memberships = db.prepare(`SELECT c.id,c.name,EXISTS(SELECT 1 FROM collection_documents d
    WHERE d.collection_id=c.id AND d.document_id=?) AS linked FROM library_collections c
    WHERE c.owner_id=? ORDER BY linked DESC,c.name,c.id LIMIT 100`);
  const marks = db.prepare('SELECT * FROM document_marks WHERE document_id=? ORDER BY recorded_at DESC,id LIMIT 51 OFFSET ?');
  const knownVersion = db.prepare('SELECT 1 FROM document_versions WHERE document_id=? AND number=?');
  const insertMark = db.prepare('INSERT INTO document_marks VALUES (?,?,?,?,?,?,?)');
  const removeMark = db.prepare('DELETE FROM document_marks WHERE document_id=? AND id=?');
  const count = db.prepare('SELECT count(*) AS total FROM library_collections WHERE owner_id=?');
  const folders = db.prepare(`SELECT f.id,f.name,count(d.document_id) AS total FROM library_folders f
    LEFT JOIN folder_documents d ON d.folder_id=f.id WHERE f.owner_id=? GROUP BY f.id ORDER BY f.name,f.id LIMIT 101`);
  const folder = db.prepare('SELECT id,name FROM library_folders WHERE owner_id=? AND id=?');
  const createFolder = db.prepare('INSERT OR IGNORE INTO library_folders VALUES (?,?,?)');
  const removeFolder = db.prepare('DELETE FROM library_folders WHERE owner_id=? AND id=?');
  const folderCount = db.prepare('SELECT count(*) AS total FROM library_folders WHERE owner_id=?');
  const folderMemberships = db.prepare(`SELECT f.id,f.name,EXISTS(SELECT 1 FROM folder_documents d
    WHERE d.folder_id=f.id AND d.document_id=?) AS linked FROM library_folders f
    WHERE f.owner_id=? ORDER BY linked DESC,f.name,f.id LIMIT 100`);
  const addToFolder = db.prepare('INSERT OR IGNORE INTO folder_documents VALUES (?,?)');
  const removeFromFolder = db.prepare('DELETE FROM folder_documents WHERE folder_id=? AND document_id=?');
  return {
    list: (owner, offset) => collections.all(owner, offset),
    folders: (owner) => folders.all(owner),
    createFolder(owner, name) {
      return transact(db, () => {
        if (!name || name.length > 100 || folderCount.get(owner).total >= 100) return undefined;
        const id = randomUUID();
        return createFolder.run(id, owner, name).changes ? id : undefined;
      });
    },
    removeFolder: (owner, id) => Boolean(removeFolder.run(owner, id).changes),
    collection(owner, id, offset) {
      const item = collection.get(owner, id);
      return item && { ...item, documents: documents.all(owner, id, offset) };
    },
    create(owner, name) {
      return transact(db, () => {
        if (!name || name.length > 100 || count.get(owner).total >= 100) return undefined;
        const id = randomUUID();
        return create.run(id, owner, name).changes ? id : undefined;
      });
    },
    remove: (owner, id) => Boolean(remove.run(owner, id).changes),
    reading(owner, project, document, offset) {
      const entry = ownerDocument.get(owner, project, document);
      return entry && { ...entry, marks: marks.all(document, offset), collections: memberships.all(document, owner), folders: folderMemberships.all(document, owner) };
    },
    membership(owner, project, document, id, add) {
      return transact(db, () => {
        if (!ownerDocument.get(owner, project, document) || !collection.get(owner, id)) return false;
        return Boolean((add ? attach : detach).run(id, document).changes);
      });
    },
    folderMembership(owner, project, document, id, add) {
      return transact(db, () => {
        if (!ownerDocument.get(owner, project, document) || !folder.get(owner, id)) return false;
        return Boolean((add ? addToFolder : removeFromFolder).run(id, document).changes);
      });
    },
    addMark(owner, project, document, { version, page, kind, text }) {
      return transact(db, () => {
        if (!ownerDocument.get(owner, project, document) || !knownVersion.get(document, version)) return false;
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !['annotation','bookmark'].includes(kind) ||
            (kind === 'annotation' && !text) || text.length > 2000) return false;
        return Boolean(insertMark.run(randomUUID(), document, version, page, kind, text, now()).changes);
      });
    },
    removeMark(owner, project, document, mark) {
      return transact(db, () => Boolean(ownerDocument.get(owner, project, document) && removeMark.run(document, mark).changes));
    },
  };
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const index = '/workspace/library/collections';
const foldersIndex = '/workspace/library/folders';
const readingPath = (project, document) => `/workspace/projects/${project}/documents/${document}/reading`;
export function resolveOrganizationRoute(path) {
  if (path === index) return { kind: 'library-collections' };
  if (path === foldersIndex) return { kind: 'library-folders' };
  const match = path.match(/^\/workspace\/projects\/([a-f0-9-]{36})\/documents\/([a-f0-9-]{36})\/reading$/);
  if (match && uuid.test(match[1]) && uuid.test(match[2])) return { kind: 'library-reading', id: match[1], document: match[2] };
}

export function handleOrganization({ request, reply, redirect, route, lang, account, form, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const owner = account.id;
  const library = store.organization;
  const params = new URL(request.url, 'http://localhost').searchParams;
  const rawOffset = params.get('offset') ?? '';
  const offset = /^\d{1,8}$/.test(rawOffset) ? Number(rawOffset) : 0;
  const { id, document } = route;
  const path = id ? readingPath(id,document) : route.kind === 'library-folders' ? foldersIndex : index;
  const base = path + '?lang=' + lang;
  const intent = form?.get('intent');
  const button = (value, label) => `<button name="intent" value="${value}" class="action">${label}</button>`;
  const hidden = (name, value) => `<input name="${name}" type="hidden" value="${value}">`;
  const pagination = (items, suffix = '') => offset || items.length > 50 ? `<nav class="project-tools">
    ${offset ? `<a href="${base}${suffix}&amp;offset=${Math.max(0,offset - 50)}">${t('Previous', 'السابق')}</a>` : ''}
    ${items.length > 50 ? `<a href="${base}${suffix}&amp;offset=${offset + 50}">${t('Next', 'التالي')}</a>` : ''}</nav>` : '';
  const page = (title, body, headers) => reply(200, { title, path, html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>${body}</section>` }, headers);
  if (route.kind === 'library-folders') {
    const folderPath = foldersIndex + '?lang=' + lang;
    if (form) {
      if (intent === 'create') {
        const created = library.createFolder(owner, (form.get('name') ?? '').trim());
        return created ? redirect(folderPath) : reply(422);
      }
      const target = form.get('folder') ?? '';
      return intent === 'remove' && uuid.test(target) && library.removeFolder(owner,target) ? redirect(folderPath) : reply(404);
    }
    const records = library.folders(owner);
    return page(t('Library folders', 'مجلدات المكتبة'), `<nav class="project-tools"><a href="${index}?lang=${lang}">${t('Collections', 'المجموعات')}</a>
      <a href="/workspace/library?lang=${lang}">${t('Scientific library', 'المكتبة العلمية')}</a></nav>
      <form class="workspace-form" method="post" action="${folderPath}">${hidden('intent','create')}
        <label>${t('Folder name', 'اسم المجلد')}<input name="name" required maxlength="100" dir="auto"></label>${button('create',t('Create folder','أنشئ مجلدًا'))}</form>
      <ul class="project-list">${records.map((item) => `<li><bdi>${escapeHtml(item.name)}</bdi> · ${item.total}
        <form class="project-tools" method="post" action="${folderPath}">${hidden('folder',item.id)}${button('remove',t('Remove folder','احذف المجلد'))}</form></li>`).join('')}</ul>`);
  }
  if (!id) {
    const selected = params.get('collection') ?? '';
    const item = selected ? library.collection(owner, selected, offset) : undefined;
    if (selected && !item) return reply(404);
    if (form) {
      if (intent === 'create') {
        const created = library.create(owner, (form.get('name') ?? '').trim());
        return created ? redirect(base + '&collection=' + created) : reply(422);
      }
      const target = form.get('collection') ?? '';
      return intent === 'remove' && uuid.test(target) && library.remove(owner,target) ? redirect(base) : reply(404);
    }
    const records = item ? item.documents : library.list(owner,offset);
    return page(t('Library collections', 'مجموعات المكتبة'), `
      <p><a href="/workspace/library?lang=${lang}">${t('Scientific library', 'المكتبة العلمية')}</a></p>
      ${item ? `<h2 dir="auto">${escapeHtml(item.name)}</h2><a href="${base}">${t('All collections', 'كل المجموعات')}</a>
      ${records.length ? `<ul class="project-list">${records.slice(0,50).map((entry) => `<li><a href="${readingPath(entry.project_id,entry.id)}?lang=${lang}"><bdi>${escapeHtml(entry.title)}</bdi></a></li>`).join('')}</ul>` :
        `<p>${t('Add a PDF from its reading notes page.', 'أضف ملف PDF من صفحة ملاحظات القراءة الخاصة به.')}</p>`}
      ${pagination(records,'&amp;collection=' + item.id)}
      <form class="project-tools" method="post" action="${base}">${hidden('collection',item.id)}${button('remove', t('Remove collection', 'احذف المجموعة'))}</form>` :
      `<form class="workspace-form" method="post" action="${base}">
      <label>${t('Collection name', 'اسم المجموعة')}<input name="name" required maxlength="100" dir="auto"></label>${button('create',t('Create collection','أنشئ مجموعة'))}</form>
      <ul class="project-list">${records.slice(0,50).map((entry) => `<li><a href="${base}&amp;collection=${entry.id}"><bdi>${escapeHtml(entry.name)}</bdi> · ${entry.total}</a></li>`).join('')}</ul>
      ${pagination(records)}`}`);
  }
  const entry = library.reading(owner,id,document,offset);
  if (!entry || /\.(?:txt|docx)$/iu.test(entry.title)) return reply(404);
  if (form) {
    let saved = false;
    if (intent === 'link' || intent === 'unlink') saved = library.membership(owner,id,document,form.get('collection'),intent === 'link');
    else if (intent === 'folder-link' || intent === 'folder-unlink') saved = library.folderMembership(owner,id,document,form.get('folder'),intent === 'folder-link');
    else if (intent === 'delete-mark') saved = library.removeMark(owner,id,document,form.get('mark'));
    else if (intent === 'add-mark') saved = library.addMark(owner,id,document,{
      version: Number(form.get('version')), page: Number(form.get('page')), kind: form.get('kind'), text: (form.get('text') ?? '').trim(),
    });
    return saved ? redirect(base) : reply(422);
  }
  const versions = store.documents.versions(owner,id,document);
  const requestedVersion = Number(params.get('version')) || versions[0]?.number;
  if (!versions.some((version) => version.number === requestedVersion)) return reply(404);
  const requestedPage = Math.max(1, Math.min(100000, Math.trunc(Number(params.get('page')) || 1)));
  const download = (version) => path.replace(/\/reading$/,'') + '/versions/' + version + '?lang=' + lang;
  const marker = (kind) => kind === 'bookmark' ? t('Bookmark', 'إشارة مرجعية') : t('Annotation', 'تعليق');
  return page(t('Reading notes', 'ملاحظات القراءة'), `
    <nav class="project-tools"><a href="${documentsPath(lang,id,document)}">${t('Document versions', 'إصدارات المستند')}</a>
    <a href="${index}?lang=${lang}">${t('Library collections', 'مجموعات المكتبة')}</a>
    <a href="${foldersIndex}?lang=${lang}">${t('Library folders', 'مجلدات المكتبة')}</a></nav>
    <h2 dir="auto">${escapeHtml(entry.title)}</h2>
    <form class="project-tools" method="get" action="${path}">
      ${hidden('lang',lang)}<label>${t('Open PDF version','افتح إصدار PDF')}
      <select name="version">${versions.map((item) => `<option value="${item.number}"${item.number === requestedVersion ? ' selected' : ''}>v${item.number}</option>`).join('')}</select></label>
      <button class="action">${t('Read version','اقرأ الإصدار')}</button>
      <a href="${download(requestedVersion)}">${t('Download this version','نزّل هذا الإصدار')}</a>
    </form>
    <section class="pdf-reader" data-pdf-reader="${download(requestedVersion)}" data-page="${requestedPage}" data-version="${requestedVersion}"
      data-error="${t('Preview unavailable. Download this version to read it.','المعاينة غير متاحة. نزّل الإصدار لقراءته.')}">
      <p role="status">${t('Loading PDF…','جارٍ تحميل PDF…')}</p>
      <canvas hidden aria-label="${t('Rendered PDF page','صفحة PDF المعروضة')}"></canvas>
      <div class="project-tools"><button type="button" class="action" data-previous disabled>${t('Previous page','الصفحة السابقة')}</button>
      <button type="button" class="action" data-next disabled>${t('Next page','الصفحة التالية')}</button></div>
      <noscript><p>${t('Enable JavaScript for the preview, or download the PDF.','فعّل جافاسكريبت للمعاينة، أو نزّل ملف PDF.')}</p></noscript>
    </section>
    <script type="module" src="/pdf-reader.mjs"></script>
    <h2>${t('Collections', 'المجموعات')}</h2>
    ${entry.collections.length ? `<ul class="project-list">${entry.collections.map((group) => `<li>
      <form class="project-tools" method="post" action="${base}">${hidden('collection',group.id)}
        <bdi>${escapeHtml(group.name)}</bdi>${group.linked ? button('unlink',t('Remove from collection','أزل من المجموعة')) : button('link',t('Add to collection','أضف إلى المجموعة'))}
      </form></li>`).join('')}</ul>` : `<p>${t('Create a collection to organize this PDF.', 'أنشئ مجموعة لتنظيم ملف PDF هذا.')}</p>`}
    <h2>${t('Folders', 'المجلدات')}</h2>
    ${entry.folders.length ? `<ul class="project-list">${entry.folders.map((group) => `<li><form class="project-tools" method="post" action="${base}">
      ${hidden('folder',group.id)}<bdi>${escapeHtml(group.name)}</bdi>${group.linked ? button('folder-unlink',t('Remove from folder','أزل من المجلد')) : button('folder-link',t('Add to folder','أضف إلى المجلد'))}</form></li>`).join('')}</ul>` :
      `<p><a href="${foldersIndex}?lang=${lang}">${t('Create a folder to organize this PDF separately from collections.', 'أنشئ مجلدًا لتنظيم ملف PDF بشكل مستقل عن المجموعات.')}</a></p>`}
    <h2>${t('Bookmarks and annotations', 'الإشارات والتعليقات')}</h2>
    <form class="workspace-form" method="post" action="${base}">
      <label>${t('Document version', 'إصدار المستند')}<select name="version" required>${versions.map((version) => `<option value="${version.number}"${version.number === requestedVersion ? ' selected' : ''}>v${version.number}</option>`).join('')}</select></label>
      <label>${t('PDF page', 'صفحة PDF')}<input name="page" type="number" min="1" max="100000" value="${requestedPage}" required></label>
      <label>${t('Type', 'النوع')}<select name="kind"><option value="bookmark">${marker('bookmark')}</option><option value="annotation">${marker('annotation')}</option></select></label>
      <label>${t('Note or bookmark label', 'نص التعليق أو اسم الإشارة')}<textarea name="text" maxlength="2000" dir="auto"></textarea></label>
      ${button('add-mark',t('Save reading mark','احفظ علامة القراءة'))}</form>
    <ol class="project-list message-list">${entry.marks.slice(0,50).map((mark) => `<li class="provider-block">
      <p><a href="${base}&amp;version=${mark.version}&amp;page=${mark.page}">${marker(mark.kind)} · v${mark.version}</a>
      · ${t('Page','صفحة')} ${mark.page}</p><p dir="auto">${escapeHtml(mark.text)}</p>
      <form class="project-tools" method="post" action="${base}">${hidden('mark',mark.id)}${button('delete-mark',t('Remove mark','احذف العلامة'))}</form>
    </li>`).join('')}</ol>${pagination(entry.marks)}`, {
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
}
