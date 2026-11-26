import { crossrefUrl, resolverUrl } from './crossref.js';
import { escapeHtml, projectReferencesPath, workspacePath } from './workspace-view.js';

const copy = {
  heading: ['Reference validator', 'التحقق من المراجع'],
  selection: ['Choose a project', 'اختر مشروعًا'],
  emptyProjects: ['Create a project to save reference checks.', 'أنشئ مشروعًا لحفظ نتائج التحقق من المراجع.'],
  workspace: ['Open research workspace', 'افتح إدارة الأبحاث'],
  back: ['Back to the project', 'العودة إلى المشروع'],
  doi: ['DOI or DOI link', 'معرّف DOI أو رابطه'],
  lookup: ['Check and save', 'تحقّق واحفظ النتيجة'],
  refresh: ['Check again', 'أعد التحقق'],
  remove: ['Remove', 'أزل المرجع'],
  disclosure: ['A lookup sends only the entered DOI to Crossref when a fresh check is needed. A saved result shows the original retrieval time.', 'يُرسل معرّف DOI المدخل فقط إلى Crossref عند الحاجة إلى فحص جديد. تعرض النتيجة المحفوظة تاريخ الجلب الأصلي.'],
  saved: ['Saved references', 'المراجع المحفوظة'],
  empty: ['No DOI checks saved for this project.', 'لا توجد نتائج تحقق محفوظة لهذا المشروع.'],
  source: ['Source', 'المصدر'],
  retrieved: ['Retrieved (UTC)', 'تاريخ الجلب بتوقيت UTC'],
  found: ['Metadata found in Crossref', 'عُثر على البيانات في Crossref'],
  'not-found': ['Crossref returned no record. DOI status is unknown.', 'لم يُرجع Crossref سجلًا. حالة المعرّف غير معروفة.'],
  venue: ['Publication', 'الدورية أو جهة النشر'],
  publisher: ['Publisher', 'الناشر'],
  authors: ['Authors', 'المؤلفون'],
  moreAuthors: ['and others', 'وآخرون'],
  type: ['Record type reported by Crossref', 'نوع السجل بحسب Crossref'],
  preprint: ['Preprint', 'مسودة قبل النشر'],
  issued: ['Issue date', 'تاريخ الإصدار'],
  updatedBy: ['Updates affecting this work', 'تحديثات تخص هذا العمل'],
  updates: ['This notice updates the following works', 'هذا الإشعار يحدّث الأعمال التالية'],
  noUpdates: ['Crossref returned no editorial updates for this record. Its review and retraction status remain unverified.', 'لم يُرجع Crossref تحديثات تحريرية لهذا السجل. حالة التحكيم أو السحب تظل غير مؤكدة.'],
  moreNotices: ['Additional notices are available in the Crossref record.', 'توجد إشعارات إضافية في سجل Crossref.'],
  retraction: ['Retraction', 'سحب'],
  correction: ['Correction', 'تصحيح'],
  erratum: ['Erratum', 'تصويب'],
  corrigendum: ['Corrigendum', 'استدراك'],
  'expression-of-concern': ['Expression of concern', 'إشعار قلق'],
  invalid: ['Enter a DOI beginning with 10. or a doi.org link.', 'أدخل معرّفًا يبدأ بـ 10. أو رابطًا من doi.org.'],
  limited: ['Crossref checks are temporarily limited. Try again shortly.', 'التحقق عبر Crossref محدود مؤقتًا. جرّب مجددًا بعد قليل.'],
  unavailable: ['Crossref could not be checked. Previously saved results are still shown below.', 'تعذّر التحقق عبر Crossref. تظل النتائج المحفوظة سابقًا ظاهرة أدناه.'],
};

