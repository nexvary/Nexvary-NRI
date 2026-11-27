import { escapeHtml } from './workspace-view.js';

const number = (value) => /^[1-9]\d{0,9}$/.test(value ?? '') ? Number(value) : 0;

export function handleTeamWork({ request, reply, redirect, route, account, form, lang, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const { id } = route;
  const actor = account.id;
  const path = '/workspace/projects/' + id + '/team/work';
  const url = path + '?lang=' + lang;
  const offset = number(new URL(request.url, 'http://localhost').searchParams.get('offset'));
  const current = store.teams.work(actor, id, offset);
  if (!current) return reply(404);
  const intent = form?.get('intent');
  if (form) {
    let status = 422;
    if (intent === 'note' || intent === 'task') status = store.teams.addWork(actor, id, intent, (form.get('text') ?? '').trim());
    if (intent === 'task-state') {
      const task = number(form.get('task'));
      if (task) status = store.teams.changeTask(actor, id, task, form.get('from'), form.get('to'));
    }
    return status === 303 ? redirect(url) : reply(status);
  }
  const title = t('Team notes and tasks', 'ملاحظات الفريق ومهامه');
  const time = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const person = (value) => escapeHtml(value ?? t('Deleted account', 'حساب محذوف'));
  const write = current.rights.includes('write');
  reply(200, {
    title, path,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>
      <p><a href="/workspace/projects/${id}/team?lang=${lang}">${t('Project team', 'فريق المشروع')}</a></p>
      <h2 dir="auto">${escapeHtml(current.title)}</h2>
      <h2>${t('Tasks', 'المهام')}</h2>
      ${write ? `<form method="post" action="${url}" class="workspace-form">
        <label>${t('Task title', 'عنوان المهمة')}<input name="text" dir="auto" required maxlength="150"></label>
        <button class="action" name="intent" value="task">${t('Add task', 'أضف مهمة')}</button>
      </form>` : ''}
      ${current.tasks.length ? `<ul class="project-list">${current.tasks.map((task) => `<li class="provider-block">
        <p dir="auto">${escapeHtml(task.title)}</p>
        <small>${task.state === 'open' ? t('Open', 'مفتوحة') : t('Done', 'مكتملة')}
          · <bdi>${person(task.updated_by)}</bdi> · ${time.format(task.updated_at)}</small>
        ${write ? `<form method="post" action="${url}" class="project-tools">
          <input type="hidden" name="task" value="${task.id}"><input type="hidden" name="from" value="${task.state}">
          <input type="hidden" name="to" value="${task.state === 'open' ? 'done' : 'open'}">
          <button class="action" name="intent" value="task-state">${task.state === 'open' ? t('Mark as done', 'علّمها مكتملة') : t('Reopen task', 'أعد فتح المهمة')}</button>
        </form>` : ''}
      </li>`).join('')}</ul>` : `<p>${t('No tasks on this page.', 'لا توجد مهام في هذه الصفحة.')}</p>`}
      <h2>${t('Notes', 'الملاحظات')}</h2>
      ${write ? `<form method="post" action="${url}" class="workspace-form">
        <label>${t('Team note', 'ملاحظة للفريق')}<textarea name="text" dir="auto" required maxlength="2000"></textarea></label>
        <button class="action" name="intent" value="note">${t('Add note', 'أضف ملاحظة')}</button>
      </form>` : ''}
      ${current.notes.length ? `<ul class="project-list message-list">${current.notes.map((note) => `<li class="provider-block">
        <small><bdi>${person(note.author)}</bdi> · ${time.format(note.recorded_at)}</small>
        <p dir="auto">${escapeHtml(note.body)}</p></li>`).join('')}</ul>` : `<p>${t('No notes on this page.', 'لا توجد ملاحظات في هذه الصفحة.')}</p>`}
      ${offset || current.tasks.length === 50 || current.notes.length === 50 ? `<nav class="project-tools">
        ${offset ? `<a href="${url}&amp;offset=${Math.max(0, offset - 50)}">${t('Previous', 'السابق')}</a>` : ''}
        ${current.tasks.length === 50 || current.notes.length === 50 ? `<a href="${url}&amp;offset=${offset + 50}">${t('Next', 'التالي')}</a>` : ''}
      </nav>` : ''}
    </section>`,
  });
}
