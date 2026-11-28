import { documentsPath, escapeHtml, projectReferencesPath, workspacePath } from './workspace-view.js';

const pageSize = 30;

export function libraryStore(db) {
  const query = db.prepare(`
    WITH entries AS (
      SELECT CASE WHEN lower(substr(d.title, -4)) = '.txt' THEN 'txt' WHEN lower(substr(d.title, -5)) = '.docx' THEN 'docx' ELSE 'pdf' END AS kind, p.id AS projectId, p.title AS project, d.id AS item,
        d.title AS title, v.filename AS detail, v.created_at AS changed
      FROM projects p JOIN documents d ON d.project_id = p.id
      JOIN document_versions v ON v.document_id = d.id
        AND v.number = (SELECT MAX(number) FROM document_versions WHERE document_id = d.id)
      WHERE p.owner_id = ?
      UNION ALL
      SELECT 'source', p.id, p.title, r.doi, COALESCE(NULLIF(json_extract(r.metadata, '$.title'), ''), r.doi),
        r.provider, r.checked_at
      FROM projects p JOIN project_references r ON r.project_id = p.id
      WHERE p.owner_id = ? AND r.state = 'found' AND r.provider NOT IN ('orcid', 'agency')
    )
    SELECT * FROM entries WHERE (? = 'all' OR kind = ?)
      AND (instr(lower(title), lower(?)) > 0 OR instr(lower(project), lower(?)) > 0
        OR instr(lower(item), lower(?)) > 0 OR instr(lower(detail), lower(?)) > 0 OR ? = '')
    ORDER BY changed DESC, projectId, kind, item, detail LIMIT ? OFFSET ?
  `);
  const metrics = db.prepare(`
    SELECT (SELECT count(*) FROM projects WHERE owner_id = ?) AS projects,
      (SELECT count(*) FROM documents d JOIN projects p ON p.id = d.project_id WHERE p.owner_id = ? AND lower(substr(d.title, -4)) <> '.txt' AND lower(substr(d.title, -5)) <> '.docx') AS pdfs,
      (SELECT count(*) FROM project_references r JOIN projects p ON p.id = r.project_id
        WHERE p.owner_id = ? AND r.state = 'found' AND r.provider NOT IN ('orcid', 'agency')) AS sources,
      (SELECT count(*) FROM evidence_items e JOIN claims c ON c.id = e.claim_id
        JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ?) AS evidence
  `);
  const recent = db.prepare(`
    SELECT id, title, updated_at AS updatedAt FROM projects WHERE owner_id = ?
    ORDER BY updated_at DESC, id LIMIT 5
  `);
  return {
    list(owner, kind, search, page = 1, limit = pageSize + 1) {
      return query.all(owner, owner, kind, kind, search, search, search, search, search, limit, (page - 1) * pageSize);
    },
    dashboard(owner) {
      return { metrics: metrics.get(owner, owner, owner, owner), projects: recent.all(owner),
        activity: query.all(owner, owner, 'all', 'all', '', '', '', '', '', 4, 0) };
    },
  };
}

const labels = {
  title: ['Scientific library', 'المكتبة العلمية'],
  search: ['Search titles, projects, filenames and identifiers', 'ابحث في العناوين والمشاريع وأسماء الملفات والمعرّفات'],
  type: ['Record type', 'نوع السجل'],
  all: ['All records', 'كل السجلات'],
  pdf: ['Private PDF', 'ملف PDF خاص'],
  docx: ['Private DOCX', 'ملف DOCX خاص'],
  txt: ['Private TXT', 'ملف TXT خاص'],
  source: ['Saved reference', 'مرجع محفوظ'],
  apply: ['Search', 'ابحث'],
  empty: ['No library records match this view.', 'لا توجد سجلات مطابقة في المكتبة.'],
  previous: ['Previous page', 'الصفحة السابقة'],
  next: ['Next page', 'الصفحة التالية'],
  workspace: ['Open research workspace', 'افتح مساحة الأبحاث'],
};

export function libraryEntryPath(lang, entry) {
  return entry.kind !== 'source'
    ? documentsPath(lang, entry.projectId, entry.item)
    : projectReferencesPath(lang, entry.projectId);
}

export function libraryPage(lang, url, store, owner) {
  const t = (key) => labels[key][lang === 'ar' ? 1 : 0];
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const requestedKind = url.searchParams.get('kind');
  const kind = ['pdf', 'txt', 'docx', 'source'].includes(requestedKind) ? requestedKind : 'all';
  const requestedPage = Number(url.searchParams.get('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const entries = store.library.list(owner, kind, search, page);
  const pageLink = (number) => '/workspace/library?' + escapeHtml(new URLSearchParams({
    lang, q: search, kind, page: number,
  }).toString());
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
  return {
    title: t('title'), path: '/workspace/library',
    html: `<section class="surface panel detail workspace-page">
      <h1>${t('title')}</h1><nav class="project-tools"><a href="${workspacePath(lang)}">${t('workspace')}</a>
      <a href="/workspace/library/collections?lang=${lang}">${lang === 'ar' ? 'مجموعات المكتبة' : 'Library collections'}</a>
      <a href="/workspace/library/folders?lang=${lang}">${lang === 'ar' ? 'مجلدات المكتبة' : 'Library folders'}</a></nav>
      <form class="workspace-form" action="/workspace/library" method="get">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('search')}<input name="q" maxlength="200" dir="auto" value="${escapeHtml(search)}"></label>
        <label>${t('type')}<select name="kind">${['all', 'pdf', 'txt', 'docx', 'source'].map((type) =>
          `<option value="${type}"${type === kind ? ' selected' : ''}>${t(type)}</option>`).join('')}</select></label>
        <button class="action">${t('apply')}</button>
      </form>
      ${entries.length ? `<ul class="project-list">${entries.slice(0, pageSize).map((entry) => `<li>
        <a href="${libraryEntryPath(lang, entry)}"><bdi>${escapeHtml(entry.title)}</bdi></a>
        <small>${t(entry.kind)} · <bdi>${escapeHtml(entry.project)}</bdi> · <bdi>${escapeHtml(entry.detail)}</bdi> · ${date.format(entry.changed)}</small>
      </li>`).join('')}</ul>` : `<p>${t('empty')}</p>`}
      <nav class="project-tools" aria-label="${t('title')}">
        ${page > 1 ? `<a href="${pageLink(page - 1)}">${t('previous')}</a>` : ''}
        ${entries.length > pageSize ? `<a href="${pageLink(page + 1)}">${t('next')}</a>` : ''}
      </nav></section>`,
  };
}
