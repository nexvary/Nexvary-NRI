import { documentHeaders } from './documents.js';
import { escapeHtml } from './workspace-view.js';
import { verifyPassword } from './password.js';

const path = '/workspace/settings/privacy';

export function createPrivacyHandler(store) {
  const attempts = new Map();
  let inFlight = 0;
  return async function handle({ request, reply, redirect, lang, account, token, form, expiredCookie }) {
    const t = (en, ar) => lang === 'ar' ? ar : en;
    const query = new URL(request.url, 'http://localhost').searchParams;
    const page = query.get('page') ?? '0';
    if (!/^\d{1,5}$/.test(page) || Number(page) > 10_000) return reply(422);
    const url = path + '?lang=' + lang;
    const pageLink = (number) => url + '&amp;page=' + number;
    let status = 200;
    if (form) {
      const intent = form.get('intent');
      if (!['export', 'export-document', 'delete'].includes(intent)) return reply(422);
      const selection = intent === 'export-document'
        ? /^([0-9a-f-]{36}):([0-9a-f-]{36}):([1-9][0-9]{0,8})$/.exec(form.get('version') ?? '')
        : undefined;
      if (intent === 'export-document' && !selection) return reply(422);
      if (intent === 'delete' && form.get('confirm') !== 'DELETE') return reply(422);
      const now = Date.now();
      for (const [owner, attempt] of attempts) {
        if (now - attempt.start >= 60_000) attempts.delete(owner);
      }
      const attempt = attempts.get(account.id) ?? { start: now, count: 0 };
      if (inFlight >= 2 || attempt.count >= 5 || (!attempts.has(account.id) && attempts.size >= 200)) {
        return reply(429, null, { 'Retry-After': '60' });
      }
      attempt.count++;
      attempts.set(account.id, attempt);
      const password = form.get('password') ?? '';
      inFlight++;
      let valid;
      try {
        valid = password.length <= 128 && await verifyPassword(password, store.credentials(account.email));
      } finally {
        inFlight--;
      }
      if (!valid) status = 401;
      else {
        const proof = (form.get('code') ?? '').slice(0, 32);
        const result = selection
          ? store.exportDocument(account.id, token, proof, selection[1], selection[2], Number(selection[3]))
          : store.privacyAction(account.id, token, proof, intent);
        status = result.status;
        if (result.file) return reply(200, null, documentHeaders(result.file, Number(selection[3])), result.file.bytes);
        if (status === 303) return redirect('/login?lang=' + lang, { 'Set-Cookie': expiredCookie });
        if (status === 200) return reply(200, null, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="nri-account-export.json"',
        }, result.body);
      }
    }
    const title = t('Account data and privacy', 'بيانات الحساب والخصوصية');
    const password = `<label>${t('Current password', 'كلمة المرور الحالية')}<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>`;
    const code = store.mfa.enabled(account.id) ? `<label>${t('Authenticator or recovery code', 'رمز المصادقة أو الاسترداد')}<input name="code" dir="ltr" required maxlength="19" autocomplete="one-time-code"></label>` : '';
    const versions = store.documents.exportable(account.id, Number(page) * 50);
    reply(status, {
      title, path,
      html: `<section class="surface panel detail workspace-page">
        <h1>${title}</h1>
        <p><a href="/workspace/settings?lang=${lang}">${t('Account security', 'أمان الحساب')}</a></p>
        ${status === 401 ? `<p role="alert">${t('Check your password and verification code.', 'تحقق من كلمة المرور ورمز التحقق.')}</p>` : ''}
        ${status === 403 ? `<p role="alert">${t('Sign in again to continue.', 'سجّل الدخول مرة أخرى للمتابعة.')}</p>` : ''}
        ${status === 413 ? `<p role="alert">${t('This account exceeds the 64 MiB archive limit. Download owned document versions individually below.', 'يتجاوز هذا الحساب حد الأرشيف البالغ ٦٤ ميبي بايت. نزّل إصدارات مستنداتك بشكل منفرد أدناه.')}</p>` : ''}
        ${status === 404 ? `<p role="alert">${t('This document version is unavailable.', 'إصدار المستند غير متاح.')}</p>` : ''}
        <h2>${t('Export account data', 'تصدير بيانات الحساب')}</h2>
        <p>${t('Download your records and owned document versions as JSON. Keep the download private.', 'نزّل سجلاتك وإصدارات مستنداتك بصيغة JSON. احفظ التنزيل في مكان خاص.')}</p>
        <form class="workspace-form" method="post" action="${path}?lang=${lang}">${password}${code}
          <button class="action" name="intent" value="export">${t('Download export', 'نزّل التصدير')}</button>
        </form>
        ${versions.length ? `<h2 id="document-versions">${t('Export individual document versions', 'تصدير إصدارات المستندات منفردة')}</h2>
          <form class="workspace-form" method="post" action="${pageLink(Number(page))}">
            <label>${t('Owned document version', 'إصدار المستند المملوك')}<select name="version" required>
            ${versions.slice(0, 50).map((item) => `<option value="${escapeHtml(item.project_id)}:${escapeHtml(item.document_id)}:${item.number}">
              ${escapeHtml(item.project_title)} · ${escapeHtml(item.filename)} · ${item.number}</option>`).join('')}
            </select></label>
            ${password}${code}
            <button class="action" name="intent" value="export-document">${t('Download document version', 'نزّل إصدار المستند')}</button>
          </form>` : ''}
        ${Number(page) > 0 ? `<a href="${pageLink(Number(page) - 1)}#document-versions">${t('Previous page', 'الصفحة السابقة')}</a>` : ''}
        ${versions.length > 50 && Number(page) < 10_000 ? `<a href="${pageLink(Number(page) + 1)}#document-versions">${t('Next page', 'الصفحة التالية')}</a>` : ''}
        <h2>${t('Delete account', 'حذف الحساب')}</h2>
        <p>${t('This permanently removes your live account, sessions, owned projects, and conversations for both participants. Existing backups may still contain your data.', 'يحذف هذا الإجراء حسابك النشط وجلساتك ومشاريعك ومحادثاتك لدى الطرفين نهائيًا. قد تبقى بياناتك في النسخ الاحتياطية الموجودة.')}</p>
        <form class="workspace-form" method="post" action="${path}?lang=${lang}">${password}${code}
          <label>${t('Type DELETE to confirm', 'اكتب DELETE للتأكيد')}<input name="confirm" dir="ltr" pattern="DELETE" required autocomplete="off"></label>
          <button class="action danger" name="intent" value="delete">${t('Permanently delete account', 'احذف الحساب نهائيًا')}</button>
        </form>
      </section>`,
    });
  };
}
