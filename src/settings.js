import { operationsPaths } from './admin-operations.js';
import { escapeHtml, workspacePath } from './workspace-view.js';

export const settingsSchema = `
  CREATE TABLE security_events (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('sign-in', 'sign-out', 'revoke-others')),
    recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX security_events_account ON security_events(account_id, id DESC);
  PRAGMA user_version = 10;
`;

export const passwordRecoverySchema = `
  ALTER TABLE security_events RENAME TO old_security_events;
  CREATE TABLE security_events (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('sign-in', 'sign-out', 'revoke-others', 'password-reset', 'profile-updated')),
    recorded_at INTEGER NOT NULL
  ) STRICT;
  INSERT INTO security_events SELECT * FROM old_security_events;
  DROP TABLE old_security_events;
  CREATE INDEX security_events_account ON security_events(account_id, id DESC);
  PRAGMA user_version = 27;
`;

export const profilePreferencesSchema = `
  DROP INDEX IF EXISTS security_events_account;
  ALTER TABLE security_events RENAME TO security_events_v44;
  CREATE TABLE security_events (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('sign-in','sign-out','revoke-others','password-reset','profile-updated')),
    recorded_at INTEGER NOT NULL
  ) STRICT;
  INSERT INTO security_events SELECT * FROM security_events_v44;
  DROP TABLE security_events_v44;
  CREATE INDEX security_events_account ON security_events(account_id,id DESC);
  CREATE TABLE IF NOT EXISTS account_preferences (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('dark','light')),
    updated_at INTEGER NOT NULL
  ) STRICT;
  PRAGMA user_version = 45;
`;

export function settingsStore(db, now, transact) {
  const insert = db.prepare('INSERT INTO security_events(account_id, action, recorded_at) VALUES (?, ?, ?)');
  const trim = db.prepare(`
    DELETE FROM security_events WHERE account_id=? AND id IN (
      SELECT id FROM security_events WHERE account_id=? ORDER BY id DESC LIMIT -1 OFFSET 200
    )
  `);
  const list = db.prepare('SELECT action, recorded_at AS recordedAt FROM security_events WHERE account_id=? ORDER BY id DESC LIMIT 25');
  const profile = db.prepare("SELECT display_name AS displayName,theme FROM account_preferences WHERE account_id=?");
  const saveProfile = db.prepare(`INSERT INTO account_preferences(account_id,display_name,theme,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET display_name=excluded.display_name,theme=excluded.theme,updated_at=excluded.updated_at`);
  return {
    record(owner, action) {
      insert.run(owner, action, now());
      trim.run(owner, owner);
    },
    list: (owner) => list.all(owner),
    profile: (owner) => profile.get(owner) ?? { displayName: '', theme: 'dark' },
    updateProfile(owner, displayName, theme) {
      const name=typeof displayName==='string'?displayName.trim():'';
      if(name.length>80 || /[\u0000-\u001f\u007f]/.test(name) || !['dark','light'].includes(theme))return 422;
      return transact(db,()=>{saveProfile.run(owner,name,theme,now());insert.run(owner,'profile-updated',now());trim.run(owner,owner);return 303;});
    },
  };
}

const labels = {
  licensing: ['NRI Control Center', 'مركز تحكم NRI'],
  privacy: ['Account data and privacy', 'بيانات الحساب والخصوصية'],
  moderation: ['Message reports', 'بلاغات الرسائل'],
  mfa: ['Two-step verification', 'التحقق بخطوتين'],
  title: ['Account security', 'أمان الحساب'],
  email: ['Signed-in account', 'الحساب الحالي'],
  other: ['Other active sessions', 'الجلسات النشطة الأخرى'],
  revoke: ['Sign out other sessions', 'سجّل الخروج من الجلسات الأخرى'],
  events: ['Recent security activity', 'نشاط الأمان الأخير'],
  empty: ['No security events recorded yet.', 'لا توجد أحداث أمان مسجّلة بعد.'],
  'password-reset': ['Password reset by workspace operator', 'أعاد مشغّل مساحة العمل تعيين كلمة المرور'],
  'sign-in': ['Signed in', 'تسجيل الدخول'],
  'sign-out': ['Signed out', 'تسجيل الخروج'],
  'revoke-others': ['Other sessions revoked', 'أُلغيت الجلسات الأخرى'],
  'profile-updated': ['Profile and appearance updated', 'تم تحديث الملف الشخصي والمظهر'],
  back: ['Research workspace', 'مساحة الأبحاث'],
};

