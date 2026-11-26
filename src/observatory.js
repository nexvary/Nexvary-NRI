import { resolverUrl } from './crossref.js';
import { escapeHtml, workspacePage } from './workspace-view.js';

const labels = {
  title: ['Technology observatory', 'مرصد التكنولوجيا'],
  topic: ['Topic title', 'عنوان الموضوع'],
  query: ['Saved library search', 'بحث محفوظ في المكتبة'],
  create: ['Create watchlist', 'أنشئ قائمة متابعة'],
  empty: ['No watchlists', 'لا توجد قوائم متابعة'],
  back: ['All watchlists', 'كل قوائم المتابعة'],
  library: ['Open saved library search', 'افتح البحث المحفوظ في المكتبة'],
  update: ['Record a source update', 'سجّل تحديثًا بمصدر'],
  noSources: ['Save reference metadata in a project to record an update.', 'احفظ بيانات مرجع في أحد المشاريع لتسجيل تحديث.'],
  noUpdates: ['No updates match this watchlist.', 'لا توجد تحديثات مطابقة في القائمة.'],
  note: ['Update note', 'ملاحظة التحديث'],
  source: ['Saved source', 'المصدر المحفوظ'],
  retrieved: ['Source retrieved (UTC)', 'جلب المصدر بتوقيت UTC'],
  date: ['Update date', 'تاريخ التحديث'],
  filter: ['Filter updates', 'صفِّ التحديثات'],
  apply: ['Apply filter', 'طبّق التصفية'],
  remove: ['Delete watchlist and its updates', 'احذف قائمة المتابعة وتحديثاتها'],
  confirm: ['Confirm removal', 'أكد الحذف'],
  invalid: ['Check the required fields and select a source you can access.', 'تحقق من الحقول المطلوبة واختر مصدرًا يمكنك الوصول إليه.'],
};

const root = '/workspace/observatory';
const path = (lang, id) => root + (id ? '/' + id : '') + '?lang=' + lang;
export function resolveObservatoryRoute(pathname) {
  if (pathname === root) return { kind: 'observatory' };
  const match = pathname.match(/^\/workspace\/observatory\/([a-f0-9-]{36})$/);
  if (match) return { kind: 'observatory-topic', id: match[1] };
}

export function createObservatoryHandler(store) {
  return ({ request, reply, redirect, route, lang, account, form }) => {
    const t = (key) => labels[key][lang === 'ar' ? 1 : 0];
    const owner = account.id;
    const { id } = route;
    const topic = id ? store.observatory.get(owner, id) : null;
    if (id && !topic) {
      reply(404, workspacePage(lang, 'missing'));
      return;
    }
    const value = (name) => form?.get(name)?.trim() ?? '';
    let invalid = false;
    if (request.method === 'POST') {
      if (!id) {
        const title = value('title');
        const query = value('query');
        if (title && title.length <= 120 && query.length <= 200) {
          redirect(path(lang, store.observatory.create(owner, title, query)));
          return;
        }
      } else if (value('intent') === 'remove' && value('confirm') === 'yes' && store.observatory.remove(owner, id)) {
        redirect(path(lang));
        return;
      } else if (value('intent') === 'add') {
        const date = value('date');
        const note = value('note');
        const [project, provider, ...identifier] = value('source').split(':');
        const time = Date.parse(date);
        if (note.length > 0 && note.length <= 2000 && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date &&
          store.observatory.add(owner, id, { note, date, project: project ?? '', provider: provider ?? '', doi: identifier.join(':') })) {
          redirect(path(lang, id));
          return;
        }
      }
      invalid = true;
    }
    const title = t('title');
    const panel = (body) => reply(invalid ? 422 : 200, {
      title, path: root + (id ? '/' + id : ''), html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>${invalid ? `<p class="form-error" role="alert">${t('invalid')}</p>` : ''}${body}</section>`,
    });
    if (!topic) {
      const topics = store.observatory.topics(owner);
      panel(`<form class="workspace-form" method="post" action="${path(lang)}">
        <label>${t('topic')}<input name="title" maxlength="120" required></label>
        <label>${t('query')}<input name="query" maxlength="200"></label>
        <button class="action">${t('create')}</button></form>
        ${topics.length ? `<ul class="project-list">${topics.map((item) => `<li>
          <a href="${path(lang,item.id)}"><bdi>${escapeHtml(item.title)}</bdi></a></li>`).join('')}</ul>` : `<p>${t('empty')}</p>`}`);
      return;
    }
    const filter = new URL('http://localhost' + request.url).searchParams.get('q')?.trim().slice(0, 200) ?? '';
    const updates = store.observatory.updates(owner, id, filter);
    const sources = store.library.list(owner, 'source', topic.query, 1, 100);
    const searchUrl = '/workspace/library?' + escapeHtml(new URLSearchParams({ lang, kind: 'source', q: topic.query }).toString());
    panel(`<a href="${path(lang)}">${t('back')}</a><h2 dir="auto">${escapeHtml(topic.title)}</h2>
      <a href="${searchUrl}">${t('library')}</a>
      ${sources.length ? `<form class="workspace-form" method="post" action="${path(lang,id)}">
        <label>${t('source')}<select name="source" required>${sources.map((entry) =>
          `<option value="${escapeHtml(entry.projectId + ':' + entry.detail + ':' + entry.item)}">${escapeHtml(entry.title + ' · ' + entry.project)}</option>`).join('')}</select></label>
        <label>${t('date')}<input name="date" type="date" required></label>
        <label>${t('note')}<textarea name="note" maxlength="2000" required></textarea></label>
        <button class="action" name="intent" value="add">${t('update')}</button></form>` : `<p>${t('noSources')}</p>`}
      <form class="workspace-form" method="get" action="${root}/${id}">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('filter')}<input name="q" maxlength="200" value="${escapeHtml(filter)}"></label>
        <button class="action">${t('apply')}</button></form>
      ${updates.length ? updates.map((item) => `<article class="surface panel reference-record">
        <h3 dir="auto">${escapeHtml(item.source.metadata?.title || item.source.identifier)}</h3>
        <p><time dir="ltr">${item.date}</time> · <bdi>${escapeHtml(item.source.provider)}</bdi> ·
          <a dir="ltr" href="${resolverUrl(item.source.identifier)}">${escapeHtml(item.source.identifier)}</a></p>
        <p>${t('retrieved')} · <time dir="ltr">${new Date(item.source.retrievedAt).toISOString()}</time></p>
        <p dir="auto">${escapeHtml(item.note)}</p></article>`).join('') : `<p>${t('noUpdates')}</p>`}
      <form class="project-tools" method="post" action="${path(lang,id)}">
        <label><input name="confirm" type="checkbox" value="yes" required> ${t('confirm')}</label>
        <button class="action danger" name="intent" value="remove">${t('remove')}</button></form>`);
  };
}
