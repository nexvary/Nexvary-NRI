import { reportCategories } from './messages.js';
import { escapeHtml } from './workspace-view.js';

const path = '/workspace/settings/message-moderation';
const outcomes = { upheld: ['Upheld', 'بلاغ مقبول'], dismissed: ['Dismissed', 'بلاغ مرفوض'] };

export function handleMessageModeration({ request, reply, redirect, lang, account, form, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const owner = account.id;
  if (!store.messages.isModerator(owner)) return reply(403);
  const base = path + '?lang=' + lang;
  if (form) {
    const id = form.get('message') ?? '';
    const reporter = form.get('reporter') ?? '';
    const outcome = form.get('outcome');
    if (!/^[1-9]\d{0,14}$/.test(id) || !/^[a-f0-9-]{36}$/.test(reporter) || !Object.hasOwn(outcomes, outcome)) return reply(422);
    const status = store.messages.moderate(owner, Number(id), reporter, outcome);
    return status === 303 ? redirect(base) : reply(status);
  }
  const params = new URL(request.url, 'http://localhost').searchParams;
  const reviewed = params.get('reviewed') === 'yes';
  const mode = reviewed ? '&amp;reviewed=yes' : '';
  const offsetText = params.get('offset') ?? '';
  const offset = /^\d{1,9}$/.test(offsetText) ? Number(offsetText) : 0;
  const records = store.messages.moderationQueue(owner, reviewed, offset);
  if (!records) return reply(403);
  const title = t('Message reports', 'بلاغات الرسائل');
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  reply(200, {
    title, path,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>
      <nav class="project-tools">
        <a href="/workspace/settings?lang=${lang}">${t('Account security', 'أمان الحساب')}</a>
        <a href="${base}"${reviewed ? '' : ' aria-current="page"'}>${t('Pending reports', 'البلاغات المعلّقة')}</a>
        <a href="${base}&amp;reviewed=yes"${reviewed ? ' aria-current="page"' : ''}>${t('Reviewed reports', 'البلاغات المراجعة')}</a>
      </nav>
      ${records.length ? `<ul class="project-list message-list">${records.map((entry) => `<li class="provider-block">
        <h2>${t(...reportCategories[entry.category])}</h2>
        <small>${date.format(entry.reportedAt)}</small>
        <p dir="auto">${escapeHtml(entry.content)}</p>
        ${entry.outcome ? `<p>${t(...outcomes[entry.outcome])}</p>` : `<form class="project-tools" method="post" action="${base}">
          <input type="hidden" name="message" value="${entry.message}">
          <input type="hidden" name="reporter" value="${escapeHtml(entry.reporter)}">
          <button class="action" name="outcome" value="upheld">${t('Uphold report', 'اقبل البلاغ')}</button>
          <button class="action" name="outcome" value="dismissed">${t('Dismiss report', 'ارفض البلاغ')}</button>
        </form>`}
      </li>`).join('')}</ul>` : `<p>${t('No reports on this page.', 'لا توجد بلاغات في هذه الصفحة.')}</p>`}
      ${offset || records.length === 50 ? `<nav class="project-tools">
        ${offset ? `<a href="${base}${mode}&amp;offset=${Math.max(0, offset - 50)}">${t('Previous', 'السابق')}</a>` : ''}
        ${records.length === 50 ? `<a href="${base}${mode}&amp;offset=${offset + 50}">${t('Next', 'التالي')}</a>` : ''}
      </nav>` : ''}
    </section>`,
  });
}