export function settingsPage(store, lang, account, token) {
  const t = (key) => labels[key][lang === 'ar' ? 1 : 0];
  const subscription = store.licensing.effectiveSubscription(account.id);
  const renewal = store.licensing.renewalNotice(account.id);
  const recent = store.settings.list(account.id);
  const profile = store.settings.profile(account.id);
  const count = store.otherSessions(account.id, token);
  const current = new Intl.NumberFormat(lang).format(count);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return {
    title: t('title'), path: '/workspace/settings',
    html: `<section class="surface panel detail workspace-page"><h1>${t('title')}</h1>
      <a href="${workspacePath(lang)}">${t('back')}</a>
      <a href="/workspace/settings/mfa?lang=${lang}">${t('mfa')}</a>
      <a href="/workspace/settings/privacy?lang=${lang}">${t('privacy')}</a>
      ${store.operations.canReview(account.id, 'support') ? `<a href="${operationsPaths.support}?lang=${lang}">${lang === 'ar' ? 'إدارة الدعم' : 'Support administration'}</a>` : ''}
      ${store.operations.canReview(account.id, 'security') ? `<a href="${operationsPaths.security}?lang=${lang}">${lang === 'ar' ? 'إدارة الأمان' : 'Security administration'}</a>` : ''}
      ${store.operations.canManageRoles(account.id) ? `<a href="${operationsPaths.administration}?lang=${lang}">${lang === 'ar' ? 'إدارة المستخدمين والأدوار' : 'User and role administration'}</a>` : ''}
      ${store.billing.canReview(account.id) ? `<a href="/control-center/billing?lang=${lang}">${lang === 'ar' ? 'سجلات الفوترة التجريبية' : 'Sandbox billing records'}</a>` : ''}
      ${store.licensing.isOperator(account.id) && store.mfa.enabled(account.id) ? `<a href="/control-center?lang=${lang}">${t('licensing')}</a>` : ''}
      ${store.messages.isModerator(account.id) ? `<a href="/workspace/settings/message-moderation?lang=${lang}">${t('moderation')}</a>` : ''}
      ${store.messages.isModerator(account.id) ? `<a href="/workspace/settings/network-moderation?lang=${lang}">${lang==='ar'?'مراجعة بلاغات الشبكة':'Network report review'}</a>` : ''}
      <h2>${lang==='ar'?'الملف الشخصي والمظهر':'Profile and appearance'}</h2>
      <form class="workspace-form" method="post" action="/workspace/settings?lang=${lang}">
        <label>${lang==='ar'?'اسم العرض':'Display name'}<input name="display-name" maxlength="80" value="${escapeHtml(profile.displayName)}" autocomplete="name"></label>
        <label>${lang==='ar'?'السمة':'Theme'}<select name="theme"><option value="dark"${profile.theme==='dark'?' selected':''}>${lang==='ar'?'داكن':'Dark'}</option><option value="light"${profile.theme==='light'?' selected':''}>${lang==='ar'?'فاتح':'Light'}</option></select></label>
        <label>${lang==='ar'?'كلمة المرور الحالية للتأكيد':'Current password for confirmation'}<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <button class="action" name="intent" value="update-profile">${lang==='ar'?'حفظ الملف والمظهر':'Save profile and theme'}</button>
      </form>
      <dl class="reference-meta"><div><dt>${t('email')}</dt><dd><bdi>${escapeHtml(account.email)}</bdi></dd></div>
        <div><dt>${t('other')}</dt><dd>${current}</dd></div></dl>
      ${count ? `<form method="post" action="/workspace/settings?lang=${lang}">
        <button class="action" name="intent" value="revoke-others">${t('revoke')}</button></form>` : ''}
      ${subscription ? `<h2>${lang === 'ar' ? 'الاشتراك الفعلي' : 'Effective subscription'}</h2>
        <p><bdi>${escapeHtml(subscription.plan)}</bdi> · ${subscription.source === 'institution'
          ? (lang === 'ar' ? 'مقعد مؤسسي' : 'Institutional seat')
          : (lang === 'ar' ? 'اشتراك فردي' : 'Individual assignment')}</p>
        <p>${lang === 'ar' ? 'الوحدات المتاحة' : 'Available modules'} · <bdi>${subscription.modules.length
          ? subscription.modules.map((id) => 'NRI-' + String(id).padStart(2, '0')).join(', ')
          : '0'}</bdi></p>` : ''}
      ${renewal ? `<p><strong>${renewal.expired
        ? (lang === 'ar' ? 'انتهى اشتراكك' : 'Your subscription expired')
        : (lang === 'ar' ? 'ينتهي اشتراكك قريبًا' : 'Your subscription expires soon')}</strong>
        · <time>${date.format(renewal.at)} UTC</time></p>` : ''}
      <h2>${t('events')}</h2>
      ${recent.length ? `<ul class="activity">${recent.map((event) => `<li>${t(event.action)}
        <time datetime="${new Date(event.recordedAt).toISOString()}">${date.format(event.recordedAt)} UTC</time></li>`).join('')}</ul>`
        : `<p>${t('empty')}</p>`}</section>`,
  };
}
