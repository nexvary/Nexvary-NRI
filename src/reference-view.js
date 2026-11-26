import { crossrefUrl, resolverUrl } from './crossref.js';
import { openAlexUrl, safeOpenAccessUrl } from './openalex.js';
import { escapeHtml, projectReferencesPath, workspacePath } from './workspace-view.js';

const copy = {
  heading: ['Reference validator', 'التحقق من المراجع'],
  selection: ['Choose a project', 'اختر مشروعًا'],
  emptyProjects: ['Create a project to save reference checks.', 'أنشئ مشروعًا لحفظ نتائج التحقق.'],
  workspace: ['Open research workspace', 'افتح إدارة الأبحاث'],
  back: ['Back to the project', 'العودة إلى المشروع'],
  doi: ['DOI or DOI link', 'معرّف DOI أو رابطه'],
  lookup: ['Check and save', 'تحقّق واحفظ النتيجة'],
  refresh: ['Check again', 'أعد التحقق'],
  remove: ['Remove', 'أزل المرجع'],
  provider: ['Provider', 'مزوّد البيانات'],
  disclosure: ['A fresh check sends the entered DOI to the selected provider. Saved results show their original retrieval times.', 'يُرسَل معرّف DOI إلى المزوّد المحدد عند إجراء فحص جديد. تُظهر النتائج المحفوظة وقت جلبها الأصلي.'],
  saved: ['Saved references', 'المراجع المحفوظة'],
  empty: ['No DOI checks saved for this project.', 'لا توجد نتائج تحقق محفوظة لهذا المشروع.'],
  source: ['Source', 'المصدر'],
  retrieved: ['Retrieved (UTC)', 'تاريخ الجلب بتوقيت UTC'],
  'found-crossref': ['Metadata found in Crossref', 'عُثِر على البيانات في Crossref'],
  'found-openalex': ['Metadata found in OpenAlex', 'عُثِر على البيانات في OpenAlex'],
  'not-found-crossref': ['Crossref returned no record. DOI status is unknown.', 'لم يُرجع Crossref سجلًا. حالة المعرّف غير معروفة.'],
  'not-found-openalex': ['OpenAlex returned no record. DOI status is unknown.', 'لم يُرجع OpenAlex سجلًا. حالة المعرّف غير معروفة.'],
  compareNote: ['Both providers have been checked. Differences may appear between results.', 'تم التحقق من كلا المزوّدَين. قد تظهر اختلافات.'],
  compareEmpty: ['Check this DOI against the second provider to compare results.', 'تحقق من هذا المعرّف عبر المزوّد الثاني لمقارنة النتائج.'],
  venue: ['Publication', 'الدورية أو جهة النشر'],
  publisher: ['Publisher', 'الناشر'],
  authors: ['Authors', 'المؤلفون'],
  moreAuthors: ['and others', 'وآخرون'],
  type: ['Record type reported by Crossref', 'نوع السجل بحسب Crossref'],
  openalexType: ['Record type reported by OpenAlex', 'نوع السجل بحسب OpenAlex'],
  unknownRetraction: ['OpenAlex did not flag a retraction. Retraction status remains unverified.', 'لم يُشر OpenAlex إلى سحب السجل. لا تزال حالة السحب غير مؤكدة.'],
  preprint: ['Preprint', 'مسودة قبل النشر'],
  issued: ['Issue date', 'تاريخ الإصدار'],
  updatedBy: ['Updates affecting this work', 'تحديثات تخص هذا العمل'],
  updates: ['This notice updates the following works', 'هذا الإشعار يحدّث الأعمال التالية'],
  noUpdates: ['Crossref returned no editorial updates for this record. Its retraction status remains unverified.', 'لم يُرجع Crossref تحديثات تحريرية لهذا السجل.'],
  moreNotices: ['Additional notices are available in the Crossref record.', 'توجد إشعارات إضافية في سجل Crossref.'],
  retracted: ['Retracted (OpenAlex)', 'مسحوب (OpenAlex)'],
  openAccess: ['Open access copy', 'نسخة وصول مفتوح'],
  retraction: ['Retraction', 'سحب'],
  correction: ['Correction', 'تصحيح'],
  erratum: ['Erratum', 'تصويب'],
  corrigendum: ['Corrigendum', 'استدراك'],
  'expression-of-concern': ['Expression of concern', 'إشعار قلق'],
  invalid: ['Enter a DOI beginning with 10. or a doi.org link.', 'أدخل معرّفًا يبدأ بـ 10. أو رابطًا من doi.org.'],
  'limited-crossref': ['Crossref checks are temporarily limited. Try again shortly.', 'التحقق عبر Crossref محدود مؤقتًا.'],
  'limited-openalex': ['OpenAlex checks are temporarily limited. Try again shortly.', 'التحقق عبر OpenAlex محدود مؤقتًا.'],
  'unavailable-crossref': ['Crossref could not be checked. Previously saved results are still shown.', 'تعذّر التحقق عبر Crossref. تظل النتائج المحفوظة ظاهرة.'],
  'unavailable-openalex': ['OpenAlex could not be checked. Previously saved results are still shown.', 'تعذّر التحقق عبر OpenAlex. تظل النتائج المحفوظة ظاهرة.'],
  title: ['Title', 'العنوان'],
};

