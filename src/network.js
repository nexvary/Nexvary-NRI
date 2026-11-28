import { normalizeOrcid } from './public-identifiers.js';
import { escapeHtml } from './workspace-view.js';

const labels = {
  invitations: ['Project invitation inbox', 'صندوق دعوات المشاريع'],
  network: ['Research network', 'شبكة الباحثين'],
  'network-moderation': ['Network moderation', 'الإشراف على الشبكة'],
  collaboration: ['Collaboration requests', 'طلبات التعاون'],
  guidance: ['Profiles are private until you enable discovery by signed-in researchers.', 'تظل الملفات الشخصية خاصة حتى تفعّل ظهورها للباحثين الذين سجّلوا الدخول.'],
  requestScope: ['Accepting a request records mutual interest. Use a project invitation to share a summary.', 'قبول الطلب يسجّل الاهتمام المتبادل. استخدم دعوة مشروع لمشاركة ملخصه.'],
  name: ['Display name', 'الاسم المعروض'],
  interests: ['Research interests', 'الاهتمامات البحثية'],
  orcid: ['ORCID iD (optional, self-reported)', 'معرّف ORCID اختياري يضيفه صاحبه'],
  discoverable: ['Show my profile in the signed-in directory', 'اعرض ملفي في دليل الباحثين المسجلين'],
  profile: ['Save profile', 'احفظ الملف الشخصي'],
  search: ['Search by name or interests', 'ابحث بالاسم أو الاهتمامات'],
  find: ['Search', 'ابحث'],
  noResults: ['No discoverable researchers match.', 'لا يوجد باحثون متاحون يطابقون البحث.'],
  follow: ['Follow', 'تابع'],
  unfollow: ['Unfollow', 'ألغِ المتابعة'],
  request: ['Request collaboration', 'اطلب التعاون'],
  pending: ['Pending', 'قيد الانتظار'],
  accepted: ['Accepted', 'مقبول'],
  declined: ['Declined', 'مرفوض'],
  accept: ['Accept', 'اقبل'],
  decline: ['Decline', 'ارفض'],
  block: ['Block', 'احظر'],
  unblock: ['Unblock', 'ألغِ الحظر'],
  blocked: ['Blocked accounts', 'الحسابات المحظورة'],
  hidden: ['Hidden profile', 'ملف شخصي مخفي'],
  noRequests: ['No collaboration requests received.', 'لا توجد طلبات تعاون واردة.'],
  report: ['Report profile', 'أبلغ عن الملف'],
  spam: ['Spam', 'رسائل مزعجة'],
  impersonation: ['Impersonation', 'انتحال الهوية'],
  harassment: ['Harassment', 'مضايقة'],
  other: ['Other concern', 'سبب آخر'],
  reportSubmitted: ['Your report was sent to a network moderator.', 'أُرسل بلاغك إلى مشرف الشبكة.'],
  reportQueue: ['Pending researcher profile reports', 'بلاغات ملفات الباحثين قيد المراجعة'],
  reportEmpty: ['There are no pending network reports.', 'لا توجد بلاغات شبكة قيد المراجعة.'],
  reportReason: ['Reason', 'السبب'],
  reporter: ['Reporter', 'مقدم البلاغ'],
  actioned: ['Hide profile and close report', 'إخفاء الملف وإغلاق البلاغ'],
  dismissed: ['Dismiss report', 'رفض البلاغ'],
  invalid: ['The action could not be saved. Check your profile, selection and request limits.', 'تعذّر حفظ الإجراء. تحقق من ملفك والاختيار وحدود الطلبات.'],
};

