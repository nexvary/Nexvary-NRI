import { publicationStages, teamRoles } from './team-store.js';
import { escapeHtml } from './workspace-view.js';

const inbox = '/workspace/team-invitations';
const teamPath = (id) => '/workspace/projects/' + id + '/team';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const roles = {
  owner: ['Owner', 'المالك'],
  administrator: ['Administrator', 'مدير المشروع'],
  researcher: ['Researcher', 'باحث'],
  reviewer: ['Reviewer', 'مراجع'],
  'read-only': ['Read-only', 'قراءة فقط'],
};
const statusLabels = {
  pending: ['Pending', 'قيد الانتظار'], accepted: ['Accepted', 'مقبول'], declined: ['Declined', 'مرفوض'],
  revoked: ['Revoked', 'ملغى'], invited: ['Invited', 'تمت الدعوة'], blocked: ['Blocked', 'محظور'],
  metadata: ['Catalog metadata revised', 'تم تحديث بيانات الفهرس'],
  note: ['Note added', 'أُضيفت ملاحظة'], task: ['Task added', 'أُضيفت مهمة'],
  'task-open': ['Task reopened', 'أُعيد فتح المهمة'], 'task-done': ['Task completed', 'اكتملت المهمة'],
  version: ['Manuscript version', 'إصدار المخطوطة'], review: ['Review', 'مراجعة'],
  'changes-requested': ['Changes requested', 'تعديلات مطلوبة'],
};

export function resolveTeamRoute(path) {
  if (path === inbox) return { kind: 'team-inbox' };
  const match = path.match(/^\/workspace\/projects\/([a-f0-9-]{36})\/team(\/work)?$/);
  if (match && uuid.test(match[1])) return { kind: match[2] ? 'team-work' : 'team-project', id: match[1] };
}

