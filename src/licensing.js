import { normalizeAddress } from './password.js';
import { escapeHtml } from './workspace-view.js';

const path = '/workspace/settings/licensing';

function whole(value) {
  return /^\d{1,10}$/.test(value ?? '') ? Number(value) : NaN;
}

function endDate(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return NaN;
  return date.getTime();
}

export function handleLicensing({ reply, redirect, lang, account, form, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const data = store.licensing.dashboard(account.id);
  if (!data) return reply(403);
  const url = path + '?lang=' + lang;
  let status = 200;
  if (form) {
    const code = (form.get('plan') ?? '').trim();
    const intent = form.get('intent');
    if (intent === 'save') status = store.licensing.save(account.id, code, whole(form.get('project-limit')), whole(form.get('ai-tokens')), form.get('storage-mib') ? whole(form.get('storage-mib')) : null,
      form.get('daily-reports') ? whole(form.get('daily-reports')) : null);
    else if (intent === 'assign') status = store.licensing.assign(account.id, normalizeAddress(form.get('email') ?? ''),
      code, endDate(form.get('expires')));
    else status = 422;
    if (status === 303) return redirect(url);
  }
  const title = t('Plans and entitlements', 'الخطط والصلاحيات');
  const count = new Intl.NumberFormat(lang);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  reply(status, {
    title, path,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>
      <p><a href="/workspace/settings?lang=${lang}">${t('Account security', 'أمان الحساب')}</a></p>
      <p>${t('Assign plans and limits for this workspace.', 'عيّن الخطط والحدود لمساحة العمل هذه.')}</p>
      ${status === 422 ? `<p role="alert">${t('Check the plan, limits, and account information.', 'تحقق من الخطة والحدود وبيانات الحساب.')}</p>` : ''}
      <dl class="reference-meta">
        <div><dt>${t('Accounts', 'الحسابات')}</dt><dd>${count.format(data.metrics.accounts)}</dd></div>
        <div><dt>${t('Projects', 'المشاريع')}</dt><dd>${count.format(data.metrics.projects)}</dd></div>
        <div><dt>${t('Active assignments', 'التعيينات النشطة')}</dt><dd>${count.format(data.metrics.active)}</dd></div>
      </dl>
      <h2>${t('Save a plan', 'حفظ خطة')}</h2>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Plan code', 'رمز الخطة')}<input name="plan" required maxlength="31" pattern="[a-z][a-z0-9\\-]{1,30}" dir="ltr"></label>
        <label>${t('Maximum owned projects', 'الحد الأقصى للمشاريع المملوكة')}<input name="project-limit" type="number" required min="0" max="10000"></label>
        <label>${t('Daily external AI tokens', 'الحد اليومي لرموز الذكاء الاصطناعي الخارجي')}<input name="ai-tokens" type="number" required min="0" max="1000000000"></label>
        <label>${t('PDF storage limit in MiB (optional)', 'حد تخزين PDF بالميبي بايت (اختياري)')}<input name="storage-mib" type="number" min="0" max="1048576"></label>
        <label>${t('Daily report exports (optional)', 'عدد تصديرات التقارير يوميًا (اختياري)')}<input name="daily-reports" type="number" min="0" max="10000"></label>
        <button class="action" name="intent" value="save">${t('Save plan', 'احفظ الخطة')}</button>
      </form>
      ${data.plans.length ? `<ul class="project-list">${data.plans.map((item) => `<li><bdi>${escapeHtml(item.code)}</bdi> ·
        ${t('PDF storage','تخزين PDF')} <bdi>${item.storage_mib === null ? t('Unlimited','غير محدود') : count.format(item.storage_mib) + ' MiB'}</bdi> ·
        ${t('Daily reports','التقارير اليومية')} <bdi>${item.daily_reports === null ? t('Unlimited','غير محدودة') : count.format(item.daily_reports)}</bdi></li>`).join('')}</ul><h2>${t('Assign a plan', 'تعيين خطة')}</h2>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Account email', 'البريد الإلكتروني للحساب')}<input name="email" type="email" maxlength="254" required dir="ltr"></label>
        <label>${t('Plan', 'الخطة')}<select name="plan">${data.plans.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} · ${count.format(item.project_limit)} / ${count.format(item.daily_ai_tokens)}</option>`).join('')}</select></label>
        <label>${t('Expiry date (UTC, optional)', 'تاريخ الانتهاء (UTC، اختياري)')}<input name="expires" type="date"></label>
        <button class="action" name="intent" value="assign">${t('Assign plan', 'عيّن الخطة')}</button>
      </form>` : ''}
      ${data.recent.length ? `<h2>${t('Recent changes', 'آخر التغييرات')}</h2><ol class="activity">${data.recent.map((item) => `<li>
        ${item.action === 'assigned' ? t('Assigned', 'تم التعيين') : t('Plan saved', 'حُفظت الخطة')} · <bdi>${escapeHtml(item.plan)}</bdi>
        · <bdi>${escapeHtml(item.actor ?? '')}</bdi> ${item.subject ? `· <bdi>${escapeHtml(item.subject)}</bdi>` : ''}
        · <time>${date.format(item.recorded_at)} UTC</time></li>`).join('')}</ol>` : ''}
    </section>`,
  });
}
