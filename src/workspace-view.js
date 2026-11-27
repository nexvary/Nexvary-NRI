const labels = {
  signIn: ['Sign in', 'تسجيل الدخول'],
  signOut: ['Sign out', 'تسجيل الخروج'],
  email: ['Email address', 'البريد الإلكتروني'],
  projectLimit: ['Your plan’s project limit has been reached.', 'بلغت الحد الأقصى للمشاريع في خطتك.'],
  mfaCode: ['Authenticator or recovery code (if enabled)', 'رمز المصادقة أو الاسترداد، إذا كان التحقق مفعّلًا'],
  password: ['Password', 'كلمة المرور'],
  credentials: ['The sign-in details are incorrect.', 'بيانات تسجيل الدخول غير صحيحة.'],
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
  missing: ['Project unavailable', 'المشروع غير متاح'],
  empty: ['Your projects will appear here after you create one.', 'ستظهر مشاريعك هنا بعد إنشاء أول مشروع.'],
  confirmProject: ['Confirm deletion of this project and its files', 'أؤكد حذف المشروع وكل ملفاته'],
  documents: ['Private PDFs', 'ملفات PDF الخاصة'],
  sharing: ['Project invitations', 'دعوات المشروع'],
  reports: ['Report studio', 'استوديو التقارير'],
  economics: ['Economic feasibility', 'الجدوى الاقتصادية'],
  readiness: ['L-READY assessment', 'تقييم L-READY'],
  evidence: ['Evidence intelligence', 'تحليل الأدلة'],
  references: ['Reference validator', 'التحقق من المراجع'],
  emptyDocuments: ['This project has no PDFs yet.', 'لم تُضف ملفات PDF إلى هذا المشروع بعد.'],
  backToProject: ['Back to the project', 'العودة إلى المشروع'],
  backToDocuments: ['Back to project files', 'العودة إلى ملفات المشروع'],
  pdfFile: ['PDF file', 'ملف PDF'],
  upload: ['Upload PDF', 'رفع ملف PDF'],
  uploadVersion: ['Upload new version', 'رفع إصدار جديد'],
  history: ['Version history', 'سجل الإصدارات'],
  version: ['Version', 'الإصدار'],
  download: ['Download PDF', 'تنزيل PDF'],
  bytes: ['bytes', 'بايت'],
  fileLimit: ['Up to 8 MiB per PDF.', 'الحد الأقصى 8 ميبيبايت لكل ملف PDF.'],
  invalidPdf: ['Choose one PDF file with a valid PDF signature.', 'اختر ملف PDF واحدًا بتوقيع صالح.'],
  largePdf: ['The PDF exceeds the 8 MiB limit.', 'يتجاوز الملف الحد الأقصى البالغ 8 ميبيبايت.'],
  uploadBusy: ['Other uploads are in progress. Try again shortly.', 'هناك ملفات أخرى قيد الرفع. جرّب مرة أخرى بعد قليل.'],
  deleteDocument: ['Delete PDF and all versions', 'حذف ملف PDF وكل إصداراته'],
  confirmDocument: ['Confirm file deletion', 'أؤكد حذف الملف'],
  invalid: ['Enter a title of up to 120 characters and a summary of up to 2,000 characters.', 'أدخل اسمًا من 120 حرفًا بحد أقصى وملخّصًا من 2000 حرف بحد أقصى.'],
};

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return value.replaceAll(/[&<>"']/g, (character) => entities[character]);
}

export function workspacePath(lang, id) {
  return `/workspace${id ? `/projects/${id}` : ''}?lang=${lang}`;
}

export function documentsPath(lang, projectId, documentId) {
  const root = `/workspace/projects/${projectId}/documents`;
  return `${root}${documentId ? `/${documentId}` : ''}?lang=${lang}`;
}

export function referenceProjectsPath(lang) {
  return `/workspace/reference-projects?lang=${lang}`;
}

export function projectReferencesPath(lang, id) {
  return `/workspace/projects/${id}/references?lang=${lang}`;
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
          <label>${t('mfaCode')}<input name="mfa-code" dir="ltr" autocomplete="one-time-code" maxlength="19"></label>
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

  if (kind === 'documents' || kind === 'document') {
    const { project, document, documents, versions, documentId } = options;
    const route = documentsPath(lang, id, documentId);
    const path = route.split('?')[0];
    const upload = `
      ${feedback}
      <form method="post" action="${route}" enctype="multipart/form-data" class="workspace-form">
        <label>${t('pdfFile')}<input type="file" name="pdf" accept="application/pdf,.pdf" aria-describedby="pdf-limit" required></label>
        <small id="pdf-limit">${t('fileLimit')}</small>
        <button class="action" type="submit">${t(document ? 'uploadVersion' : 'upload')}</button>
      </form>`;

    if (kind === 'documents') {
      return panel(t('documents'), path, `
        <section class="surface panel detail workspace-page">
          <a href="${workspacePath(lang, id)}">${t('backToProject')}</a>
          <h1>${t('documents')}</h1><p dir="auto">${escapeHtml(project.title)}</p>
          <section class="project-list">
            ${documents.length
              ? `<ul>${documents.map((item) => `
                <li><a href="${documentsPath(lang, id, item.id)}"><bdi>${escapeHtml(item.title)}</bdi></a>
                  <small>${t('history')} · ${new Intl.NumberFormat(lang).format(item.versionCount)}</small></li>`).join('')}</ul>`
              : `<p>${t('emptyDocuments')}</p>`}
          </section>
          <section class="project-editor"><h2>${t('upload')}</h2>${upload}</section>
        </section>`);
    }

    const date = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', dateStyle: 'medium' });
    const numeric = new Intl.NumberFormat(lang);
    return panel(t('history'), path, `
      <section class="surface panel detail workspace-page">
        <a href="${documentsPath(lang, id)}">${t('backToDocuments')}</a>
        <h1 dir="auto">${escapeHtml(document.title)}</h1>
        <p><a href="${path}/reading?lang=${lang}">${lang === 'ar' ? 'ملاحظات القراءة' : 'Reading notes'}</a></p>
        <section class="project-list">
          <h2>${t('history')}</h2>
          <ol class="document-history">
            ${versions.map((item) => `
              <li><div><strong>${t('version')} ${numeric.format(item.number)}</strong><br>
                <bdi>${escapeHtml(item.filename)}</bdi><br>
                <time datetime="${new Date(item.created_at).toISOString()}">${date.format(item.created_at)}</time> · ${numeric.format(item.size)} ${t('bytes')}
              </div><a class="action" href="${path}/versions/${item.number}?lang=${lang}">${t('download')}</a></li>`).join('')}
          </ol>
        </section>
        <section class="project-editor"><h2>${t('uploadVersion')}</h2>${upload}</section>
        <form method="post" action="${path}/delete?lang=${lang}" class="delete-project">
          <label><input type="checkbox" name="confirm" value="yes" required> ${t('confirmDocument')}</label>
          <button type="submit" class="action danger">${t('deleteDocument')}</button>
        </form>
      </section>`);
  }

  const action = workspacePath(lang, id);
  const editor = `
    ${feedback}
    <form method="post" action="${action}" class="workspace-form">
      <label>${t('title')}<input name="title" dir="auto" maxlength="120" required value="${escapeHtml(values.title)}"></label>
      <label>${t('description')}<textarea name="description" dir="auto" maxlength="2000" rows="5">${escapeHtml(values.description)}</textarea></label>
      <button class="action" type="submit">${t(id ? 'save' : 'create')}</button>
    </form>`;

  if (kind === 'project') {
    return panel(t('workspace'), `/workspace/projects/${id}`, `
      <section class="surface panel detail workspace-page">
        <a href="${workspace}">${t('back')}</a>
        <h1 dir="auto">${escapeHtml(values.title)}</h1>
        <nav class="project-tools" aria-label="${t('workspace')}">
          <a class="action project-files" href="${documentsPath(lang, id)}">${t('documents')}</a>
          <a class="action" href="/workspace/projects/${id}/team?lang=${lang}">${lang === 'ar' ? 'فريق المشروع' : 'Project team'}</a>
          <a class="action" href="/workspace/projects/${id}/citations?lang=${lang}">${lang === 'ar' ? 'مكتبة الاستشهادات' : 'Citation library'}</a>
          <a class="action" href="${projectReferencesPath(lang, id)}">${t('references')}</a>
          <a class="action" href="/workspace/projects/${id}/evidence?lang=${lang}">${t('evidence')}</a>
          <a class="action" href="/workspace/projects/${id}/readiness?lang=${lang}">${t('readiness')}</a>
          <a class="action" href="/workspace/projects/${id}/economics?lang=${lang}">${t('economics')}</a>
          <a class="action" href="/workspace/projects/${id}/reports?lang=${lang}">${t('reports')}</a>
          <a class="action" href="/workspace/projects/${id}/sharing?lang=${lang}">${t('sharing')}</a>
        </nav>
        ${editor}
        <form method="post" action="/workspace/projects/${id}/delete?lang=${lang}" class="delete-project">
          <label><input type="checkbox" name="confirm" value="yes" required> ${t('confirmProject')}</label>
          <button type="submit" class="action danger">${t('remove')}</button>
        </form>
      </section>`);
  }

  return panel(t('workspace'), '/workspace', `
    <section class="surface panel detail workspace-page">
      <div class="workspace-heading">
        <div><h1>${t('workspace')}</h1><p><bdi>${escapeHtml(account.email)}</bdi></p></div>
        <form method="post" action="/logout?lang=${lang}"><button class="action" type="submit">${t('signOut')}</button></form>
      </div>
      <section class="project-list">
        <h2>${t('projects')}</h2>
        ${projects.length
          ? `<ul>${projects.map((project) => `<li><a href="${workspacePath(lang, project.id)}"><bdi>${escapeHtml(project.title)}</bdi></a></li>`).join('')}</ul>`
          : `<p>${t('empty')}</p>`}
      </section>
      <section class="project-editor"><h2>${t('newProject')}</h2>${editor}</section>
    </section>`);
}
