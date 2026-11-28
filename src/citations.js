import { citationText, parseCitations } from './citation-formats.js';
import { fromSavedReferences } from './citation-store.js';
import { escapeHtml, projectReferencesPath } from './workspace-view.js';

export function resolveCitationRoute(path) {
  const match = path.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/citations$/);
  if (match) return { kind: 'citations', id: match[1] };
}

export function handleCitations({ request, reply, redirect, route, lang, account, form, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const id = route.id;
  const owner = account.id;
  const project = store.getProject(owner,id);
  if (!project) return reply(404);
  const path = '/workspace/projects/' + id + '/citations';
  const action = path + '?lang=' + lang;
  if (form) {
    let status = 422;
    const intent = form.get('intent');
    if (intent === 'import') {
      let records;
      try {
        records = parseCitations(form.get('format'),form.get('data') ?? '');
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (records) status = store.citations.add(owner,id,records);
    } else if (intent === 'snapshots') {
      status = store.citations.add(owner,id,fromSavedReferences(store.references.list(owner,id)), 'saved-reference');
    } else if (intent === 'merge') {
      status = store.citations.merge(owner,id,form.get('target'),form.get('source'));
    }
    if (status === 303) return redirect(action);
    return reply(status, {
      title: t('Citation library','مكتبة الاستشهادات'), path,
      html: `<section class="surface panel detail workspace-page"><h1>${t('Citation library','مكتبة الاستشهادات')}</h1>
        <p role="alert">${status === 409 ? t('Different DOIs require separate records.','تتطلب معرّفات DOI المختلفة سجلات منفصلة.') :
          t('Check the citation format, records and project limit.','تحقق من تنسيق الاستشهادات والسجلات والحد الأقصى للمشروع.')}</p>
        <a href="${action}">${t('Back to citations','العودة إلى الاستشهادات')}</a></section>`,
    });
  }
  const groups = store.citations.list(owner,id);
  const params = new URL(request.url,'http://localhost').searchParams;
  const format = params.get('export');
  if (['bibtex','ris'].includes(format)) {
    const preferred = groups.flatMap(({sources}) => (params.get('sources') === 'all' ? sources : sources.slice(0,1)).map((source) => source.data));
    return reply(200,null,{
      'Content-Type':'text/plain; charset=utf-8',
      'Content-Disposition':`attachment; filename="nri-citations.${format === 'bibtex' ? 'bib' : 'ris'}"`,
    },citationText(preferred,format));
  }
  const title = t('Citation library','مكتبة الاستشهادات');
  const identities = ({sources}) => new Set(sources.flatMap((item) => [item.title_key && 'title:' + item.title_key,
    item.provider_key && 'provider:' + item.provider_key, item.doi && 'doi:' + item.doi]).filter(Boolean));
  const indexed = groups.map((group) => ({ ...group, keys: identities(group) }));
  const offset = Math.min(450, Number(params.get('offset')) || 0);
  const page = offset >= 0 ? Math.floor(offset / 50) * 50 : 0;
  const date = new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeZone:'UTC'});
  reply(200,{
    title,path,
    html:`<section class="surface panel detail workspace-page"><h1>${title}</h1><h2 dir="auto">${escapeHtml(project.title)}</h2>
      <nav class="project-tools"><a href="${projectReferencesPath(lang,id)}">${t('Saved project references','مراجع المشروع المحفوظة')}</a>
      <a href="${action}&amp;export=bibtex">${t('Export BibTeX','صدّر BibTeX')}</a>
      <a href="${action}&amp;export=ris">${t('Export RIS','صدّر RIS')}</a></nav>
      <p><a href="${action}&amp;export=bibtex&amp;sources=all">${t('Export all source records (BibTeX)','صدّر جميع سجلات المصادر (BibTeX)')}</a> ·
      <a href="${action}&amp;export=ris&amp;sources=all">${t('Export all source records (RIS)','صدّر جميع سجلات المصادر (RIS)')}</a></p>
      <form class="workspace-form" method="post" action="${action}">
        <label>${t('Citation format','تنسيق الاستشهاد')}<select name="format"><option value="bibtex">BibTeX</option><option value="ris">RIS</option></select></label>
        <label>${t('Citation records','سجلات الاستشهاد')}<textarea name="data" maxlength="80000" rows="6" required dir="auto"></textarea></label>
        <button class="action" name="intent" value="import">${t('Import citations','استورد الاستشهادات')}</button>
      </form>
      <form method="post" action="${action}"><button class="action" name="intent" value="snapshots">${t('Add saved snapshots','أضف اللقطات المحفوظة')}</button></form>
      <ul class="project-list">${indexed.slice(page,page + 50).map(({id: citation,sources,keys}) => {
        const candidates = indexed.filter((item) => item.id !== citation && [...item.keys].some((key) => keys.has(key))).slice(0,20);
        return `<li class="provider-block"><h3 dir="auto">${escapeHtml(sources[0].data.title)}</h3>
          <details><summary>${t('Source records','سجلات المصادر')} · ${sources.length}</summary>
          <ul>${sources.map((source) => `<li><bdi>${escapeHtml(source.data.title)}</bdi> ·
            ${source.origin === 'import' ? t('Imported file data','بيانات ملف مستورد') : t('Saved provider snapshot','لقطة مزوّد محفوظة')}
            · <bdi>${escapeHtml(source.data.provider ?? '')} ${escapeHtml(source.doi ?? source.data.providerId ?? '')}</bdi> ·
            ${date.format(source.received_at)}</li>`).join('')}</ul></details>
          ${candidates.length ? `<form class="workspace-form" method="post" action="${action}"><input type="hidden" name="target" value="${citation}">
            <label>${t('Possible duplicate','تكرار محتمل')}<select name="source">${candidates.map((item) =>
              `<option value="${item.id}">${escapeHtml(item.sources[0].data.title)} ${escapeHtml(item.sources[0].doi ?? '')}</option>`).join('')}</select></label>
            <button class="action" name="intent" value="merge">${t('Merge into this citation','ادمج في هذا الاستشهاد')}</button></form>` : ''}</li>`;
      }).join('')}</ul>
      <nav class="project-tools">${page ? `<a href="${action}&amp;offset=${page-50}">${t('Previous','السابق')}</a>` : ''}
      ${indexed.length > page+50 ? `<a href="${action}&amp;offset=${page+50}">${t('Next','التالي')}</a>` : ''}</nav></section>`,
  });
}
