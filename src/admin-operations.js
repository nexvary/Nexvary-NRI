import { normalizeAddress } from './password.js';
import { escapeHtml } from './workspace-view.js';

export const operationsSchema = `
  ALTER TABLE control_center_roles RENAME TO former_control_center_roles;
  CREATE TABLE control_center_roles (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('billing','support','security')),
    PRIMARY KEY(account_id,role)
  ) STRICT;
  INSERT INTO control_center_roles SELECT * FROM former_control_center_roles;
  DROP TABLE former_control_center_roles;
  PRAGMA user_version = 41;
`;

export const operationsPaths = Object.freeze({
  support: '/control-center/support',
  security: '/control-center/security',
});

export function operationsStore(db, now, sessionIdle) {
  const authorized = db.prepare(`SELECT 1 FROM account_mfa m WHERE m.account_id=:account AND m.pending_until=0
    AND (EXISTS(SELECT 1 FROM license_operators WHERE account_id=:account)
      OR EXISTS(SELECT 1 FROM control_center_roles WHERE account_id=:account AND role=:role))`);
  const grant = db.prepare('INSERT OR IGNORE INTO control_center_roles VALUES (?,?)');
  const revoke = db.prepare('DELETE FROM control_center_roles WHERE account_id=? AND role=?');
  const account = db.prepare('SELECT id FROM accounts WHERE email=?');
  const accountSubscription = db.prepare('SELECT plan,state,expires_at FROM license_assignments WHERE account_id=?');
  const organizations = db.prepare(`SELECT o.code,o.name,s.plan,s.state,s.expires_at,
    EXISTS(SELECT 1 FROM license_organization_seats a WHERE a.organization=o.code AND a.account_id=m.account_id) AS has_seat
    FROM license_organization_members m JOIN license_organizations o ON o.code=m.organization
    LEFT JOIN license_organization_subscriptions s ON s.organization=o.code
    WHERE m.account_id=? ORDER BY o.code LIMIT 50`);
  const security = db.prepare(`SELECT EXISTS(SELECT 1 FROM account_mfa WHERE account_id=:account AND pending_until=0) AS mfa,
    (SELECT count(*) FROM sessions s JOIN session_activity a USING(token_hash)
      WHERE s.account_id=:account AND s.expires_at>:now AND a.seen_at>:idle) AS sessions`);
  const events = db.prepare('SELECT action,recorded_at FROM security_events WHERE account_id=? ORDER BY id DESC LIMIT 25');
  const canReview = (account, role) => Object.hasOwn(operationsPaths, role) && Boolean(authorized.get({ account, role }));
  return {
    canReview,
    setReviewer(account, role, enabled) {
      if (!Object.hasOwn(operationsPaths, role)) return;
      return (enabled ? grant : revoke).run(account, role);
    },
    lookup(actor, role, email) {
      if (!canReview(actor, role)) return { status: 403 };
      const target = account.get(email);
      if (!target) return { status: 404 };
      const timestamp = now();
      if (role === 'support') {
        const effective = (row) => row && row.expires_at !== null && row.expires_at <= timestamp &&
          ['active', 'trial', 'grace'].includes(row.state) ? { ...row, state: 'expired' } : row;
        return { status: 200, subscription: effective(accountSubscription.get(target.id)),
          organizations: organizations.all(target.id).map(effective) };
      }
      return { status: 200, posture: security.get({ account: target.id, now: timestamp, idle: timestamp - sessionIdle }),
        events: events.all(target.id) };
    },
  };
}

const actions = {
  'sign-in': ['Sign-in', 'تسجيل الدخول'], 'sign-out': ['Sign-out', 'تسجيل الخروج'],
  'revoke-others': ['Session revocation', 'إلغاء الجلسات'], 'password-reset': ['Password reset', 'إعادة تعيين كلمة المرور'],
};
const states = {
  active: ['Active', 'نشط'], trial: ['Trial', 'تجريبي'], grace: ['Grace', 'مهلة'],
  past_due: ['Past due', 'متأخر'], expired: ['Expired', 'منتهٍ'], suspended: ['Suspended', 'معلّق'],
  cancelled: ['Cancelled', 'ملغى'], revoked: ['Revoked', 'مسحوب'],
};

export function handleOperations({ request, reply, lang, account, store, role }) {
  if (!store.operations.canReview(account.id, role)) return reply(403);
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const title = role === 'support' ? t('Support administration', 'إدارة الدعم') : t('Security administration', 'إدارة الأمان');
  const path = operationsPaths[role];
  const url = new URL(request.url, 'http://localhost');
  const input = url.searchParams.get('email');
  const email = input === null ? '' : normalizeAddress(input);
  if (input !== null && !email) return reply(422);
  const result = email ? store.operations.lookup(account.id, role, email) : undefined;
  if (result?.status === 403) return reply(403);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const summary = (row) => row?.plan ? `<bdi>${escapeHtml(row.plan)}</bdi> · ${t(...states[row.state])}
    ${row.expires_at === null ? '' : ` · <time>${date.format(row.expires_at)} UTC</time>`}` : t('No assignment', 'لا يوجد تعيين');
  const details = !result ? '' : result.status === 404 ? `<p>${t('Account unavailable', 'الحساب غير متاح')}</p>`
    : role === 'support' ? `<p>${summary(result.subscription)}</p><h2>${t('Organizations', 'المؤسسات')}</h2>
      <ul>${result.organizations.map((row) => `<li><bdi>${escapeHtml(row.name)}</bdi> · ${summary(row)} ·
        ${row.has_seat ? t('Seat allocated', 'مقعد مخصص') : t('No seat', 'بلا مقعد')}</li>`).join('')}</ul>`
    : `<p>${t('MFA', 'المصادقة المتعددة')} · ${result.posture.mfa ? t('Enabled', 'مفعّلة') : t('Disabled', 'معطّلة')}</p>
      <p>${t('Active sessions', 'الجلسات النشطة')} · ${new Intl.NumberFormat(lang).format(result.posture.sessions)}</p>
      <h2>${t('Recent security events', 'أحداث الأمان الأخيرة')}</h2>
      <ol>${result.events.map((event) => `<li>${t(...actions[event.action])} · <time>${date.format(event.recorded_at)} UTC</time></li>`).join('')}</ol>`;
  reply(result?.status ?? 200, { title, path, controlCenter: true, billingOnly: true,
    html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>
      ${role === 'security' ? `<p>${t('Workspace schema', 'مخطط مساحة العمل')} · ${store.healthy() ? t('Ready', 'جاهز') : t('Unavailable', 'غير متاح')}</p>` : ''}
      <form class="workspace-form" method="get" action="${path}"><input type="hidden" name="lang" value="${lang}">
        <label>${t('Exact account email', 'البريد الإلكتروني المطابق')}<input type="email" name="email" maxlength="254" required dir="ltr"></label>
        <button class="action">${t('Look up account', 'ابحث عن الحساب')}</button>
      </form>${details}
    </section>`,
  });
}
