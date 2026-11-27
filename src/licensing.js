import { configurableModules } from './entitlements.js';
import { createLoginThrottle } from './login-throttle.js';
import { normalizeAddress, verifyPassword } from './password.js';
import { escapeHtml } from './workspace-view.js';

const institutionalActions = Object.freeze({
  'institution-member-add': ['Add member', 'أضف عضوًا'],
  'institution-member-remove': ['Remove member', 'أزل العضو'],
  'institution-seat-allocate': ['Allocate seat', 'خصّص مقعدًا'],
  'institution-seat-revoke': ['Revoke seat', 'ألغِ المقعد'],
});

const throttle = createLoginThrottle();
const states = {
  trial: ['Trial', 'تجريبية'], active: ['Active', 'نشطة'], grace: ['Grace period', 'فترة السماح'],
  past_due: ['Past due', 'متأخرة السداد'], expired: ['Expired', 'منتهية'], suspended: ['Suspended', 'معلّقة'],
  cancelled: ['Cancelled', 'ملغاة'], revoked: ['Revoked', 'مسحوبة'],
};
const audiences = {
  all: ['Individual or institutional', 'فردية أو مؤسسية'], individual: ['Individual', 'فردية'],
  team: ['Research team', 'فريق بحثي'], enterprise: ['Enterprise', 'شركات'],
  institutional: ['Institutional', 'مؤسسية'],
};

export const controlCenterPath = '/control-center';
export const billingRecordsPath = '/control-center/billing';
export const legacyLicensingPath = '/workspace/settings/licensing';

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

const billingLabels = {
  'invoice.issued': ['Invoice issued', 'صدرت فاتورة'],
  'payment.recorded': ['Payment recorded', 'سُجّلت دفعة'],
  'payment.refunded': ['Refund recorded', 'سُجّل رد المبلغ'],
  'subscription.renewed': ['Renewal recorded', 'سُجّل تجديد'],
  'subscription.cancelled': ['Cancellation recorded', 'سُجّل إلغاء'],
};

let invoiceRenderActive = false;

