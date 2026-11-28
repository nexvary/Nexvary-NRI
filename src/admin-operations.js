import { createLoginThrottle } from './login-throttle.js';
import { normalizeAddress, verifyPassword } from './password.js';
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
  administration: '/control-center/admin',
});

export const operationsAdminSchema = `
  CREATE TABLE control_center_admin_events (
    id INTEGER PRIMARY KEY,
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    subject TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('billing','support','security')),
    action TEXT NOT NULL CHECK(action IN ('granted','revoked')),
    recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX control_center_admin_recent ON control_center_admin_events(id DESC);
  PRAGMA user_version = 43;
`;

const roleAdminThrottle = createLoginThrottle();

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
  const canManage = db.prepare(`SELECT 1 FROM license_operators o JOIN account_mfa m ON m.account_id=o.account_id
    WHERE o.account_id=? AND m.pending_until=0`);
  const targetByEmail = db.prepare('SELECT id,email FROM accounts WHERE email=?');
  const rolesFor = db.prepare('SELECT role FROM control_center_roles WHERE account_id=? ORDER BY role');
  const recentAdminEvents = db.prepare(`SELECT actor.email AS actor,subject.email AS subject,e.role,e.action,e.recorded_at
    FROM control_center_admin_events e JOIN accounts actor ON actor.id=e.actor
    JOIN accounts subject ON subject.id=e.subject ORDER BY e.id DESC LIMIT 50`);
  const insertAdminEvent = db.prepare('INSERT INTO control_center_admin_events(actor,subject,role,action,recorded_at) VALUES (?,?,?,?,?)');
  const canReview = (account, role) => Object.hasOwn(operationsPaths, role) && Boolean(authorized.get({ account, role }));
  return {
    canReview,
    canManageRoles: (actor) => Boolean(canManage.get(actor)),
    adminLookup(actor, email) {
      if (!canManage.get(actor)) return { status: 403 };
      const target = targetByEmail.get(email);
      if (!target) return { status: 404, events: recentAdminEvents.all() };
      return { status: 200, account: target, roles: rolesFor.all(target.id).map(({ role }) => role), events: recentAdminEvents.all() };
    },
    manageRole(actor, email, role, action) {
      if (!['billing', 'support', 'security'].includes(role) || !['grant', 'revoke'].includes(action)) return 422;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!canManage.get(actor)) { db.exec('ROLLBACK'); return 403; }
        const target = targetByEmail.get(email);
        if (!target) { db.exec('ROLLBACK'); return 404; }
        const result = (action === 'grant' ? grant : revoke).run(target.id, role);
        if (!result.changes) { db.exec('ROLLBACK'); return 409; }
        insertAdminEvent.run(actor, target.id, role, action === 'grant' ? 'granted' : 'revoked', now());
        db.exec('COMMIT');
        return 303;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
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

export async function handleOperationsAdmin({ request, reply, redirect, lang, actor, token, form, store }) {
  if (!store.operations.canManageRoles(actor.id)) return reply(403);
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const url = operationsPaths.administration + '?lang=' + lang;
  let status = 200;
  if (form) {
    const retry = roleAdminThrottle.begin(request.socket.remoteAddress ?? '', actor.email);
    if (retry) return reply(429, null, { 'Retry-After': String(retry) });
    try {
      const credentials = store.credentials(actor.email);
      if ((form.get('password') ?? '').length > 128 || !await verifyPassword(form.get('password') ?? '', credentials) ||
          store.session(token)?.id !== actor.id) return reply(403);
      const email = normalizeAddress(form.get('email') ?? '');
      status = store.operations.manageRole(actor.id, email, form.get('role') ?? '', form.get('action') ?? '');
      if (status === 303) return redirect(url);
    } finally {
      roleAdminThrottle.finish();
    }
  }
  const search = new URL(request.url, 'http://localhost').searchParams.get('email');
  const email = search === null ? '' : normalizeAddress(search);
  if (search !== null && !email) return reply(422);
  const result = email ? store.operations.adminLookup(actor.id, email) : { status: 200, events: store.operations.adminLookup(actor.id, '').events };
  const roles = ['billing', 'support', 'security'];
  const roleNames = { billing: ['Billing reviewer', 'مراجع الفوترة'], support: ['Support reviewer', 'مراجع الدعم'], security: ['Security reviewer', 'مراجع الأمان'] };
  const eventRows = (result.events ?? []).map((event) => `<li><bdi>${escapeHtml(event.actor)}</bdi> · ${t(...roleNames[event.role])} ·
    ${event.action === 'granted' ? t('Granted to', 'مُنح إلى') : t('Revoked from', 'سُحب من')} <bdi>${escapeHtml(event.subject)}</bdi> ·
    <time>${new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(event.recorded_at)} UTC</time></li>`).join('');
  const target = result.account ? `<h2>${t('Current roles', 'الأدوار الحالية')} · <bdi>${escapeHtml(result.account.email)}</bdi></h2>
    <p>${result.roles.length ? result.roles.map((role) => t(...roleNames[role])).join(' · ') : t('No delegated roles', 'لا توجد أدوار مفوضة')}</p>
    <form class="workspace-form" method="post" action="${url}">
      <input type="hidden" name="email" value="${escapeHtml(result.account.email)}">
      <label>${t('Role', 'الدور')}<select name="role" required>${roles.map((role) => `<option value="${role}">${t(...roleNames[role])}</option>`).join('')}</select></label>
      <label>${t('Current password', 'كلمة المرور الحالية')}<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
      <button class="action" name="action" value="grant">${t('Grant role', 'امنح الدور')}</button>
      <button class="action" name="action" value="revoke">${t('Revoke role', 'اسحب الدور')}</button>
    </form>` : '';
  reply(status, { title: t('User and role administration', 'إدارة المستخدمين والأدوار'), path: operationsPaths.administration,
    controlCenter: true, billingOnly: true,
    html: `<section class="surface panel detail workspace-page"><h1>${t('User and role administration', 'إدارة المستخدمين والأدوار')}</h1>
      <p>${t('Manage delegated billing, support and security reviewer roles. MFA and current-password confirmation are required; each change is audited.',
        'إدارة أدوار مراجعي الفوترة والدعم والأمان. يلزم التحقق متعدد العوامل وتأكيد كلمة المرور الحالية، ويُسجّل كل تغيير في سجل التدقيق.')}</p>
      ${status === 409 ? `<p role="status">${t('The role was already in that state.', 'الدور مضبوط بالفعل على هذه الحالة.')}</p>` : ''}
      ${result.status === 404 ? `<p role="status">${t('Account unavailable.', 'الحساب غير متاح.')}</p>` : ''}
      <form class="workspace-form" method="get" action="${operationsPaths.administration}">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('Exact account email', 'البريد الإلكتروني المطابق')}<input type="email" name="email" maxlength="254" required dir="ltr"></label>
        <button class="action">${t('Look up account', 'ابحث عن الحساب')}</button>
      </form>${target}<h2>${t('Recent role changes', 'تغييرات الأدوار الأخيرة')}</h2>
      ${eventRows ? `<ol class="activity">${eventRows}</ol>` : `<p>${t('No role changes recorded.', 'لا توجد تغييرات أدوار مسجلة.')}</p>`}
    </section>`,
  });
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