export function createNetworkHandler(store) {
  return ({ request, reply, redirect, route, lang, account, form }) => {
    const t = (key) => labels[key][lang === 'ar' ? 1 : 0];
    const { kind } = route;
    const owner = account.id;
    const path = kind === 'network-moderation' ? '/workspace/settings/network-moderation' : '/workspace/' + kind;
    const href = (page) => '/workspace/' + page + '?lang=' + lang;
    if (kind === 'network-moderation' && !store.messages.isModerator(owner)) {
      reply(403);
      return;
    }
    let invalid = false;
    let reportSubmitted = false;
    if (request.method === 'POST') {
      const action = form.get('intent') ?? '';
      let saved = false;
      if (kind === 'network-moderation') {
        const reportId=Number(form.get('report-id'));
        saved=store.network.reviewReport(owner,reportId,action==='actioned'?'actioned':action==='dismissed'?'dismissed':'');
      } else if (action === 'report' && kind === 'network') {
        const peer = form.get('peer') ?? '';
        saved=/^[0-9a-f-]{36}$/.test(peer) && store.network.report(owner,peer,form.get('reason'));
        reportSubmitted=saved;
      } else if (action === 'profile' && kind === 'network') {
        const name = (form.get('name') ?? '').trim();
        const interests = (form.get('interests') ?? '').trim();
        const providedOrcid = (form.get('orcid') ?? '').trim();
        const orcid = providedOrcid ? normalizeOrcid(providedOrcid) : '';
        saved = name.length > 0 && name.length <= 100 && interests.length <= 600 && orcid !== null
          && store.network.save(owner, { name, interests, orcid, discoverable: form.get('discoverable') === 'yes' });
      } else {
        const peer = form.get('peer') ?? '';
        saved = /^[0-9a-f-]{36}$/.test(peer) && store.network.interact(owner, peer, action);
      }
      if (saved) {
        redirect(kind === 'network-moderation' ? path + '?lang=' + lang : href(kind));
        return;
      }
      invalid = true;
    }
    const controls = (peer, actions) => `<form class="project-tools" method="post" action="${href(kind)}">
      <input type="hidden" name="peer" value="${peer}">
      ${actions.map((action) => `<button class="action${action === 'block' ? ' danger' : ''}" name="intent" value="${action}">${t(action)}</button>`).join('')}
    </form>`;
    const reportControl = (peer) => `<form class="project-tools" method="post" action="${href('network')}">
      <input type="hidden" name="peer" value="${peer}">
      <label>${t('reportReason')}<select name="reason" required><option value="spam">${t('spam')}</option><option value="impersonation">${t('impersonation')}</option><option value="harassment">${t('harassment')}</option><option value="other">${t('other')}</option></select></label>
      <button class="action danger" name="intent" value="report">${t('report')}</button>
    </form>`;
    const profile = store.network.profile(owner);
    const finder = new URL('http://localhost' + request.url).searchParams.get('q')?.trim().slice(0, 120) ?? '';
    const researchers = kind === 'network' ? store.network.discover(owner, finder) : [];
    const requests = kind === 'collaboration' ? store.network.incoming(owner) : [];
    const blocked = kind === 'network' ? store.network.blocked(owner) : [];
    const reports = kind === 'network-moderation' ? store.network.reports() : [];
    const content = kind === 'network' ? `
      <p>${t('guidance')}</p>${reportSubmitted ? `<p role="status">${t('reportSubmitted')}</p>` : ''}<form class="workspace-form" method="post" action="${href(kind)}">
        <input type="hidden" name="intent" value="profile">
        <label>${t('name')}<input name="name" maxlength="100" required value="${escapeHtml(profile?.name ?? '')}"></label>
        <label>${t('interests')}<textarea name="interests" maxlength="600">${escapeHtml(profile?.interests ?? '')}</textarea></label>
        <label>${t('orcid')}<input name="orcid" maxlength="80" dir="ltr" value="${escapeHtml(profile?.orcid ?? '')}"></label>
        <label><input type="checkbox" name="discoverable" value="yes"${profile?.discoverable ? ' checked' : ''}> ${t('discoverable')}</label>
        <button class="action">${t('profile')}</button></form>
      <form class="workspace-form" method="get" action="${path}">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('search')}<input name="q" maxlength="120" value="${escapeHtml(finder)}"></label>
        <button class="action">${t('find')}</button></form>
      ${researchers.length ? `<ul class="project-list">${researchers.map((reviewer) => `<li class="provider-block">
        <h2 dir="auto">${escapeHtml(reviewer.name)}</h2><p dir="auto">${escapeHtml(reviewer.interests)}</p>
        ${reviewer.orcid ? `<a dir="ltr" href="https://orcid.org/${reviewer.orcid}">ORCID ${reviewer.orcid}</a>` : ''}
        ${reviewer.request ? `<p>${t(reviewer.request)}</p>` : ''}
        ${profile?.discoverable ? controls(reviewer.id, [reviewer.following ? 'unfollow' : 'follow', ...(!reviewer.request ? ['request'] : []), 'block']) : ''}
        ${reportControl(reviewer.id)}
      </li>`).join('')}</ul>` : `<p>${t('noResults')}</p>`}
      ${blocked.length ? `<h2>${t('blocked')}</h2><ul>${blocked.map((peer) =>
        `<li><bdi>${escapeHtml(peer.name || t('hidden'))}</bdi>${controls(peer.id, ['unblock'])}</li>`).join('')}</ul>` : ''}
    ` : kind === 'collaboration' ? `<p>${t('requestScope')}</p>
      ${requests.length ? `<ul class="project-list">${requests.map((request) => `<li class="provider-block">
        <h2 dir="auto">${escapeHtml(request.name)}</h2><p>${t(request.state)}</p>
        ${request.state === 'pending' ? controls(request.id, ['accept', 'decline']) : ''}
      </li>`).join('')}</ul>` : `<p>${t('noRequests')}</p>`}
      ` : `<h2>${t('reportQueue')}</h2>${reports.length ? `<ul class="project-list">${reports.map((report) => `<li class="provider-block">
        <h3>${escapeHtml(report.subjectName)}</h3><p>${t(report.reason)} · ${t('reporter')}: <bdi>${escapeHtml(report.reporterRef)}</bdi></p>
        <form class="project-tools" method="post" action="${path}?lang=${lang}">
          <input type="hidden" name="report-id" value="${report.id}">
          <button class="action danger" name="intent" value="actioned">${t('actioned')}</button>
          <button class="action" name="intent" value="dismissed">${t('dismissed')}</button>
        </form></li>`).join('')}</ul>` : `<p>${t('reportEmpty')}</p>`}`;
    reply(invalid ? 422 : 200, {
      title: t(kind), path,
      html: `<section class="surface panel detail workspace-page"><h1>${t(kind)}</h1>
        <nav class="project-tools"><a href="${href(kind === 'network' ? 'collaboration' : 'network')}">${t(kind === 'network' ? 'collaboration' : 'network')}</a>
          <a href="/workspace/project-invitations?lang=${lang}">${t('invitations')}</a>
          ${store.messages.isModerator(owner) && kind !== 'network-moderation' ? `<a href="/workspace/settings/network-moderation?lang=${lang}">${t('reportQueue')}</a>` : ''}</nav>
        ${invalid ? `<p class="form-error" role="alert">${t('invalid')}</p>` : ''}${content}</section>`,
    });
  };
}