async function showInvoice({ reply, lang, account, store, query, reportRenderer, stillSignedIn }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const provider = query.get('provider') ?? '';
  const id = query.get('invoice') ?? '';
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(provider) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return reply(422);
  const invoice = store.billing.invoice(account.id, provider, id);
  if (!invoice) return reply(404);
  const title = t('Sandbox invoice', 'فاتورة تجريبية');
  const count = new Intl.NumberFormat(lang);
  const money = (amount) => count.format(amount) + ' ' + invoice.currency;
  const headers = [t('Description', 'الوصف'), t('Quantity', 'الكمية'), t('Unit price', 'سعر الوحدة'), t('Line total', 'إجمالي البند')];
  const rows = invoice.lines.map((line) => [line.description || t('Invoice amount', 'مبلغ الفاتورة'),
    count.format(line.quantity), money(line.unit_minor), money(line.quantity * line.unit_minor)]);
  const totals = [
    ...(invoice.discount ? [t('Discount', 'الخصم') + ' · ' + invoice.discount.code + ' · ' + money(invoice.discount.amount)] : []),
    t('Total', 'الإجمالي') + ' · ' + money(invoice.total),
    t('Outstanding', 'المبلغ المستحق') + ' · ' + money(invoice.outstanding),
    t('Amounts shown in minor units.', 'المبالغ معروضة بالوحدات الصغرى للعملة.'),
  ];
  if (query.get('format') === 'pdf') {
    if (!reportRenderer) return reply(503);
    if (invoiceRenderActive) return reply(429);
    invoiceRenderActive = true;
    try {
      const file = await reportRenderer({ lang, title, subtitle: provider + ' / ' + id,
        sections: [{ title: t('Line items', 'بنود الفاتورة'), headers, rows }, { title: t('Balance', 'الرصيد'), text: totals }],
      }, 'pdf');
      if (!stillSignedIn() || !store.billing.canReview(account.id)) return reply(403);
      return reply(200, null, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="sandbox-invoice.pdf"' }, file);
    } catch {
      return reply(503);
    } finally {
      invoiceRenderActive = false;
    }
  }
  const pdf = invoiceLink(lang, provider, id) + '&amp;format=pdf';
  return reply(200, { title, path: billingRecordsPath, controlCenter: true, billingOnly: true,
    html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>
      <p><bdi>${escapeHtml(provider)} / ${escapeHtml(id)}</bdi></p>
      <h2>${t('Line items', 'بنود الفاتورة')}</h2><ul>
      ${rows.map((row) => `<li>${row.map((cell) => `<bdi>${escapeHtml(cell)}</bdi>`).join(' · ')}</li>`).join('')}
      </ul>${totals.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
      <a href="${pdf}">${t('Download invoice PDF', 'نزّل الفاتورة بصيغة PDF')}</a>
      <a href="${billingRecordsPath}?lang=${lang}">${t('Billing records', 'سجلات الفوترة')}</a>
    </section>`,
  });
}

function invoiceLink(lang, provider, id) {
  return billingRecordsPath + '?lang=' + lang + '&amp;provider=' + encodeURIComponent(provider) + '&amp;invoice=' + encodeURIComponent(id);
}

export async function handleBillingRecords({ request, reply, lang, account, store, reportRenderer, stillSignedIn }) {
  if (!store.billing.canReview(account.id)) return reply(403);
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const query = new URL(request.url, 'http://localhost').searchParams;
  if (query.has('invoice')) return showInvoice({ reply, lang, account, store, query, reportRenderer, stillSignedIn });
  const page = whole(query.get('page') ?? '0');
  if (!Number.isInteger(page) || page > 10_000) return reply(422);
  const records = store.billing.records(account.id, page * 50);
  if (!records) return reply(403);
  const count = new Intl.NumberFormat(lang);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const pageLink = (number) => billingRecordsPath + '?lang=' + lang + '&amp;page=' + number;
  const title = t('Sandbox billing records', 'سجلات الفوترة التجريبية');
  reply(200, { title, path: billingRecordsPath, controlCenter: true, billingOnly: true,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>
      ${records.length ? `<ol class="activity">${records.slice(0, 50).map((event) => `<li>
        ${t(...billingLabels[event.kind])} · <bdi>${escapeHtml(event.provider)}</bdi> ·
        <bdi>${event.kind === 'invoice.issued' ? `<a href="${invoiceLink(lang, event.provider, event.objectId)}">${escapeHtml(event.objectId)}</a>`
          : escapeHtml(event.objectId)}</bdi>
        ${event.invoiceId ? ` · <a href="${invoiceLink(lang, event.provider, event.invoiceId)}">${escapeHtml(event.invoiceId)}</a>` : ''}
        ${event.paymentId ? ` · <bdi>${escapeHtml(event.paymentId)}</bdi>` : ''}
        ${event.amountMinor === undefined ? '' : ` · <bdi>${count.format(event.amountMinor)} ${escapeHtml(event.currency)}</bdi> ${t('minor units', 'وحدة صغرى')}`}
        · <time>${date.format(event.recordedAt)} UTC</time></li>`).join('')}</ol>`
        : `<p>${t('No verified sandbox billing records on this page.', 'لا توجد سجلات فوترة تجريبية متحققة في هذه الصفحة.')}</p>`}
      ${page > 0 ? `<a href="${pageLink(page - 1)}">${t('Previous page', 'الصفحة السابقة')}</a>` : ''}
      ${records.length > 50 && page < 10_000 ? `<a href="${pageLink(page + 1)}">${t('Next page', 'الصفحة التالية')}</a>` : ''}
    </section>`,
  });
}

export async function handleLicensing({ request, reply, redirect, lang, account, token, form, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const data = store.licensing.dashboard(account.id);
  if (!data) return reply(403);
  const path = new URL(request.url, 'http://localhost').pathname === legacyLicensingPath
    ? legacyLicensingPath : controlCenterPath;
  const url = path + '?lang=' + lang;
  let status = 200;
  if (form) {
    const code = (form.get('plan') ?? '').trim();
    const intent = form.get('intent');
    if (!['save', 'assign', 'transition', 'complimentary', 'override', 'trial', 'modules', 'pricing', 'discount-create', 'discount-revoke', 'institution-create',
      'institution-assign', 'institution-trial', 'institution-transition', 'institution-sponsor', 'institution-override'].includes(intent) &&
      !Object.hasOwn(institutionalActions, intent)) return reply(422);
    const retryAfter = throttle.begin(request.socket.remoteAddress ?? '', account.email);
    if (retryAfter) return reply(429, null, { 'Retry-After': String(retryAfter) });
    try {
      const password = form.get('password') ?? '';
      const credentials = store.credentials(account.email);
      if (password.length > 128 || !await verifyPassword(password, credentials) ||
          store.session(token)?.id !== account.id) return reply(403);
      const optional = (field) => form.get(field) ? whole(form.get(field)) : null;
      const institution = (form.get('institution') ?? '').trim();
      const reason = (form.get('reason') ?? '').trim();
      const promo = (form.get('discount-code') ?? '').trim().toUpperCase();
      if (intent === 'discount-create') {
        status = store.billing.createDiscount(account.id, {
          code: promo, kind: form.get('discount-kind'), value: whole(form.get('discount-value')),
          currency: (form.get('currency') ?? '').trim().toUpperCase(), plan: code,
          expires: endDate(form.get('expires')), limit: whole(form.get('discount-limit')),
        });
      } else if (intent === 'discount-revoke') {
        status = store.billing.revokeDiscount(account.id, promo);
      } else if (intent === 'institution-create') {
        status = store.licensing.createOrganization(account.id, institution, (form.get('institution-name') ?? '').trim());
      } else if (['institution-assign', 'institution-trial', 'institution-sponsor'].includes(intent)) {
        status = store.licensing.assignInstitution(account.id, institution, code, endDate(form.get('expires')),
          intent === 'institution-trial' ? 'trial' : 'active', intent === 'institution-sponsor' ? reason : null);
      } else if (intent === 'institution-transition' || intent === 'institution-override') {
        status = store.licensing.transitionInstitution(account.id, institution, form.get('current-state'),
          form.get('next-state'), endDate(form.get('expires')), intent === 'institution-override' ? reason : null);
      } else if (Object.hasOwn(institutionalActions, intent)) {
        const email = normalizeAddress(form.get('email') ?? '');
        status = intent.startsWith('institution-member')
          ? store.licensing.changeInstitutionMember(account.id, institution, email, intent.endsWith('-add'))
          : store.licensing.changeInstitutionSeat(account.id, institution, email, intent.endsWith('-allocate'));
      } else if (intent === 'modules') {
        status = store.licensing.saveModules(account.id, code, form.getAll('module').map(whole), form.get('previous'));
      } else if (intent === 'pricing') {
        status = store.licensing.setPricing(account.id, code, (form.get('currency') ?? '').trim().toUpperCase(),
          optional('monthly-minor'), optional('annual-minor'));
      } else if (intent === 'save') {
        status = store.licensing.save(account.id, code, whole(form.get('project-limit')), whole(form.get('ai-tokens')),
          optional('storage-mib'), optional('daily-reports'), optional('institutional-seats'), form.get('audience') || null);
      } else {
        const email = normalizeAddress(form.get('email') ?? '');
        const expiresAt = endDate(form.get('expires'));
        status = intent === 'transition' || intent === 'override'
          ? store.licensing.transition(account.id, email, form.get('current-state'), form.get('next-state'), expiresAt,
            intent === 'override' ? reason : null)
          : store.licensing.assign(account.id, email, code, expiresAt, intent === 'trial' ? 'trial' : 'active',
            intent === 'complimentary' ? reason : null);
      }
    } finally {
      throttle.finish();
    }
    if (status === 303) return redirect(url);
  }
  const title = t('Plans and entitlements', 'الخطط والصلاحيات');
  const count = new Intl.NumberFormat(lang);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const stateOptions = Object.entries(states).map(([value, labels]) => `<option value="${value}">${t(...labels)}</option>`).join('');
  const passwordField = `<label>${t('Current password', 'كلمة المرور الحالية')}<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>`;
  const reasonField = `<label>${t('Reason for promotional grants or overrides', 'سبب المنح الترويجية أو التجاوزات')}
    <input name="reason" maxlength="200"></label>`;
  const moduleForms = data.plans.map(({ code, modules }) => `
    <form class="workspace-form" method="post" action="${url}">
      <input name="plan" type="hidden" value="${escapeHtml(code)}">
      <input name="previous" type="hidden" value="${modules.join(',')}">
      <fieldset><legend>${t('Module access', 'الوصول إلى الوحدات')} · <bdi>${escapeHtml(code)}</bdi></legend>
        <div class="module-permission-options">${configurableModules.map((module) =>
          `<label><input name="module" type="checkbox" value="${module}"${modules.includes(module) ? ' checked' : ''}> <bdi>NRI-${String(module).padStart(2, '0')}</bdi></label>`).join('')}</div>
      </fieldset>
      ${passwordField}<button class="action" name="intent" value="modules">${t('Save module access', 'احفظ الوصول إلى الوحدات')}</button>
    </form>`).join('');
  const planPrices = data.plans.map(({ code, currency, monthly_minor, annual_minor }) => `
    <form class="workspace-form" method="post" action="${url}">
      <input type="hidden" name="plan" value="${escapeHtml(code)}">
      <fieldset>
        <legend><bdi>${escapeHtml(code)}</bdi></legend>
        <label>${t('ISO currency code', 'رمز العملة الدولي')}<input name="currency" value="${currency ?? ''}" maxlength="3" pattern="[a-zA-Z]{3}" dir="ltr"></label>
        <label>${t('Monthly price in minor units', 'السعر الشهري بالوحدات الصغرى للعملة')}<input name="monthly-minor" type="number" value="${monthly_minor ?? ''}" min="0" max="9999999999"></label>
        <label>${t('Annual price in minor units', 'السعر السنوي بالوحدات الصغرى للعملة')}<input name="annual-minor" type="number" value="${annual_minor ?? ''}" min="0" max="9999999999"></label>
      </fieldset>
      ${passwordField}<button class="action" name="intent" value="pricing">${t('Save pricing', 'احفظ الأسعار')}</button>
    </form>`).join('');
  const discountList = store.billing.discounts(account.id);
  const discountForm = `<h2>${t('Discount codes', 'رموز الخصم')}</h2>
    <form class="workspace-form" method="post" action="${url}">
      <label>${t('Discount code', 'رمز الخصم')}<input name="discount-code" maxlength="32" required dir="ltr"></label>
      <label>${t('Type', 'النوع')}<select name="discount-kind"><option value="percent">${t('Percentage', 'نسبة مئوية')}</option>
        <option value="fixed">${t('Fixed amount', 'مبلغ ثابت')}</option></select></label>
      <label>${t('Value (basis points for percentages, minor units for fixed amounts)', 'القيمة (نقاط أساس للنسبة، ووحدات صغرى للمبلغ الثابت)')}
        <input name="discount-value" type="number" min="1" max="9999999999" required></label>
      <label>${t('ISO currency code for fixed amounts', 'رمز العملة الدولي للمبلغ الثابت')}<input name="currency" maxlength="3" dir="ltr"></label>
      <label>${t('Eligible plan', 'الخطة المؤهلة')}<select name="plan"><option value="">${t('Any plan', 'أي خطة')}</option>
        ${data.plans.map(({ code }) => `<option>${escapeHtml(code)}</option>`).join('')}</select></label>
      <label>${t('Expiry (UTC)', 'انتهاء الصلاحية بتوقيت UTC')}<input name="expires" type="date" required></label>
      <label>${t('Redemption limit', 'الحد الأقصى للاستخدام')}<input name="discount-limit" type="number" min="1" max="10000" required></label>
      ${passwordField}<button class="action" name="intent" value="discount-create">${t('Create discount', 'أنشئ خصمًا')}</button>
    </form>
    ${discountList.length ? `<ul class="activity">${discountList.map((item) => `<li><bdi>${escapeHtml(item.code)}</bdi> ·
      <bdi>${count.format(item.redeemed)} / ${count.format(item.redemption_limit)}</bdi> ·
      ${item.revoked_at !== null ? t('Revoked', 'ملغى') : `<time>${date.format(item.expires_at)} UTC</time>`}</li>`).join('')}</ul>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Discount code', 'رمز الخصم')}<input name="discount-code" maxlength="32" required dir="ltr"></label>
        ${passwordField}<button class="action" name="intent" value="discount-revoke">${t('Revoke discount', 'ألغِ الخصم')}</button>
      </form>` : ''}`;
  const institutionSelect = `<label>${t('Organization', 'المؤسسة')}<select name="institution" required>
    ${data.organizations.map(({ code, name }) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} · ${escapeHtml(code)}</option>`).join('')}
    </select></label>`;
  const institutionPlans = data.plans.filter(({ institutional_seats, audience }) => institutional_seats !== null && audience !== 'individual');
  const individualPlans = data.plans.filter(({ audience }) => ['all', 'individual'].includes(audience));
  const organizations = `
    <h2 id="organizations">${t('Organizations and seats', 'المؤسسات والمقاعد')}</h2>
    <form class="workspace-form" method="post" action="${url}">
      <label>${t('Organization code', 'رمز المؤسسة')}<input name="institution" maxlength="31" required dir="ltr"></label>
      <label>${t('Organization name', 'اسم المؤسسة')}<input name="institution-name" maxlength="100" required></label>
      ${passwordField}<button class="action" name="intent" value="institution-create">${t('Create organization', 'أنشئ مؤسسة')}</button>
    </form>
    ${data.organizations.length ? `
      <ul class="project-list">${data.organizations.map((item) => `<li><bdi>${escapeHtml(item.name)}</bdi> ·
        <bdi>${escapeHtml(item.code)}</bdi> · ${item.plan ? `<bdi>${escapeHtml(item.plan)}</bdi> · ${t(...states[item.state])} ·
        ${t('Allocated seats', 'المقاعد المخصصة')} <bdi>${count.format(item.seats)} / ${count.format(item.institutional_seats ?? 0)}</bdi>
        ${item.expires_at === null ? '' : ` · <time>${date.format(item.expires_at)} UTC</time>`}`
        : t('Unassigned', 'بلا اشتراك')}</li>`).join('')}</ul>
      ${institutionPlans.length ? `<form class="workspace-form" method="post" action="${url}">
        ${institutionSelect}
        <label>${t('Institutional plan', 'الخطة المؤسسية')}<select name="plan" required>
          ${institutionPlans.map(({ code }) => `<option>${escapeHtml(code)}</option>`).join('')}</select></label>
        <label>${t('Expiry date (UTC, required for trials)', 'تاريخ الانتهاء (UTC، مطلوب للتجربة)')}<input name="expires" type="date"></label>
        ${reasonField}${passwordField}
        <button class="action" name="intent" value="institution-assign">${t('Assign institutional plan', 'عيّن خطة مؤسسية')}</button>
        <button class="action" name="intent" value="institution-sponsor">${t('Grant sponsorship', 'امنح رعاية مؤسسية')}</button>
        <button class="action" name="intent" value="institution-trial">${t('Start institutional trial', 'ابدأ تجربة مؤسسية')}</button>
      </form>` : ''}
      <form class="workspace-form" method="post" action="${url}">
        ${institutionSelect}
        <label>${t('Account email', 'البريد الإلكتروني للحساب')}<input name="email" type="email" maxlength="254" required dir="ltr"></label>
        ${passwordField}
        ${Object.entries(institutionalActions).map(([intent, labels]) => `<button class="action" name="intent" value="${intent}">${t(...labels)}</button>`).join('')}
      </form>
      ${data.organizations.some(({ plan }) => plan) ? `<form class="workspace-form" method="post" action="${url}">
        ${institutionSelect}
        <label>${t('Current state', 'الحالة الحالية')}<select name="current-state">${stateOptions}</select></label>
        <label>${t('New state', 'الحالة الجديدة')}<select name="next-state">${stateOptions}</select></label>
        <label>${t('New expiry (UTC, required for grace)', 'تاريخ الانتهاء الجديد (UTC، مطلوب لفترة السماح)')}<input name="expires" type="date"></label>
        ${reasonField}${passwordField}<button class="action" name="intent" value="institution-transition">${t('Change institutional subscription status', 'غيّر حالة الاشتراك المؤسسي')}</button>
        <button class="action" name="intent" value="institution-override">${t('Apply institutional override', 'طبّق تجاوزًا مؤسسيًا')}</button>
      </form>` : ''}
    ` : ''}
    ${data.institutionalHistory.length ? `<h3>${t('Organization audit history', 'سجل تدقيق المؤسسات')}</h3>
      <ol class="activity">${data.institutionalHistory.map((item) => `<li><bdi>${escapeHtml(item.organization)}</bdi> ·
        ${escapeHtml(item.action)} · <bdi>${escapeHtml(item.actor ?? '')}</bdi>
        ${item.subject ? `· <bdi>${escapeHtml(item.subject)}</bdi>` : ''} · <time>${date.format(item.recorded_at)} UTC</time></li>`).join('')}</ol>` : ''}
  `;
  reply(status, {
    title, path, controlCenter: true,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>
      <p><a href="${billingRecordsPath}?lang=${lang}">${t('Sandbox billing records', 'سجلات الفوترة التجريبية')}</a></p>
      <p>${t('Assign plans and limits for this workspace.', 'عيّن الخطط والحدود لمساحة العمل هذه.')}</p>
      ${status === 422 ? `<p role="alert">${t('Check the plan, limits, and account information.', 'تحقق من الخطة والحدود وبيانات الحساب.')}</p>` : ''}
      ${status === 409 ? `<p role="alert">${t('The subscription or plan changed, or this action is unavailable.', 'تغيّر الاشتراك أو الخطة، أو أن الإجراء غير متاح.')}</p>` : ''}
      <dl class="reference-meta" id="overview">
        <div><dt>${t('Accounts', 'الحسابات')}</dt><dd>${count.format(data.metrics.accounts)}</dd></div>
        <div><dt>${t('Projects', 'المشاريع')}</dt><dd>${count.format(data.metrics.projects)}</dd></div>
        <div><dt>${t('Active assignments', 'التعيينات النشطة')}</dt><dd>${count.format(data.metrics.active)}</dd></div>
      </dl>
      <h2 id="plans">${t('Save a plan', 'حفظ خطة')}</h2>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Plan code', 'رمز الخطة')}<input name="plan" required maxlength="31" pattern="[a-z][a-z0-9\\-]{1,30}" dir="ltr"></label>
        <label>${t('Maximum owned projects', 'الحد الأقصى للمشاريع المملوكة')}<input name="project-limit" type="number" required min="0" max="10000"></label>
        <label>${t('Daily external AI tokens', 'الحد اليومي لرموز الذكاء الاصطناعي الخارجي')}<input name="ai-tokens" type="number" required min="0" max="1000000000"></label>
        <label>${t('PDF storage limit in MiB (optional)', 'حد تخزين PDF بالميبي بايت (اختياري)')}<input name="storage-mib" type="number" min="0" max="1048576"></label>
        <label>${t('Daily report exports (optional)', 'عدد تصديرات التقارير يوميًا (اختياري)')}<input name="daily-reports" type="number" min="0" max="10000"></label>
        <label>${t('Institutional seats (optional)', 'المقاعد المؤسسية (اختياري)')}<input name="institutional-seats" type="number" min="1" max="10000"></label>
        <label>${t('Plan audience', 'الفئة المستهدفة')}<select name="audience">
          <option value="">${t('Keep current or use default', 'احتفظ بالإعداد الحالي أو استخدم الافتراضي')}</option>
          ${Object.entries(audiences).map(([value, labels]) => `<option value="${value}">${t(...labels)}</option>`).join('')}
        </select></label>
        ${passwordField}<button class="action" name="intent" value="save">${t('Save plan', 'احفظ الخطة')}</button>
      </form>
      ${data.plans.length ? `<ul class="project-list">${data.plans.map((item) => `<li><bdi>${escapeHtml(item.code)}</bdi> · ${t(...audiences[item.audience])} ·
        ${t('PDF storage','تخزين PDF')} <bdi>${item.storage_mib === null ? t('Unlimited','غير محدود') : count.format(item.storage_mib) + ' MiB'}</bdi> ·
        ${t('Daily reports','التقارير اليومية')} <bdi>${item.daily_reports === null ? t('Unlimited','غير محدودة') : count.format(item.daily_reports)}</bdi> ·
        ${t('Institutional seats','المقاعد المؤسسية')} <bdi>${item.institutional_seats === null ? t('Unset','غير محددة') : count.format(item.institutional_seats)}</bdi></li>`).join('')}</ul>` : ''}
      ${individualPlans.length ? `<h2>${t('Assign a plan', 'تعيين خطة')}</h2>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Account email', 'البريد الإلكتروني للحساب')}<input name="email" type="email" maxlength="254" required dir="ltr"></label>
        <label>${t('Plan', 'الخطة')}<select name="plan">${individualPlans.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} · ${count.format(item.project_limit)} / ${count.format(item.daily_ai_tokens)}</option>`).join('')}</select></label>
        <label>${t('Expiry date (UTC, optional)', 'تاريخ الانتهاء (UTC، اختياري)')}<input name="expires" type="date"></label>
        ${reasonField}${passwordField}<button class="action" name="intent" value="assign">${t('Assign plan', 'عيّن الخطة')}</button>
        <button class="action" name="intent" value="complimentary">${t('Grant complimentary subscription', 'امنح اشتراكًا مجانيًا')}</button>
      </form>` : ''}
      ${data.plans.length ? `<h2 id="plan-pricing">${t('Plan pricing', 'أسعار الخطط')}</h2>
        <p>${t('Leave all pricing fields empty to clear pricing for a plan.', 'اترك حقول الأسعار فارغة لإلغاء تسعير الخطة.')}</p>
        ${planPrices}` : ''}
      ${moduleForms}
      ${organizations}
      ${discountForm}
      ${individualPlans.length ? `<h2>${t('Start a trial', 'ابدأ فترة تجريبية')}</h2>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Account email', 'البريد الإلكتروني للحساب')}<input name="email" type="email" maxlength="254" required dir="ltr"></label>
        <label>${t('Plan', 'الخطة')}<select name="plan">${individualPlans.map((item) => `<option>${escapeHtml(item.code)}</option>`).join('')}</select></label>
        <label>${t('Expiry date (UTC)', 'تاريخ الانتهاء (UTC)')}<input name="expires" type="date" required></label>
        ${passwordField}<button class="action" name="intent" value="trial">${t('Start trial', 'ابدأ التجربة')}</button>
      </form>` : ''}
      ${data.subscriptions.length ? `<h2>${t('Subscriptions', 'الاشتراكات')}</h2>
      <ul>${data.subscriptions.map((item) => `<li><bdi>${escapeHtml(item.email)}</bdi> · <bdi>${escapeHtml(item.plan)}</bdi> · ${t(...states[item.state])}</li>`).join('')}</ul>
      <form class="workspace-form" method="post" action="${url}">
        <label>${t('Account email', 'البريد الإلكتروني للحساب')}<input name="email" type="email" maxlength="254" required dir="ltr"></label>
        <label>${t('Current state', 'الحالة الحالية')}<select name="current-state">${stateOptions}</select></label>
        <label>${t('New state', 'الحالة الجديدة')}<select name="next-state">${stateOptions}</select></label>
        <label>${t('New expiry (UTC, required for grace)', 'تاريخ الانتهاء الجديد (UTC، مطلوب لفترة السماح)')}<input name="expires" type="date"></label>
        ${reasonField}${passwordField}<button class="action" name="intent" value="transition">${t('Change subscription status', 'غيّر حالة الاشتراك')}</button>
        <button class="action" name="intent" value="override">${t('Apply subscription override', 'طبّق تجاوز الاشتراك')}</button>
      </form>` : ''}
      ${data.recent.length ? `<h2>${t('Recent changes', 'آخر التغييرات')}</h2><ol class="activity">${data.recent.map((item) => `<li>
        ${item.action === 'assigned' ? t('Assigned', 'تم التعيين') : item.action === 'plan-saved' ? t('Plan saved', 'حُفظت الخطة') : escapeHtml(item.action)} · <bdi>${escapeHtml(item.plan)}</bdi>
        · <bdi>${escapeHtml(item.actor ?? '')}</bdi> ${item.subject ? `· <bdi>${escapeHtml(item.subject)}</bdi>` : ''}
        · <time>${date.format(item.recorded_at)} UTC</time></li>`).join('')}</ol>` : ''}
    </section>`,
  });
}
