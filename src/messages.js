import { escapeHtml } from './workspace-view.js';

const path = '/workspace/messages';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const categories = { spam: ['Spam', 'رسائل مزعجة'], harassment: ['Harassment', 'مضايقة'], other: ['Other', 'أخرى'] };

function positiveInteger(input) {
  if (!/^[1-9]\d{0,14}$/.test(input ?? '')) return undefined;
  return Number(input);
}

export function resolveMessageRoute(pathname) {
  if (pathname === path) return { kind: 'messages' };
  const id = pathname.startsWith(path + '/') ? pathname.slice(path.length + 1) : '';
  return uuid.test(id) ? { kind: 'messages-thread', id } : undefined;
}

export function handleMessages({ request, reply, redirect, route, lang, account, form, store }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const owner = account.id;
  const { id } = route;
  const currentPath = id ? path + '/' + id : path;
  const href = (thread) => (thread ? path + '/' + thread : path) + '?lang=' + lang;
  const params = new URL(request.url, 'http://localhost').searchParams;
  const intent = form?.get('intent');
  const title = t('Messages', 'الرسائل');
  const count = (n) => new Intl.NumberFormat(lang).format(n);
  const { messages } = store;
  let status = 200;

  if (!id) {
    if (form) {
      if (intent === 'start') {
        const peer = form.get('peer') ?? '';
        const thread = uuid.test(peer) ? messages.open(owner, peer) : undefined;
        return thread ? redirect(href(thread)) : reply(404);
      }
      if (intent !== 'preferences') return reply(422);
      messages.setNotifications(owner, form.get('notifications') === 'yes');
      return redirect(href());
    }
    const offset = positiveInteger(params.get('offset')) ?? 0;
    const inbox = messages.inbox(owner, offset);
    const collaborators = messages.peers(owner);
    const notifications = messages.notifications(owner);
    const unread = messages.unread(owner);
    return reply(200, {
      title, path,
      html: `<section class="surface panel detail workspace-page">
        <h1>${title}</h1>
        <p>${t('Unread messages', 'الرسائل غير المقروءة')} · ${count(unread)}</p>
        ${notifications && unread ? `<p role="status">${t('You have unread messages.', 'لديك رسائل غير مقروءة.')}</p>` : ''}
        ${inbox.length ? `<ul class="project-list">${inbox.map((item) => `<li><a href="${href(item.id)}">
          <bdi>${escapeHtml(item.name || t('Private researcher', 'باحث خاص'))}</bdi>
          ${item.unread ? ` · ${t('Unread', 'غير مقروء')} ${count(item.unread)}` : ''}
        </a></li>`).join('')}</ul>` : `<p>${t('No conversations on this page.', 'لا توجد محادثات في هذه الصفحة.')}</p>`}
        <nav class="project-tools">
          ${offset ? `<a href="${href()}&amp;offset=${Math.max(0, offset - 50)}">${t('Previous conversations', 'المحادثات السابقة')}</a>` : ''}
          ${inbox.length === 50 ? `<a href="${href()}&amp;offset=${offset + 50}">${t('More conversations', 'مزيد من المحادثات')}</a>` : ''}
        </nav>
        ${collaborators.length ? `<form class="workspace-form" method="post" action="${href()}">
          <label>${t('Accepted collaborator', 'متعاون مقبول')}<select name="peer" required>
            ${collaborators.map((peer) => `<option value="${peer.id}">${escapeHtml(peer.name)}</option>`).join('')}
          </select></label>
          <button class="action" name="intent" value="start">${t('Open conversation', 'افتح محادثة')}</button>
        </form>` : `<p>${t('Accept a collaboration request to start a conversation.', 'اقبل طلب تعاون لبدء محادثة.')}</p>`}
        <form class="workspace-form" method="post" action="${href()}">
          <label><input name="notifications" type="checkbox" value="yes"${notifications ? ' checked' : ''}> ${t('In-app unread notifications', 'إشعارات الرسائل غير المقروءة داخل التطبيق')}</label>
          <button class="action" name="intent" value="preferences">${t('Save preference', 'احفظ التفضيل')}</button>
        </form>
      </section>`,
    });
  }

  const thread = messages.thread(owner, id);
  if (!thread) return reply(404);
  if (form) {
    const sequence = positiveInteger(form.get('message'));
    switch (intent) {
      case 'read':
        return sequence && messages.mark(owner, id, sequence) ? redirect(href(id)) : reply(404);
      case 'block':
        if (!thread.ownBlock) store.network.blockParticipant(owner, thread.peer);
        return redirect(href(id));
      case 'unblock':
        if (thread.ownBlock) store.network.interact(owner, thread.peer, 'unblock');
        return redirect(href(id));
      case 'report': {
        const category = form.get('category');
        if (!sequence || !Object.hasOwn(categories, category)) return reply(422);
        status = messages.report(owner, id, sequence, category);
        break;
      }
      case 'send': {
        const text = (form.get('text') ?? '').trim();
        status = text && text.length <= 2000 ? messages.send(owner, id, text) : 422;
        break;
      }
      default: return reply(422);
    }
    if (status === 303) return redirect(href(id));
    if (status === 404) return reply(404);
  }
  const before = positiveInteger(params.get('before'));
  const records = messages.list(owner, id, before ?? null);
  const page = records.slice(0, 50);
  const latest = page[0]?.id;
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  reply(status, {
    title, path: currentPath,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title} · <bdi>${escapeHtml(thread.name || t('Private researcher', 'باحث خاص'))}</bdi></h1>
      <p><a href="${href()}">${t('Back to inbox', 'العودة إلى صندوق الرسائل')}</a></p>
      ${status !== 200 ? `<p role="alert">${status === 429 ? t('Please wait before trying again.', 'انتظر قبل إعادة المحاولة.') :
        t('The action could not be completed.', 'تعذّر إكمال الإجراء.')}</p>` : ''}
      ${records.length > 50 ? `<p><a href="${href(id)}&amp;before=${page.at(-1).id}">${t('Older messages', 'الرسائل الأقدم')}</a></p>` : ''}
      ${before ? `<p><a href="${href(id)}">${t('Latest messages', 'أحدث الرسائل')}</a></p>` : ''}
      <ol class="project-list message-list">${page.reverse().map(({ id: sequence, mine, text, createdAt, reported }) => `<li class="provider-block">
        <small>${mine ? t('You', 'أنت') : escapeHtml(thread.name || t('Researcher', 'الباحث'))} · ${date.format(createdAt)}</small>
        <p dir="auto">${escapeHtml(text)}</p>
        ${mine ? '' : reported ? `<small>${t('Reported', 'تم الإبلاغ')}</small>` : `<form class="project-tools" method="post" action="${href(id)}">
          <input type="hidden" name="message" value="${sequence}">
          <select name="category" aria-label="${t('Report reason', 'سبب الإبلاغ')}">${Object.entries(categories).map(([key, labels]) => `<option value="${key}">${t(...labels)}</option>`).join('')}</select>
          <button class="action" name="intent" value="report">${t('Report', 'أبلغ')}</button>
        </form>`}
      </li>`).join('')}</ol>
      ${thread.blocked ? `<p>${t('Sending is disabled for this conversation.', 'الإرسال معطّل لهذه المحادثة.')}</p>` : `<form class="workspace-form" method="post" action="${href(id)}">
        <label>${t('Message', 'الرسالة')}<textarea name="text" required maxlength="2000" dir="auto"></textarea></label>
        <button class="action" name="intent" value="send">${t('Send message', 'أرسل الرسالة')}</button>
      </form>`}
      <form class="project-tools" method="post" action="${href(id)}">
        ${latest ? `<input type="hidden" name="message" value="${latest}"><button class="action" name="intent" value="read">${t('Mark displayed messages as read', 'علّم الرسائل المعروضة كمقروءة')}</button>` : ''}
        <button class="action" name="intent" value="${thread.ownBlock ? 'unblock' : 'block'}">${thread.ownBlock ? t('Unblock researcher', 'ألغِ حظر الباحث') : t('Block researcher', 'احظر الباحث')}</button>
      </form>
    </section>`,
  });
}
