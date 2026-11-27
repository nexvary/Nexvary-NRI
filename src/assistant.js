import { escapeHtml, projectReferencesPath } from './workspace-view.js';

const path = '/workspace/assistant';
const limit = 12;
const labels = {
  title: ['AI assistant', 'المساعد الذكي'],
  settings: ['Provider settings', 'إعدادات المزوّد'],
  local: ['Local source review', 'مراجعة المصادر محليًا'],
  boundary: [
    'Review saved reference metadata before using it in an answer. This tool sends no data to external providers and costs nothing.',
    'راجع بيانات المراجع المحفوظة قبل استخدامها في إجابة. لا ترسل هذه الأداة بيانات إلى مزوّدين خارجيين ولا تترتب عليها أي تكلفة.',
  ],
  project: ['Research project', 'المشروع البحثي'],
  choose: ['Choose a project', 'اختر مشروعًا'],
  query: ['Filter by title or identifier', 'التصفية حسب العنوان أو المعرّف'],
  review: ['Review saved sources', 'راجع المصادر المحفوظة'],
  provenance: [
    'These records show what each provider returned on the date shown. Check the original work and its relevance before citing it.',
    'تعرض هذه السجلات ما أعاده كل مزوّد في التاريخ الموضح. راجع العمل الأصلي وصلته بموضوع البحث قبل الاستشهاد به.',
  ],
  references: ['Open reference validator', 'افتح مدقّق المراجع'],
  unavailable: ['Project unavailable.', 'المشروع غير متاح.'],
  empty: ['No saved references match this filter.', 'لا توجد مراجع محفوظة تطابق عامل التصفية.'],
  missing: ['Provider did not find this reference.', 'لم يعثر المزوّد على هذا المرجع.'],
  found: ['Provider metadata found. Retraction status remains unverified.', 'عُثر على بيانات المزوّد. تظل حالة السحب غير مؤكدة.'],
  editorial: ['Provider recorded an editorial update. Check the reference record.', 'سجّل المزوّد تحديثًا تحريريًا. راجع سجل المرجع.'],
  retracted: ['Provider flagged a retraction.', 'أشار المزوّد إلى سحب المرجع.'],
  capped: ['Showing the first 12 matches. Refine the filter for other sources.', 'تظهر أول ١٢ نتيجة مطابقة. عدّل عامل التصفية للوصول إلى مصادر أخرى.'],
};

function sourceStatus(source) {
  if (source.status !== 'found') return 'missing';
  if (source.metadata.isRetracted || source.metadata.updatedBy?.some(({ type }) => type === 'retraction')) return 'retracted';
  if (source.metadata.updatedBy?.length || source.metadata.updates?.length) return 'editorial';
  return 'found';
}

export function showAssistant({ reply, request, lang, store, account }) {
  const t = (key) => labels[key][lang === 'ar' ? 1 : 0];
  const params = new URL(request.url, 'http://localhost').searchParams;
  const projectId = params.get('project') ?? '';
  const filter = (params.get('q') ?? '').trim().slice(0, 200);
  const projects = store.listProjects(account.id);
  const selected = projects.find(({ id }) => id === projectId);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
  const sources = selected ? store.references.review(account.id, selected.id, filter, limit + 1) : [];
  const result = selected ? `
    <h2>${escapeHtml(selected.title)}</h2>
    <p>${t('provenance')}</p>
    <p><a href="${projectReferencesPath(lang, selected.id)}">${t('references')}</a></p>
    ${sources.length ? `<ol class="project-list">${sources.slice(0, limit).map((source) => `<li>
      <strong dir="auto">${escapeHtml(source.metadata?.title || source.doi)}</strong>
      <small><bdi>${escapeHtml(source.doi)}</bdi> · <bdi>${escapeHtml(source.provider)}</bdi> · ${date.format(source.checkedAt)}</small>
      <small>${t(sourceStatus(source))}</small>
    </li>`).join('')}</ol>` : `<p>${t('empty')}</p>`}
    ${sources.length > limit ? `<p>${t('capped')}</p>` : ''}` : '';
  reply(projectId && !selected ? 404 : 200, {
    title: t('title'), path,
    html: `<section class="surface panel detail workspace-page">
      <h1>${t('title')}</h1><p><a href="${path}/settings?lang=${lang}">${t('settings')}</a></p><h2>${t('local')}</h2><p>${t('boundary')}</p>
      <form class="workspace-form" action="${path}" method="get">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('project')}<select name="project" required>
          <option value="">${t('choose')}</option>
          ${projects.map(({ id, title }) => `<option value="${escapeHtml(id)}"${id === selected?.id ? ' selected' : ''}>${escapeHtml(title)}</option>`).join('')}
        </select></label>
        <label>${t('query')}<input name="q" maxlength="200" dir="auto" value="${escapeHtml(filter)}"></label>
        <button class="action">${t('review')}</button>
      </form>
      ${projectId && !selected ? `<p>${t('unavailable')}</p>` : result}
    </section>`,
  });
}
