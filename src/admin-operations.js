import { createLoginThrottle } from './login-throttle.js';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readBackupKey, restoreEncryptedBackup } from './encrypted-backup.js';
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

export const operationsSessionSchema = `
  ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
  CREATE TABLE control_center_security_events (
    id INTEGER PRIMARY KEY,
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    subject TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action='session-revoked'),
    recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX control_center_security_recent ON control_center_security_events(id DESC);
  PRAGMA user_version = 44;
`;

export const operationsBackupSchema = `
  CREATE TABLE IF NOT EXISTS control_center_backup_checks (
    id INTEGER PRIMARY KEY,
    actor TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    archive_name TEXT NOT NULL,
    result TEXT NOT NULL CHECK(result IN ('verified','failed','unavailable')),
    checked_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS control_center_backup_checks_latest ON control_center_backup_checks(archive_name,id DESC);
  PRAGMA user_version = 47;
`;

const roleAdminThrottle = createLoginThrottle();
const securityActionThrottle = createLoginThrottle();

export function operationsStore(db, now, sessionIdle, backupDirectory = process.env.NRI_BACKUP_DIRECTORY || '/var/backups/nri', backupKeyFile = process.env.NRI_BACKUP_KEY_FILE) {
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
  const events = db.prepare(`SELECT action,recorded_at FROM (
    SELECT action,recorded_at FROM security_events WHERE account_id=?
    UNION ALL SELECT action,recorded_at FROM control_center_security_events WHERE subject=?
  ) ORDER BY recorded_at DESC LIMIT 25`);
  const activeSessions = db.prepare(`SELECT s.token_hash AS sessionRef,s.expires_at AS expiresAt,s.user_agent AS userAgent,a.seen_at AS lastSeen
    FROM sessions s JOIN session_activity a USING(token_hash)
    WHERE s.account_id=? AND s.expires_at>? AND a.seen_at>? ORDER BY a.seen_at DESC LIMIT 50`);
  const activeSession = db.prepare(`SELECT s.token_hash FROM sessions s JOIN session_activity a USING(token_hash)
    WHERE s.account_id=? AND s.token_hash=? AND s.expires_at>? AND a.seen_at>?`);
  const deleteSession = db.prepare('DELETE FROM sessions WHERE account_id=? AND token_hash=?');
  const insertSecurityEvent = db.prepare(`INSERT INTO control_center_security_events(actor,subject,session_hash,action,recorded_at)
    VALUES (?,?,?,'session-revoked',?)`);
  const insertBackupCheck = db.prepare('INSERT INTO control_center_backup_checks(actor,archive_name,result,checked_at) VALUES (?,?,?,?)');
  const latestBackupCheck = db.prepare(`SELECT result,checked_at AS checkedAt FROM control_center_backup_checks
    WHERE archive_name=? ORDER BY id DESC LIMIT 1`);
  const insertBackupCheckTransaction = (actor,name,result) => {
    db.exec('BEGIN IMMEDIATE');
    try { insertBackupCheck.run(actor,name,result,now()); db.exec('COMMIT'); }
    catch(error) { db.exec('ROLLBACK'); throw error; }
  };
  async function backupHistory(actor) {
    if(!canReview(actor,'security'))return undefined;
    const directory=resolve(backupDirectory);
    let names;
    try{names=await readdir(directory);}catch(error){
      if(error.code==='ENOENT'||error.code==='EACCES')return {available:false,files:[]};
      throw error;
    }
    const files=[];
    for(const name of names.filter((entry)=>/^workspace-[A-Za-z0-9T_-]+\.nribak$/.test(entry))){
      try{
        const path=resolve(directory,name), info=await lstat(path);
        if(!info.isFile()||info.isSymbolicLink())continue;
        const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try{
          const header=Buffer.alloc(8), {bytesRead}=await file.read(header,0,8,0), current=await file.stat();
          files.push({name,size:current.size,modifiedAt:current.mtimeMs,containerRecognized:bytesRead===8&&header.toString('ascii')==='NRIBAK01',
            verification:latestBackupCheck.get(name)});
        }finally{await file.close();}
      }catch(error){if(!['ENOENT','EACCES','ELOOP'].includes(error.code))throw error;}
    }
    files.sort((a,b)=>b.modifiedAt-a.modifiedAt||a.name.localeCompare(b.name));
    return {available:true,files:files.slice(0,50)};
  }
  async function verifyBackup(actor,name) {
    if(!canReview(actor,'security'))return {status:'forbidden'};
    if(typeof name!=='string'||!/^workspace-[A-Za-z0-9T_-]+\.nribak$/.test(name))return {status:'failed'};
    let result='failed';
    try {
      if(!backupKeyFile)throw new Error('Backup verification key is not configured.');
      const directory=resolve(backupDirectory),path=resolve(directory,name),info=await lstat(path);
      if(dirname(path)!==directory||!info.isFile()||info.isSymbolicLink())throw new Error('Invalid backup file.');
      const key=await readBackupKey(backupKeyFile);
      const temp=await mkdtemp(join(tmpdir(),'nri-backup-verify-'));
      try { await restoreEncryptedBackup(path,join(temp,'restored'),key); result='verified'; }
      finally { key.fill(0); await rm(temp,{recursive:true,force:true}); }
    } catch(error) {
      if(!backupKeyFile||['ENOENT','EACCES','ELOOP'].includes(error.code))result='unavailable';
    }
    if(!canReview(actor,'security'))return {status:'forbidden'};
    insertBackupCheckTransaction(actor,name,result);
    return {status:result,checkedAt:now()};
  }
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
    backupHistory,
    verifyBackup,
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
        sessions: activeSessions.all(target.id, timestamp, timestamp - sessionIdle), events: events.all(target.id,target.id) };
    },
    revokeSession(actor,email,sessionRef,currentToken) {
      if (!/^[a-f0-9]{64}$/.test(sessionRef ?? '') || !canReview(actor,'security')) return 403;
      const target=targetByEmail.get(email);
      if(!target)return 404;
      const timestamp=now(), idle=timestamp-sessionIdle;
      if(sessionRef===createHash('sha256').update(currentToken).digest('hex') || !activeSession.get(target.id,sessionRef,timestamp,idle))return 409;
      db.exec('BEGIN IMMEDIATE');
      try {
        if(!canReview(actor,'security')){db.exec('ROLLBACK');return 403;}
        if(!deleteSession.run(target.id,sessionRef).changes){db.exec('ROLLBACK');return 409;}
        insertSecurityEvent.run(actor,target.id,sessionRef,timestamp);
        db.exec('COMMIT');
        return 303;
      }catch(error){db.exec('ROLLBACK');throw error;}
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
  'session-revoked': ['Administrator revoked a session', 'ألغى مشرف جلسة'],
};
const states = {
  active: ['Active', 'نشط'], trial: ['Trial', 'تجريبي'], grace: ['Grace', 'مهلة'],
  past_due: ['Past due', 'متأخر'], expired: ['Expired', 'منتهٍ'], suspended: ['Suspended', 'معلّق'],
  cancelled: ['Cancelled', 'ملغى'], revoked: ['Revoked', 'مسحوب'],
};

