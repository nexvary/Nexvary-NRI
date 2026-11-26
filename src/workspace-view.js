const labels = {
  signIn: ['Sign in', 'تسجيل الدخول'],
  signOut: ['Sign out', 'تسجيل الخروج'],
  email: ['Email address', 'البريد الإلكتروني'],
  password: ['Password', 'كلمة المرور'],
  credentials: ['The email address or password is incorrect.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
  rateLimit: ['Too many attempts. Try again shortly.', 'محاولات كثيرة. جرّب مجددًا بعد قليل.'],
  workspace: ['Research workspace', 'إدارة الأبحاث'],
  projects: ['My projects', 'مشاريعي'],
  newProject: ['New project', 'مشروع جديد'],
  back: ['Back to my projects', 'العودة إلى مشاريعي'],
  title: ['Project title', 'اسم المشروع'],
  description: ['Summary', 'الملخّص'],
  create: ['Create project', 'إنشاء المشروع'],
  save: ['Save changes', 'حفظ التعديلات'],
  remove: ['Delete project', 'حذف المشروع'],
  confirm: ['Confirm deletion', 'أؤكد حذف المشروع'],
  missing: ['Project unavailable', 'المشروع غير متاح'],
  empty: ['Your projects will appear here after you create one.', 'ستظهر مشاريعك هنا بعد إنشاء أول مشروع.'],
  invalid: ['Enter a title of up to 120 characters and a summary of up to 2,000 characters.', 'أدخل اسمًا من 120 حرفًا بحد أقصى وملخّصًا من 2000 حرف بحد أقصى.'],
};

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escape(value) {
  return value.replaceAll(/[&<>"']/g, (character) => entities[character]);
}

export function workspacePath(lang, id) {
  return `/workspace${id ? `/projects/${id}` : ''}?lang=${lang}`;
}

export function loginPath(lang) {
  return `/login?lang=${lang}`;
}

export function workspacePage(lang, kind, options = {}) {
  const t = (key) => labels[key][lang === 'ar' ? 1 : 0];
  const { account, error, projects = [], id, values = { title: '', description: '' } } = options;
  const workspace = workspacePath(lang);
  const feedback = error ? `<p class="form-error" role="alert">${t(error)}</p>` : '';
  const panel = (title, path, html) => ({ title, path, html });
  if (kind === 'login') {
    return panel(t('signIn'), '/login', `
      <section class="surface panel detail workspace-page">
        <h1>${t('signIn')}</h1>
        ${feedback}
        <form method="post" action="${loginPath(lang)}" class="workspace-form">
          <label>${t('email')}<input name="email" type="email" dir="ltr" autocomplete="username" maxlength="254" required></label>
          <label>${t('password')}<input name="password" type="password" dir="ltr" autocomplete="current-password" maxlength="128" required></label>
          <button class="action" type="submit">${t('signIn')}</button>
        </form>
      </section>`);
  }
  if (kind === 'missing') {
    return panel(t('missing'), '/workspace', `
      <section class="surface panel detail workspace-page">
        <h1>${t('missing')}</h1><a class="action" href="${workspace}">${t('back')}</a>
      </section>`);
  }

  const action = workspacePath(lang, id);
  const editor = `
    ${feedback}
    <form method="post" action="${action}" class="workspace-form">
      <label>${t('title')}<input name="title" dir="auto" maxlength="120" required value="${escape(values.title)}"></label>
      <label>${t('description')}<textarea name="description" dir="auto" maxlength="2000" rows="5">${escape(values.description)}</textarea></label>
      <button class="action" type="submit">${t(id ? 'save' : 'create')}</button>
    </form>`;

  if (kind === 'project') {
    return panel(t('workspace'), `/workspace/projects/${id}`, `
      <section class="surface panel detail workspace-page">
        <a href="${workspace}">${t('back')}</a>
        <h1 dir="auto">${escape(values.title)}</h1>
        ${editor}
        <form method="post" action="/workspace/projects/${id}/delete?lang=${lang}" class="delete-project">
          <label><input type="checkbox" name="confirm" value="yes" required> ${t('confirm')}</label>
          <button type="submit" class="action danger">${t('remove')}</button>
        </form>
      </section>`);
  }

  return panel(t('workspace'), '/workspace', `
    <section class="surface panel detail workspace-page">
      <div class="workspace-heading">
        <div><h1>${t('workspace')}</h1><p><bdi>${escape(account.email)}</bdi></p></div>
        <form method="post" action="/logout?lang=${lang}"><button class="action" type="submit">${t('signOut')}</button></form>
      </div>
      <section class="project-list">
        <h2>${t('projects')}</h2>
        ${projects.length
          ? `<ul>${projects.map((project) => `<li><a href="${workspacePath(lang, project.id)}"><bdi>${escape(project.title)}</bdi></a></li>`).join('')}</ul>`
          : `<p>${t('empty')}</p>`}
      </section>
      <section class="project-editor"><h2>${t('newProject')}</h2>${editor}</section>
    </section>`);
}
