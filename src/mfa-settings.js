import { verifyPassword } from './password.js';
import { escapeHtml } from './workspace-view.js';

const path = '/workspace/settings/mfa';

export function createMfaSettingsHandler(store) {
  const attempts = new Map();
  return async function handle({ reply, redirect, lang, account, token, form }) {
    const owner = account.id;
    const t = (en, ar) => lang === 'ar' ? ar : en;
    let status = 200;
    let recovery;
    if (form) {
      const intent = form.get('intent');
      if (!['begin', 'confirm', 'disable'].includes(intent)) return reply(422);
      const now = Date.now();
      const cutoff = now - 60_000;
      for (const [id, attempt] of attempts) {
        if (attempt.start <= cutoff) attempts.delete(id);
      }
      const attempt = attempts.get(owner) ?? { start: now, count: 0 };
      if (attempt.count >= 5 || (!attempts.has(owner) && attempts.size >= 200)) return reply(429, null, { 'Retry-After': '60' });
      attempt.count++;
      attempts.set(owner, attempt);

      const password = form.get('password') ?? '';
      const code = (form.get('code') ?? '').slice(0, 32);
      if (password.length > 128 || !await verifyPassword(password, store.credentials(account.email))) status = 422;
      else if (store.session(token)?.id !== owner) return reply(403);
      else if (intent === 'begin') {
        if (store.mfa.begin(owner)) return redirect(path + '?lang=' + lang);
        status = 422;
      } else if (intent === 'confirm') {
        recovery = store.mfa.confirm(owner, code, token);
        if (!recovery) status = 422;
      } else {
        if (store.mfa.disable(owner, code, token)) {
          return redirect(path + '?lang=' + lang);
        }
        status = 422;
      }
    }
    const enabled = store.mfa.enabled(owner);
    const setup = store.mfa.pending(owner);
    const title = t('Two-step verification', 'التحقق بخطوتين');
    const password = `<label>${t('Current password', 'كلمة المرور الحالية')}<input required type="password" name="password" autocomplete="current-password" maxlength="128"></label>`;
    const code = `<label>${t('Verification code', 'رمز التحقق')}<input required name="code" autocomplete="one-time-code" maxlength="19" dir="ltr"></label>`;
    const action = path + '?lang=' + lang;
    reply(status, {
      title, path,
      html: `<section class="surface panel detail workspace-page">
        <h1>${title}</h1>
        <p><a href="/workspace/settings?lang=${lang}">${t('Back to account security', 'العودة إلى أمان الحساب')}</a></p>
        ${status === 422 ? `<p role="alert">${t('Check your password and verification code.', 'تحقق من كلمة المرور ورمز التحقق.')}</p>` : ''}
        ${recovery ? `<h2>${t('One-use recovery codes', 'رموز استرداد للاستخدام مرة واحدة')}</h2>
          <p>${t('Save these codes now. They are shown once and each can replace an authenticator code at sign-in.', 'احفظ هذه الرموز الآن. تظهر مرة واحدة، ويمكن استخدام كل رمز بدلًا من رمز تطبيق المصادقة عند تسجيل الدخول.')}</p>
          <ul>${recovery.map((item) => `<li><code dir="ltr">${escapeHtml(item)}</code></li>`).join('')}</ul>` : ''}
        ${enabled ? `<p>${t('Enabled', 'مفعّل')}</p>
          <form class="workspace-form" method="post" action="${action}">${password}${code}
            <button class="action" name="intent" value="disable">${t('Disable two-step verification', 'عطّل التحقق بخطوتين')}</button>
          </form>` : setup ? `<p>${t('Add this key to your authenticator as a time-based account. Setup expires in 10 minutes.', 'أضف هذا المفتاح إلى تطبيق المصادقة كحساب يعتمد على الوقت. ينتهي الإعداد خلال ١٠ دقائق.')}</p>
          <p><code dir="ltr" class="mfa-setup-key">${escapeHtml(setup)}</code></p>
          <form class="workspace-form" method="post" action="${action}">${password}${code}
            <button class="action" name="intent" value="confirm">${t('Enable two-step verification', 'فعّل التحقق بخطوتين')}</button>
          </form>` : `<form class="workspace-form" method="post" action="${action}">${password}
            <button class="action" name="intent" value="begin">${t('Set up an authenticator', 'أعدّ تطبيق المصادقة')}</button>
          </form>`}
      </section>`,
    });
  };
}