export async function handleOperations({ request, reply, redirect, lang, account, token, form, store, role }) {
  if (!store.operations.canReview(account.id, role)) return reply(403);
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const title = role === 'support' ? t('Support administration', 'إدارة الدعم') : t('Security administration', 'إدارة الأمان');
  const path = operationsPaths[role];
  const url = new URL(request.url, 'http://localhost');
  const input = form?.get('email') ?? url.searchParams.get('email');
  const email = input === null ? '' : normalizeAddress(input);
  if (input !== null && !email) return reply(422);
  let status=200;
  let backupNotice='';
  if(form){
    if(role!=='security')return reply(405);
    const retry=securityActionThrottle.begin(request.socket.remoteAddress ?? '',account.email);
    if(retry)return reply(429,null,{'Retry-After':String(retry)});
    try{
      const credentials=store.credentials(account.email);
      if((form.get('password') ?? '').length>128 || !await verifyPassword(form.get('password') ?? '',credentials) || store.session(token)?.id!==account.id)return reply(403);
      if(form.get('intent')==='verify-backup'){
        const checked=await store.operations.verifyBackup(account.id,form.get('backup-name') ?? '');
        if(checked.status==='forbidden')return reply(403);
        return redirect(path+'?lang='+lang+'&verification='+checked.status+'&archive='+encodeURIComponent(form.get('backup-name') ?? ''));
      }
      status=store.operations.revokeSession(account.id,email,form.get('session-ref') ?? '',token);
    }finally{securityActionThrottle.finish();}
    if(status===303)return redirect(path+'?email='+encodeURIComponent(email)+'&lang='+lang);
  }
  const result = email ? store.operations.lookup(account.id, role, email) : undefined;
  if (result?.status === 403) return reply(403);
  const backups=role==='security' ? await store.operations.backupHistory(account.id) : undefined;
  const verification=url.searchParams.get('verification');
  const verificationArchive=url.searchParams.get('archive') ?? '';
  if(['verified','failed','unavailable'].includes(verification)&&/^workspace-[A-Za-z0-9T_-]+\.nribak$/.test(verificationArchive)){
    const label={verified:t('Archive authenticated and restored into a disposable workspace.','تم التحقق من الأرشيف واستعادته في مساحة مؤقتة.'),
      failed:t('Archive authentication or workspace validation failed.','فشل التحقق من الأرشيف أو فحص مساحة العمل.'),
      unavailable:t('Verification could not run. Check the archive key and host permissions.','تعذر إجراء التحقق. افحص مفتاح الأرشيف وأذونات الخادم.')};
    backupNotice=`<p role="status"><bdi>${escapeHtml(verificationArchive)}</bdi> · ${label[verification]}</p>`;
  }
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const summary = (row) => row?.plan ? `<bdi>${escapeHtml(row.plan)}</bdi> · ${t(...states[row.state])}
    ${row.expires_at === null ? '' : ` · <time>${date.format(row.expires_at)} UTC</time>`}` : t('No assignment', 'لا يوجد تعيين');
  const sessionList=role==='security' && result?.status===200 ? `<h2>${t('Active sessions','الجلسات النشطة')}</h2>
    ${result.sessions.length ? `<ul class="activity">${result.sessions.map((session,index)=>`<li>
      <p>${t('Browser/client','المتصفح/العميل')} · <bdi>${escapeHtml(session.userAgent || t('Not reported by this client','لم يرسله هذا العميل'))}</bdi></p>
      <p>${t('Last activity','آخر نشاط')} · <time>${date.format(session.lastSeen)} UTC</time> · ${t('Expires','تنتهي')} · <time>${date.format(session.expiresAt)} UTC</time></p>
      <form class="workspace-form" method="post" action="${path}">
        <input type="hidden" name="email" value="${escapeHtml(email)}"><input type="hidden" name="session-ref" value="${session.sessionRef}">
        <label>${t('Current password','كلمة المرور الحالية')}<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <button class="action">${t('Revoke session','ألغِ الجلسة')} · ${index+1}</button>
      </form>
    </li>`).join('')}</ul>` : `<p>${t('No active sessions with recent activity.','لا توجد جلسات نشطة ذات نشاط حديث.')}</p>`}` : '';
  const backupSection=role==='security' ? `<h2>${t('Actual backup archive history','سجل أرشيفات النسخ الاحتياطية الفعلية')}</h2>
    <p>${backups?.available ? t('Backup directory is readable. This page checks archive files and their format header only; it does not authenticate or restore them.',
      'مجلد النسخ الاحتياطية قابل للقراءة. تفحص هذه الصفحة الملفات وترويسة الصيغة فقط؛ ولا تصادق عليها تشفيريًا أو تستعيدها.')
      : t('Backup directory is unavailable or not configured for this process.', 'مجلد النسخ الاحتياطية غير متاح أو غير مضبوط لهذه العملية.')}</p>
    ${backups?.files.length ? `<ol class="activity">${backups.files.map((file)=>`<li><bdi>${escapeHtml(file.name)}</bdi> ·
      ${file.containerRecognized?t('NRIBAK container header recognized','تم التعرف على ترويسة حاوية NRIBAK'):t('Unrecognized archive header','ترويسة أرشيف غير معروفة')} ·
      ${new Intl.NumberFormat(lang).format(file.size)} ${t('bytes','بايت')} · <time>${date.format(file.modifiedAt)} UTC</time>
      ${file.verification ? `<p>${t('Last verification','آخر تحقق')} · ${file.verification.result==='verified'?t('Authenticated restore passed','نجح التحقق والاستعادة'):file.verification.result==='failed'?t('Verification failed','فشل التحقق'):t('Verification unavailable','التحقق غير متاح')} · <time>${date.format(file.verification.checkedAt)} UTC</time></p>`:''}
      <form class="workspace-form" method="post" action="${path}"><input type="hidden" name="intent" value="verify-backup"><input type="hidden" name="backup-name" value="${escapeHtml(file.name)}">
        <label>${t('Current password','كلمة المرور الحالية')}<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <button class="action">${t('Authenticate and restore-check archive','تحقق تشفيريًا واختبر استعادة الأرشيف')}</button></form></li>`).join('')}</ol>`
      : `<p>${t('No backup archives found.','لم يُعثر على أرشيفات نسخ احتياطية.')}</p>`}` : '';
  const details = !result ? '' : result.status === 404 ? `<p>${t('Account unavailable', 'الحساب غير متاح')}</p>`
    : role === 'support' ? `<p>${summary(result.subscription)}</p><h2>${t('Organizations', 'المؤسسات')}</h2>
      <ul>${result.organizations.map((row) => `<li><bdi>${escapeHtml(row.name)}</bdi> · ${summary(row)} ·
        ${row.has_seat ? t('Seat allocated', 'مقعد مخصص') : t('No seat', 'بلا مقعد')}</li>`).join('')}</ul>`
    : `<p>${t('MFA', 'المصادقة المتعددة')} · ${result.posture.mfa ? t('Enabled', 'مفعّلة') : t('Disabled', 'معطّلة')}</p>
      <p>${t('Active sessions', 'الجلسات النشطة')} · ${new Intl.NumberFormat(lang).format(result.posture.sessions)}</p>
      ${sessionList}
      <h2>${t('Recent security events', 'أحداث الأمان الأخيرة')}</h2>
      <ol>${result.events.map((event) => `<li>${t(...actions[event.action])} · <time>${date.format(event.recorded_at)} UTC</time></li>`).join('')}</ol>`;
  reply(status===200 ? result?.status ?? 200 : status, { title, path, controlCenter: true, billingOnly: true,
    html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>
      ${role === 'security' ? `<p>${t('Workspace schema', 'مخطط مساحة العمل')} · ${store.healthy() ? t('Ready', 'جاهز') : t('Unavailable', 'غير متاح')}</p>` : ''}
      ${backupSection}
      ${backupNotice}
      ${status===409 ? `<p role="status">${t('Session unavailable, stale or cannot be revoked from this session.','الجلسة غير متاحة أو قديمة أو لا يمكن إلغاؤها من جلستك الحالية.')}</p>`:''}
      <form class="workspace-form" method="get" action="${path}"><input type="hidden" name="lang" value="${lang}">
        <label>${t('Exact account email', 'البريد الإلكتروني المطابق')}<input type="email" name="email" maxlength="254" required dir="ltr"></label>
        <button class="action">${t('Look up account', 'ابحث عن الحساب')}</button>
      </form>${details}
    </section>`,
  });
}