function providerUrl(provider, doi) {
  return provider === 'openalex' ? openAlexUrl(doi) : crossrefUrl(doi);
}

function providerLabel(provider) {
  return provider === 'openalex' ? 'OpenAlex' : 'Crossref';
}

export function referencePage(lang, options = {}) {
  const t = (key) => (copy[key] ?? ['', ''])[lang === 'ar' ? 1 : 0];
  const { projects, id, project, records = [], error, input = '', provider = 'crossref' } = options;
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

  const crossrefMeta = (data) => {
    const row = (key, value) => value ? `<div><dt>${t(key)}</dt><dd dir="auto">${escapeHtml(value)}</dd></div>` : '';
    const type = data.type === 'posted-content' && data.subtype === 'preprint'
      ? t('preprint') : [data.type, data.subtype].filter(Boolean).join(' · ');
    const authors = data.authors.join(', ') + (data.moreAuthors ? ` · ${t('moreAuthors')}` : '');
    return `<dl class="reference-meta">${row('title', data.title)}${row('type', type)}${row('venue', data.venue)}${row('publisher', data.publisher)}${row('authors', authors)}${row('issued', data.issued)}</dl>
      ${notices(data.updatedBy, 'updatedBy')}${notices(data.updates, 'updates')}
      ${data.updatesTruncated ? `<p>${t('moreNotices')}</p>` : ''}
      ${data.updatedBy.length || data.updates.length ? '' : `<p>${t('noUpdates')}</p>`}`;
  };

  const openalexMeta = (data) => {
    const row = (key, value) => value ? `<div><dt>${t(key)}</dt><dd dir="auto">${escapeHtml(value)}</dd></div>` : '';
    const authors = data.authors.join(', ') + (data.moreAuthors ? ` · ${t('moreAuthors')}` : '');
    const openAccessUrl = safeOpenAccessUrl(data.openAccessUrl);
    return `<dl class="reference-meta">${row('title', data.title)}${row('openalexType', data.type)}${row('venue', data.venue)}${row('publisher', data.publisher)}${row('authors', authors)}${row('issued', data.issued)}</dl>
      ${data.isRetracted ? `<p class="tag danger">${t('retracted')}</p>` : `<p>${t('unknownRetraction')}</p>`}
      ${openAccessUrl ? `<p><a href="${escapeHtml(openAccessUrl)}">${t('openAccess')}</a></p>` : ''}`;
  };

  const renderMeta = (record) => {
    if (!record.metadata) return '';
    return record.provider === 'openalex' ? openalexMeta(record.metadata) : crossrefMeta(record.metadata);
  };

  const dtFmt = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });

  const byDoi = new Map();
  for (const record of records) {
    if (!byDoi.has(record.doi)) byDoi.set(record.doi, {});
    byDoi.get(record.doi)[record.provider] = record;
  }

  const recordsHtml = [...byDoi.entries()].map(([doi, byProvider]) => {
    const crossrefRecord = byProvider.crossref;
    const openalexRecord = byProvider.openalex;
    const titleText = crossrefRecord?.metadata?.title || openalexRecord?.metadata?.title || doi;

    const renderRecord = (record) => {
      if (!record) return '';
      const d = new Date(record.checkedAt);
      const statusKey = `${record.status}-${record.provider}`;
      const statusLabel = t(statusKey) || t(record.status);
      return `<div class="provider-block">
        <dl class="reference-meta">
          <div><dt>${t('source')}</dt><dd><a href="${providerUrl(record.provider, doi)}" lang="en" dir="ltr">${providerLabel(record.provider)}</a></dd></div>
          <div><dt>${t('retrieved')}</dt><dd><time datetime="${d.toISOString()}">${dtFmt.format(d)}</time></dd></div>
        </dl>
        <p class="tag">${statusLabel}</p>
        ${renderMeta(record)}
        <form class="project-tools" method="post" action="${action}">
          <input type="hidden" name="doi" value="${escapeHtml(doi)}">
          <input type="hidden" name="provider" value="${record.provider}">
          <button class="action" name="action" value="check">${t('refresh')}</button>
          <button class="action danger" name="action" value="remove">${t('remove')}</button>
        </form>
      </div>`;
    };

    const note = crossrefRecord && openalexRecord
      ? `<p class="comparison-note">${t('compareNote')}</p>`
      : `<p class="comparison-note secondary">${t('compareEmpty')}</p>`;

    return `<article class="surface panel reference-record">
      <h3 dir="auto">${escapeHtml(titleText)}</h3>
      <p><a href="${resolverUrl(doi)}" dir="ltr">${escapeHtml(doi)}</a></p>
      ${note}
      <div class="provider-comparison">${renderRecord(crossrefRecord)}${renderRecord(openalexRecord)}</div>
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
          <fieldset class="provider-select">
            <legend>${t('provider')}</legend>
            <label><input type="radio" name="provider" value="crossref"${provider !== 'openalex' ? ' checked' : ''}> Crossref</label>
            <label><input type="radio" name="provider" value="openalex"${provider === 'openalex' ? ' checked' : ''}> OpenAlex</label>
          </fieldset>
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