export function referencePage(lang, options = {}) {
  const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
  const { projects, id, project, records = [], error, input = '' } = options;
  const title = t('heading');
  if (projects) {
    return {
      title,
      path: '/workspace/reference-projects',
      html: `
        <section class="surface panel detail workspace-page">
          <h1>${title}</h1><h2>${t('selection')}</h2>
          ${projects.length
            ? `<ul class="project-list">${projects.map((item) => `
              <li><a href="${projectReferencesPath(lang, item.id)}"><bdi>${escapeHtml(item.title)}</bdi></a></li>`).join('')}</ul>`
            : `<p>${t('emptyProjects')}</p><a class="action" href="${workspacePath(lang)}">${t('workspace')}</a>`}
        </section>`,
    };
  }

  const path = `/workspace/projects/${id}/references`;
  const action = projectReferencesPath(lang, id);
  const notices = (rows, direction) => {
    if (!rows.length) return '';
    return `<h4>${t(direction)}</h4><ul class="reference-notices">${rows.map((notice) => {
      const label = Object.hasOwn(copy, notice.type) ? t(notice.type) : notice.type;
      return `<li><strong>${escapeHtml(label)}</strong>
        ${notice.doi ? `<a href="${resolverUrl(notice.doi)}" dir="ltr">${escapeHtml(notice.doi)}</a>` : ''}
        ${notice.date ? `<bdi>${notice.date}</bdi>` : ''}
        ${notice.source ? `<bdi>${escapeHtml(notice.source)}</bdi>` : ''}
      </li>`;
    }).join('')}</ul>`;
  };

  const metadata = (data) => {
    const row = (key, value) => value ? `<div><dt>${t(key)}</dt><dd dir="auto">${escapeHtml(value)}</dd></div>` : '';
    const type = data.type === 'posted-content' && data.subtype === 'preprint'
      ? t('preprint') : [data.type, data.subtype].filter(Boolean).join(' · ');
    const authors = data.authors.join(', ') + (data.moreAuthors ? ` · ${t('moreAuthors')}` : '');
    return `
      <dl class="reference-meta">${row('type', type)}${row('venue', data.venue)}
        ${row('publisher', data.publisher)}${row('authors', authors)}${row('issued', data.issued)}</dl>
      ${notices(data.updatedBy, 'updatedBy')}${notices(data.updates, 'updates')}
      ${data.updatesTruncated ? `<p>${t('moreNotices')}</p>` : ''}
      ${data.updatedBy.length || data.updates.length ? '' : `<p>${t('noUpdates')}</p>`}`;
  };

  const date = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
  const recordsHtml = records.map((record) => {
    const checkedAt = new Date(record.checkedAt);
    return `<article class="surface panel reference-record">
      <h3 dir="auto">${escapeHtml(record.metadata?.title || record.doi)}</h3>
      <p><a href="${resolverUrl(record.doi)}" dir="ltr">${escapeHtml(record.doi)}</a></p>
      <p class="tag">${t(record.status)}</p>
      <dl class="reference-meta">
        <div><dt>${t('source')}</dt><dd><a href="${crossrefUrl(record.doi)}" lang="en" dir="ltr">Crossref</a></dd></div>
        <div><dt>${t('retrieved')}</dt><dd><time datetime="${checkedAt.toISOString()}">${date.format(checkedAt)}</time></dd></div>
      </dl>
      ${record.metadata ? metadata(record.metadata) : ''}
      <form class="project-tools" method="post" action="${action}">
        <input type="hidden" name="doi" value="${escapeHtml(record.doi)}">
        <button class="action" name="action" value="check">${t('refresh')}</button>
        <button class="action danger" name="action" value="remove">${t('remove')}</button>
      </form>
    </article>`;
  }).join('');

  return {
    title, path,
    html: `
      <section class="surface panel detail workspace-page">
        <a href="${workspacePath(lang, id)}">${t('back')}</a>
        <h1>${title}</h1><p dir="auto">${escapeHtml(project.title)}</p>
        <form class="workspace-form" method="post" action="${action}">
          <label>${t('doi')}<input name="doi" type="text" dir="ltr" maxlength="1100" value="${escapeHtml(input)}" aria-describedby="doi-disclosure" required></label>
          <small id="doi-disclosure">${t('disclosure')}</small>
          <button class="action" name="action" value="check">${t('lookup')}</button>
        </form>
        ${error ? `<p class="form-error" role="alert">${t(error)}</p>` : ''}
        <section class="project-list">
          <h2>${t('saved')}</h2>
          ${recordsHtml || `<p>${t('empty')}</p>`}
        </section>
      </section>`,
  };
}