export function handleTeam({ request, reply, redirect, route, account, form, lang, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const roleLabel = (role) => t(...roles[role]);
  const statusLabel = (state) => t(...statusLabels[state]);
  const link = (path) => path + '?lang=' + lang;
  const actor = account.id;
  const id = route.id;
  const stageLabels = { draft: ['Draft', 'مسودة'], submitted: ['Submitted', 'مقدّمة'], published: ['Published', 'منشورة'] };
  const stageLabel = (stage) => t(...stageLabels[stage]);
  const { teams } = store;
  const intent = form?.get('intent');
  const params = new URL(request.url, 'http://localhost').searchParams;
  const page = (title, path, html) => reply(200, { title, path, html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>${html}</section>` });
  const inboxTitle = t('Project team invitations', 'دعوات فرق المشاريع');
  const tab = (title, path) => `<a href="${link(path)}">${title}</a>`;
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`;
  const button = (value, title) => `<button class="action" name="intent" value="${value}">${title}</button>`;
  if (!id) {
    if (form) {
      const project = form.get('project') ?? '';
      if (!uuid.test(project) || !['accepted', 'declined'].includes(intent) ||
          !teams.decide(actor, project, form.get('role'), Number(form.get('invitation')), intent)) return reply(404);
      return redirect(link(inbox));
    }
    return page(inboxTitle, inbox, `
      <p>${tab(t('Summary invitations', 'دعوات الملخص'), '/workspace/project-invitations')}</p>
      <ul class="project-list">${teams.inbox(actor).map((entry) => `<li class="provider-block">
        <h2 dir="auto">${escapeHtml(entry.title)}</h2><p>${roleLabel(entry.role)} · ${statusLabel(entry.state)}</p>
        ${entry.state === 'accepted' ? tab(t('Open project team', 'افتح فريق المشروع'), teamPath(entry.id)) :
          `<form class="project-tools" method="post" action="${link(inbox)}">${hidden('project',entry.id)}${hidden('role',entry.role)}${hidden('invitation',entry.invitation)}
          ${button('accepted', t('Accept role', 'اقبل الدور'))}${button('declined', t('Decline', 'ارفض'))}</form>`}
      </li>`).join('')}</ul>`);
  }
  const path = teamPath(id);
  const action = link(path);
  const permission = teams.access(actor, id);
  if (!permission) return reply(404);
  const selected = params.get('manuscript') ?? '';
  if (selected && !uuid.test(selected)) return reply(404);
  if (form) {
    if (intent === 'invite' || intent === 'revoke') {
      if (!permission.rights.includes('manage')) return reply(403);
      const peer = form.get('peer') ?? '';
      const ok = uuid.test(peer) && (intent === 'invite' ? teams.grant(actor, id, peer, form.get('role')) : teams.revoke(actor, id, peer));
      return ok ? redirect(action) : reply(422);
    }
    if (intent === 'save') {
      const result = teams.save(actor, id, {
        manuscript: form.get('manuscript') || '',
        title: (form.get('title') ?? '').trim(), body: (form.get('body') ?? '').trim(), base: Number(form.get('base')),
      });
      return typeof result === 'string' ? redirect(action + '&manuscript=' + result) : reply(result);
    }
    if (intent === 'metadata') {
      const manuscript = form.get('manuscript') ?? '';
      if (!uuid.test(manuscript)) return reply(404);
      const list = (name) => [...new Set((form.get(name) ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
      const result = teams.updateMetadata(actor, id, {
        manuscript, base: Number(form.get('base')), authors: list('authors'), tags: list('tags'),
        stage: form.get('stage'), doi: (form.get('doi') ?? '').trim(),
      });
      return result === 303 ? redirect(action + '&manuscript=' + manuscript) : reply(result);
    }
    if (intent === 'review') {
      const version = form.get('version') ?? '';
      if (version && !/^[1-9]\d{0,14}$/.test(version)) return reply(422);
      const result = teams.review(actor, id, {
        version: Number(version), item: form.get('item') ?? '', outcome: form.get('outcome'), note: (form.get('note') ?? '').trim(),
      });
      return result === 303 ? redirect(action) : reply(result);
    }
    return reply(422);
  }
  const query = (params.get('q') ?? '').trim().slice(0,150);
  const stage = publicationStages.includes(params.get('stage')) ? params.get('stage') : '';
  const offsetField = params.get('offset') ?? '';
  const offset = /^\d{1,8}$/.test(offsetField) ? Number(offsetField) : 0;
  const current = teams.view(actor, id, selected, { query, stage, offset });
  if (!current || (selected && !current.versions.length)) return reply(404);
  const when = (timestamp) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
  const author = (owner) => escapeHtml(owner ?? t('Deleted account', 'حساب محذوف'));
  const manage = current.rights.includes('manage');
  const write = current.rights.includes('write');
  const review = current.rights.includes('review');
  const peers = manage ? store.network.discover(actor, '') : [];
  const options = teamRoles.filter((role) => current.role === 'owner' || role !== 'administrator');
  const instance = (target) => `<form class="workspace-form" method="post" action="${action}">${target}
    <label>${t('Outcome', 'النتيجة')}<select name="outcome"><option value="accepted">${statusLabel('accepted')}</option><option value="changes-requested">${statusLabel('changes-requested')}</option></select></label>
    <label>${t('Review note', 'ملاحظة المراجعة')}<textarea name="note" required maxlength="2000" dir="auto"></textarea></label>
    ${button('review', t('Record review', 'سجّل المراجعة'))}</form>`;
  const latest = current.versions[0];
  const meta = current.metadata[0];
  const more = (next) => action + '&amp;' + escapeHtml(new URLSearchParams({ q: query, stage, offset: next }).toString());
  const lines = (value) => value ? JSON.parse(value).join('\n') : '';
  const listLabels = (value) => value ? JSON.parse(value).join(' · ') : '';
  return page(t('Project team', 'فريق المشروع'), path, `
    <nav class="project-tools">${tab(inboxTitle,inbox)} ${tab(t('Notes and tasks','الملاحظات والمهام'),path + '/work')}</nav><h2 dir="auto">${escapeHtml(current.title)}</h2><p>${roleLabel(current.role)}</p>
    ${manage ? `<h2>${t('Team access', 'صلاحيات الفريق')}</h2>
    <p>${t('Accepted team roles can read manuscripts and evidence. A changed role requires renewed acceptance.', 'يمكن لأعضاء الفريق الذين قبلوا أدوارهم قراءة المخطوطات والأدلة. يتطلب تغيير الدور قبولًا جديدًا.')}</p>
    ${peers.length ? `<form class="workspace-form" method="post" action="${action}">
      <label>${t('Researcher', 'الباحث')}<select name="peer">${peers.map((peer) => `<option value="${peer.id}">${escapeHtml(peer.name)}</option>`).join('')}</select></label>
      <label>${t('Role', 'الدور')}<select name="role">${options.map((role) => `<option value="${role}">${roleLabel(role)}</option>`).join('')}</select></label>
      ${button('invite', t('Send or update invitation', 'أرسل الدعوة أو حدّثها'))}</form>` : ''}
    <ul class="project-list">${current.members.map((member) => `<li><bdi>${author(member.name ?? member.account_id)}</bdi> · ${roleLabel(member.role)} · ${statusLabel(member.state)}
      ${['pending','accepted'].includes(member.state) && (member.role !== 'administrator' || current.role === 'owner') ?
        `<form class="project-tools" method="post" action="${action}">${hidden('peer',member.account_id)}${button('revoke', t('Revoke access', 'ألغِ الوصول'))}</form>` : ''}</li>`).join('')}</ul>` : ''}
    <h2>${t('Manuscripts', 'المخطوطات')}</h2>
    <form class="workspace-form" method="get" action="${path}">
      ${hidden('lang',lang)}
      <label>${t('Search titles, authors, tags or DOI', 'ابحث بالعناوين أو المؤلفين أو الوسوم أو DOI')}<input name="q" maxlength="150" dir="auto" value="${escapeHtml(query)}"></label>
      <label>${t('Publication status', 'حالة النشر')}<select name="stage"><option value="">${t('All statuses', 'كل الحالات')}</option>
      ${publicationStages.map((item) => `<option value="${item}"${stage === item ? ' selected' : ''}>${stageLabel(item)}</option>`).join('')}</select></label>
      <button class="action">${t('Search catalog', 'ابحث في الفهرس')}</button>
    </form>
    <ul class="project-list">${current.manuscripts.map((item) => `<li><a href="${action}&amp;manuscript=${item.id}"><bdi>${escapeHtml(item.title)}</bdi> · v${item.version}</a><small>${stageLabel(item.stage)}${item.authors ? ` · <bdi>${escapeHtml(listLabels(item.authors))}</bdi>` : ''}</small></li>`).join('')}</ul>
    ${offset || current.manuscripts.length === 50 ? `<nav class="project-tools">
      ${offset ? `<a href="${more(Math.max(0,offset - 50))}">${t('Previous results', 'النتائج السابقة')}</a>` : ''}
      ${current.manuscripts.length === 50 ? `<a href="${more(offset + 50)}">${t('More results', 'مزيد من النتائج')}</a>` : ''}
    </nav>` : ''}
    ${latest ? `<details${meta ? ' open' : ''}><summary>${t('Manuscript catalog metadata', 'بيانات فهرس المخطوطة')}</summary>
      <p>${stageLabel(meta?.stage ?? 'draft')} ${meta?.doi ? `· <a href="https://doi.org/${encodeURIComponent(meta.doi)}"><bdi>${escapeHtml(meta.doi)}</bdi></a>` : ''}</p>
      ${meta ? `<p dir="auto">${escapeHtml(listLabels(meta.authors))}</p><p dir="auto">${escapeHtml(listLabels(meta.tags))}</p>` : ''}
      ${write ? `<form class="workspace-form" method="post" action="${action}">
        ${hidden('manuscript',selected)}${hidden('base',meta?.revision ?? 0)}
        <label>${t('Authors, one per line', 'المؤلفون، اسم في كل سطر')}<textarea name="authors" maxlength="2020" dir="auto">${escapeHtml(lines(meta?.authors))}</textarea></label>
        <label>${t('Tags, one per line', 'الوسوم، وسم في كل سطر')}<textarea name="tags" maxlength="820" dir="auto">${escapeHtml(lines(meta?.tags))}</textarea></label>
        <label>${t('Publication status', 'حالة النشر')}<select name="stage">${publicationStages.map((item) =>
          `<option value="${item}"${item === (meta?.stage ?? 'draft') ? ' selected' : ''}>${stageLabel(item)}</option>`).join('')}</select></label>
        <label>DOI<input name="doi" dir="ltr" maxlength="253" value="${escapeHtml(meta?.doi ?? '')}"></label>
        ${button('metadata',t('Save catalog revision','احفظ مراجعة الفهرس'))}</form>` : ''}
      ${current.metadata.length ? `<details><summary>${t('Catalog revision history', 'سجل مراجعات الفهرس')}</summary>
        <ol class="activity">${current.metadata.map((entry) => `<li>v${entry.revision} · ${stageLabel(entry.stage)} ·
          <bdi>${author(entry.editor)}</bdi> · ${when(entry.recorded_at)}
          <p dir="auto">${escapeHtml([listLabels(entry.authors),listLabels(entry.tags),entry.doi].filter(Boolean).join(' · '))}</p></li>`).join('')}</ol></details>` : ''}
    </details>` : ''}
    ${write ? `<form class="workspace-form" method="post" action="${action}">
      ${latest ? hidden('manuscript',selected) + hidden('base',latest.version) : `<label>${t('Title', 'العنوان')}<input name="title" maxlength="150" required dir="auto"></label>`}
      <label>${t('Manuscript text', 'نص المخطوطة')}<textarea name="body" rows="5" maxlength="12000" required dir="auto">${escapeHtml(latest?.body ?? '')}</textarea></label>
      ${button('save', latest ? t('Save new version', 'احفظ إصدارًا جديدًا') : t('Create manuscript', 'أنشئ مخطوطة'))}</form>` : ''}
    ${latest ? `<h2>${t('Version history', 'سجل الإصدارات')}</h2><ol class="message-list project-list">${current.versions.map((version) =>
      `<li class="provider-block"><h3>v${version.version} · ${when(version.recorded_at)}</h3><small><bdi>${author(version.author)}</bdi></small><p dir="auto">${escapeHtml(version.body)}</p>
      ${review ? instance(hidden('version',version.id)) : ''}</li>`).join('')}</ol>` : ''}
    <h2>${t('Evidence for review', 'الأدلة للمراجعة')}</h2>
    <ul class="project-list">${current.evidence.map((item) => `<li class="provider-block"><p dir="auto">${escapeHtml(item.statement)}</p>
      <details><summary>${t('Source snapshot', 'لقطة المصدر')}</summary><p dir="auto">${escapeHtml(item.source_snapshot)}</p></details>
      ${review ? instance(hidden('item',item.id)) : ''}</li>`).join('')}</ul>
    <h2>${t('Recorded reviews', 'المراجعات المسجّلة')}</h2>
    <ul class="project-list">${current.reviews.map((item) => `<li class="provider-block">
      <p>${item.manuscript_id ? `<a href="${action}&amp;manuscript=${item.manuscript_id}"><bdi>${escapeHtml(item.manuscript_title)} · v${item.version}</bdi></a>` :
        `<bdi>${t('Evidence', 'دليل')} ${escapeHtml(item.evidence_id)}</bdi>`} · ${statusLabel(item.outcome)}</p>
      <p dir="auto">${escapeHtml(item.note)}</p><small><bdi>${author(item.reviewer)}</bdi> · ${when(item.recorded_at)}</small></li>`).join('')}</ul>
    ${current.rights.includes('audit') ? `<h2>${t('Team activity', 'نشاط الفريق')}</h2><ul class="activity">${current.events.map((event) =>
      `<li>${statusLabel(event.action)} · <bdi>${author(event.actor)}</bdi> · ${when(event.recorded_at)}</li>`).join('')}</ul>` : ''}`);
}
