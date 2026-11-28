import { hashPassword, normalizeAddress } from './password.js';
import { createLoginThrottle } from './login-throttle.js';
import { escapeHtml } from './workspace-view.js';

export function createPasswordRecoveryHandler(store) {
  const throttle = createLoginThrottle();
  return async function handle({ request, reply, lang, form }) {
    const ar = lang === 'ar';
    const t = (en, arabic) => ar ? arabic : en;
    const title = t('Recover account access', 'استعادة الوصول إلى الحساب');
    const emailValue = form?.get('email') ?? '';
    const page = (status, notice = '') => reply(status, {
      title, path: '/recover',
      html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>
        <p>${t('Password recovery is available for accounts with two-step verification enabled. Use an authenticator code or an unused recovery code.', 'تتوفر استعادة كلمة المرور للحسابات التي فعّلت التحقق بخطوتين. استخدم رمز تطبيق المصادقة أو رمز استرداد لم يُستخدم.')}</p>
        ${notice ? `<p role="status">${notice}</p>` : ''}
        <form class="workspace-form" method="post" action="/recover?lang=${lang}">
          <label>${t('Account email', 'البريد الإلكتروني للحساب')}<input type="email" name="email" dir="ltr" maxlength="254" autocomplete="username" required value="${escapeHtml(emailValue)}"></label>
          <label>${t('Authenticator or recovery code', 'رمز المصادقة أو الاسترداد')}<input name="code" dir="ltr" maxlength="19" autocomplete="one-time-code" required></label>
          <label>${t('New password (15–128 characters)', 'كلمة المرور الجديدة (١٥–١٢٨ حرفًا)')}<input type="password" name="password" minlength="15" maxlength="128" autocomplete="new-password" required></label>
          <button class="action" type="submit">${t('Reset password', 'إعادة تعيين كلمة المرور')}</button>
        </form><p><a href="/login?lang=${lang}">${t('Return to sign in', 'العودة إلى تسجيل الدخول')}</a></p></section>`,
    }, { 'Cache-Control': 'no-store' });

    if (!form) return page(200);
    const email = normalizeAddress(emailValue);
    const retryAfter = throttle.begin(request.socket.remoteAddress ?? '', email);
    if (retryAfter) return page(429, t('Too many attempts. Try again shortly.', 'محاولات كثيرة. حاول مرة أخرى بعد قليل.'));
    try {
      const password = form.get('password') ?? '';
      const code = (form.get('code') ?? '').slice(0, 32);
      if (email && password.length >= 15 && password.length <= 128 && code.length <= 32) {
        const credentials = await hashPassword(password);
        store.recoverPassword(email, code, credentials);
      }
      return page(200, t('If the account has two-step verification and the code was valid, its password has been reset and existing sessions revoked. Otherwise, no change was made. Accounts without two-step verification require workspace-operator recovery.', 'إذا كان الحساب يستخدم التحقق بخطوتين وكان الرمز صحيحًا، فقد أُعيد تعيين كلمة المرور وأُلغيت الجلسات الحالية. وإلا فلن يتغير شيء. تتطلب الحسابات التي لا تستخدم التحقق بخطوتين استعادةً بواسطة مشغّل مساحة العمل.'));
    } finally {
      throttle.finish();
    }
  };
}
