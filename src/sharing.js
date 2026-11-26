import { escapeHtml, workspacePage, workspacePath } from './workspace-view.js';

const copy = {
  manage: ['Project invitations', 'دعوات المشروع'],
  shared: ['Shared project summary', 'ملخص المشروع المشترك'],
  inbox: ['Project invitation inbox', 'صندوق دعوات المشاريع'],
  return: ['Research workspace', 'مساحة الأبحاث'],
  audience: ['Discoverable researcher', 'باحث متاح في الدليل'],
  search: ['Search researchers', 'ابحث عن باحثين'],
  invite: ['Invite to read summary', 'أرسل دعوة لقراءة الملخص'],
  role: ['Summary reader', 'قارئ الملخص'],
  scope: ['An invitation shows the project title to its recipient. Acceptance grants access to the project summary. Project files and research records stay private.', 'تُظهر الدعوة عنوان المشروع للمستلم. يتيح قبولها قراءة ملخصه. تظل ملفات المشروع وسجلات البحث خاصة.'],
  pending: ['Invitation sent', 'أُرسلت الدعوة'],
  accepted: ['Accepted', 'مقبولة'],
  declined: ['Declined', 'مرفوضة'],
  revoked: ['Revoked', 'ملغاة'],
  revoke: ['Revoke', 'ألغِ الدعوة'],
  accept: ['Accept', 'اقبل'],
  decline: ['Decline', 'ارفض'],
  unknown: ['Hidden researcher', 'باحث مخفي'],
  empty: ['No project invitations.', 'لا توجد دعوات مشاريع.'],
  activity: ['Access history', 'سجل الوصول'],
  error: ['This invitation could not be changed.', 'تعذّر تعديل هذه الدعوة.'],
};

const inboxPath = (lang) => '/workspace/project-invitations?lang=' + lang;
const managePath = (lang, id) => `/workspace/projects/${id}/sharing?lang=${lang}`;
const sharedPath = (lang, id) => `/workspace/shared-projects/${id}?lang=${lang}`;

export function resolveSharingRoute(path) {
  if (path === '/workspace/project-invitations') return { kind: 'sharing-inbox' };
  const owned = path.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/sharing$/);
  if (owned) return { kind: 'sharing-manage', id: owned[1] };
  const shared = path.match(/^\/workspace\/shared-projects\/([0-9a-f-]{36})$/);
  if (shared) return { kind: 'sharing-project', id: shared[1] };
}

export function createSharingHandler(store) {
  return ({ request, reply, redirect, route, lang, account, form }) => {
    const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
    const owner = account.id;
    const { id, kind } = route;
    const missing = () => reply(404, workspacePage(lang, 'missing'));
    let invalid = false;
    const panel = (title, path, html) => reply(invalid ? 422 : 200, {
      title: t(title), path, html: `<section class="surface panel detail workspace-page">
      <h1>${t(title)}</h1>${invalid ? `<p class="form-error" role="alert">${t('error')}</p>` : ''}${html}</section>`,
    });
    if (kind === 'sharing-project') {
      const project = store.sharing.access(owner,id);
      if (!project) {
        missing();
        return;
      }
      panel('shared', `/workspace/shared-projects/${id}`, `<a href="${inboxPath(lang)}">${t('inbox')}</a>
        <h2 dir="auto">${escapeHtml(project.title)}</h2><p dir="auto">${escapeHtml(project.description)}</p>`);
      return;
    }
    if (kind === 'sharing-inbox') {
      if (request.method === 'POST') {
        const intent = form.get('intent');
        const project = form.get('project') ?? '';
        if (/^[a-f0-9-]{36}$/.test(project) && ['accept','decline'].includes(intent)
          && store.sharing.decide(owner, project, intent === 'accept' ? 'accepted' : 'declined')) {
          redirect(inboxPath(lang));
          return;
        }
        invalid = true;
      }
      const entries = store.sharing.inbox(owner);
      panel('inbox', '/workspace/project-invitations', `<p>${t('scope')}</p>
        ${entries.length ? `<ul class="project-list">${entries.map((project) => `<li class="provider-block">
          <h2 dir="auto">${escapeHtml(project.title)}</h2><p>${t('role')} · ${t(project.state)}</p>
          ${project.state === 'accepted' ? `<a href="${sharedPath(lang,project.id)}">${t('shared')}</a>`
            : `<form class="project-tools" action="${inboxPath(lang)}" method="post">
              <input type="hidden" name="project" value="${project.id}">
              <button class="action" name="intent" value="accept">${t('accept')}</button>
              <button class="action" name="intent" value="decline">${t('decline')}</button></form>`}
        </li>`).join('')}</ul>` : `<p>${t('empty')}</p>`}`);
      return;
    }
    const project = store.getProject(owner,id);
    if (!project) {
      missing();
      return;
    }
    const action = managePath(lang,id);
    if (request.method === 'POST') {
      const intent = form.get('intent');
      const peer = form.get('peer') ?? '';
      const valid = /^[a-f0-9-]{36}$/.test(peer);
      if (valid && ((intent === 'invite' && store.sharing.invite(owner,id,peer))
        || (intent === 'revoke' && store.sharing.revoke(owner,id,peer)))) {
        redirect(action);
        return;
      }
      invalid = true;
    }
    const query = new URL('http://localhost' + request.url).searchParams.get('q')?.trim().slice(0,120) ?? '';
    const candidates = store.network.discover(owner, query);
    const entries = store.sharing.outbox(owner,id);
    const history = store.sharing.history(owner,id);
    panel('manage', `/workspace/projects/${id}/sharing`, `<a href="${workspacePath(lang,id)}">${t('return')}</a>
      <h2 dir="auto">${escapeHtml(project.title)}</h2><p>${t('scope')}</p>
      <form class="workspace-form" method="get" action="/workspace/projects/${id}/sharing">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('search')}<input name="q" maxlength="120" value="${escapeHtml(query)}"></label>
        <button class="action">${t('search')}</button></form>
      ${candidates.length ? `<form class="workspace-form" action="${action}" method="post">
        <label>${t('audience')}<select name="peer">${candidates.map((candidate) =>
          `<option value="${candidate.id}">${escapeHtml(candidate.name)}</option>`).join('')}</select></label>
        <button class="action" name="intent" value="invite">${t('invite')}</button></form>` : ''}
      ${entries.length ? `<ul class="project-list">${entries.map((entry) => `<li>
        <bdi>${escapeHtml(entry.name || t('unknown'))}</bdi> · ${t(entry.state)}
        ${['pending','accepted'].includes(entry.state) ? `<form class="project-tools" action="${action}" method="post">
          <input type="hidden" name="peer" value="${entry.recipient}">
          <button class="action danger" name="intent" value="revoke">${t('revoke')}</button></form>` : ''}</li>`).join('')}</ul>` : ''}
      ${history.length ? `<h2>${t('activity')}</h2><ul class="activity">${history.map(({state,recordedAt}) =>
        `<li>${t(state)} · <time dir="ltr">${new Date(recordedAt).toISOString()}</time></li>`).join('')}</ul>` : ''}`);
  };
}
