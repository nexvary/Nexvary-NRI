import { verifyPassword } from './password.js';

const path = '/workspace/settings/privacy';

export function createPrivacyHandler(store) {
  const attempts = new Map();
  let inFlight = 0;
  return async function handle({ reply, redirect, lang, account, token, form, expiredCookie }) {
    const t = (en, ar) => lang === 'ar' ? ar : en;
    let status = 200;
    if (form) {
      const intent = form.get('intent');
      if (intent !== 'export' && intent !== 'delete') return reply(422);
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
        const result = store.privacyAction(account.id, token, (form.get('code') ?? '').slice(0, 32), intent);
        status = result.status;
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
    reply(status, {
      title, path,
      html: `<section class="surface panel detail workspace-page">
        <h1>${title}</h1>
        <p><a href="/workspace/settings?lang=${lang}">${t('Account security', 'أمان الحساب')}</a></p>
        ${status === 401 ? `<p role="alert">${t('Check your password and verification code.', 'تحقق من كلمة المرور ورمز التحقق.')}</p>` : ''}
        ${status === 403 ? `<p role="alert">${t('Sign in again to continue.', 'سجّل الدخول مرة أخرى للمتابعة.')}</p>` : ''}
        ${status === 413 ? `<p role="alert">${t('This account exceeds the 64 MiB export limit. Download large files from the project library individually.', 'يتجاوز هذا الحساب حد التصدير البالغ ٦٤ ميبي بايت. نزّل الملفات الكبيرة من مكتبة المشروع بشكل منفرد.')}</p>` : ''}
        <h2>${t('Export account data', 'تصدير بيانات الحساب')}</h2>
        <p>${t('Download your records and owned document versions as JSON. Keep the download private.', 'نزّل سجلاتك وإصدارات مستنداتك بصيغة JSON. احفظ التنزيل في مكان خاص.')}</p>
        <form class="workspace-form" method="post" action="${path}?lang=${lang}">${password}${code}
          <button class="action" name="intent" value="export">${t('Download export', 'نزّل التصدير')}</button>
        </form>
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
