import { copy, dimensions } from './content.js';
import { resolverUrl } from './crossref.js';
import { escapeHtml, workspacePage, workspacePath } from './workspace-view.js';

const levels = {
  unavailable: ['Unavailable', 'غير متاح'],
  preliminary: ['Preliminary', 'أولي'],
  independent: ['Independent evidence within limited scope', 'أدلة مستقلة ضمن نطاق محدود'],
  integrated: ['Integrated and fit for the intended use', 'متكامل وملائم للاستخدام المقصود'],
};
const safety = {
  unresolved: ['Unresolved', 'غير محسومة'],
  unsafe: ['Unsafe use identified', 'رُصد استخدام غير آمن'],
  documented: ['Documented for this use', 'موثقة لهذا الاستخدام'],
};
const authorization = {
  unknown: ['Unknown', 'غير معروفة'],
  missing: ['Required authorization missing', 'التصريح المطلوب مفقود'],
  documented: ['Requirement satisfied or inapplicable', 'استُوفي الشرط أو لا ينطبق'],
};
const labels = {
  title: ['L-READY assessment', 'تقييم L-READY'],
  project: ['Choose a project', 'اختر مشروعًا'],
  back: ['Back to project', 'العودة إلى المشروع'],
  intended: ['Intended use', 'الاستخدام المقصود'],
  limits: ['Limitations or evidence gap', 'القيود أو فجوة الأدلة'],
  category: ['Evidence category', 'فئة الأدلة'],
  source: ['Reviewed source', 'المصدر المُراجع'],
  noSource: ['Select a source', 'اختر مصدرًا'],
  safety: ['Safety status', 'حالة السلامة'],
  authorization: ['Required authorization', 'التصريح المطلوب'],
  blocked: ['Assessment blocked by safety or authorization', 'التقييم متوقف بسبب السلامة أو التصريح'],
  gaps: ['Evidence gaps remain', 'لا تزال هناك فجوات في الأدلة'],
  recorded: ['Evidence categories and governance status recorded', 'سُجِلت فئات الأدلة وحالة الحوكمة'],
  reviewer: ['Reviewer', 'المراجع'],
  history: ['Revision history', 'سجل المراجعات'],
  revise: ['Revise assessment', 'حدّث التقييم'],
  create: ['New assessment', 'تقييم جديد'],
  save: ['Save assessment', 'احفظ التقييم'],
  invalid: ['Check the required fields and select a reviewed source for each non-empty evidence category. Reload before revising a changed assessment.', 'تحقق من الحقول المطلوبة واختر مصدرًا مُراجعًا لكل فئة أدلة غير فارغة. أعد تحميل الصفحة قبل تعديل تقييم تغيّر.'],
};

export function resolveReadinessRoute(pathname) {
  if (pathname === '/workspace/readiness-projects') return { kind: 'readiness-projects' };
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/readiness$/);
  if (match) return { kind: 'readiness', id: match[1] };
}

export function readinessState(assessment) {
  if (assessment.safety !== 'documented' || assessment.authorization !== 'documented') return 'blocked';
  return assessment.dimensions.some((item) => item.level !== 'integrated') ? 'gaps' : 'recorded';
}

const path = (lang, id) => `/workspace/projects/${id}/readiness?lang=${lang}`;

export function createReadinessHandler(store) {
  return ({ request, reply, redirect, route, lang, account, form }) => {
    const tr = (pair) => pair[lang === 'ar' ? 1 : 0];
    const t = (key) => tr(labels[key]);
    const owner = account.id;
    const { id } = route;
    const title = t('title');
    const panel = (path, html, status = 200) => reply(status, {
      title, path, html: `<section class="surface panel detail workspace-page"><h1>${title}</h1><p>${tr(copy.framework)}</p>${html}</section>`,
    });
    if (!id) {
      panel('/workspace/readiness-projects', `<h2>${t('project')}</h2><ul class="project-list">${store.listProjects(owner).map((p) =>
        `<li><a href="${path(lang,p.id)}"><bdi>${escapeHtml(p.title)}</bdi></a></li>`).join('')}</ul><a href="${workspacePath(lang)}">${t('back')}</a>`);
      return;
    }
    const project = store.getProject(owner, id);
    if (!project) {
      reply(404, workspacePage(lang, 'missing'));
      return;
    }
    const items = store.evidence.list(owner, id).flatMap((claim) => claim.evidence)
      .filter((item) => item.review?.decision === 'accepted');
    const reviewed = new Map(items.map((item) => [item.id, item]));
    let invalid = false;
    if (request.method === 'POST') {
      const value = (name) => (form.get(name) ?? '').trim();
      const assessmentId = value('id');
      const revision = Number(value('revision'));
      const intendedUse = value('intendedUse');
      const safetyStatus = value('safety');
      const authorizationStatus = value('authorization');
      const rows = dimensions.map(([letter]) => {
        const item = reviewed.get(value(letter + '-source'));
        return { letter, level: value(letter + '-level'), limits: value(letter + '-limits'),
          evidence: item ? { id: item.id, source: item.source, review: item.review } : null };
      });
      const valid = (assessmentId ? Number.isSafeInteger(revision) && revision > 0 : intendedUse.length > 0 && intendedUse.length <= 400)
        && Object.hasOwn(safety, safetyStatus) && Object.hasOwn(authorization, authorizationStatus)
        && rows.every((row) => Object.hasOwn(levels, row.level) && row.limits.length > 0
          && row.limits.length <= 1000 && (row.level === 'unavailable' || row.evidence));
      if (valid && store.readiness.save(owner, id, {
        id: assessmentId, revision, intendedUse, dimensions: rows, safety: safetyStatus, authorization: authorizationStatus,
      })) {
        redirect(path(lang, id));
        return;
      }
      invalid = true;
    }
    const revisions = store.readiness.list(owner, id);
    const groups = new Map();
    for (const revision of revisions) {
      if (!groups.has(revision.id)) groups.set(revision.id, []);
      groups.get(revision.id).push(revision);
    }
    const options = (entries, selected) => Object.entries(entries).map(([key, label]) =>
      `<option value="${key}"${selected === key ? ' selected' : ''}>${tr(label)}</option>`).join('');
    const editor = (assessment) => `<form method="post" action="${path(lang,id)}" class="workspace-form">
      ${assessment ? `<input type="hidden" name="id" value="${assessment.id}"><input type="hidden" name="revision" value="${assessment.revision}">`
        : `<label>${t('intended')}<input name="intendedUse" maxlength="400" required></label>`}
      <label>${t('safety')}<select name="safety">${options(safety, assessment?.safety)}</select></label>
      <label>${t('authorization')}<select name="authorization">${options(authorization, assessment?.authorization)}</select></label>
      ${dimensions.map(([letter, , color, name], index) => {
        const row = assessment?.dimensions[index];
        return `<fieldset class="provider-block"><legend class="tag ${color}"><bdi>${letter}</bdi> · ${tr(name)}</legend>
          <label>${t('category')}<select name="${letter}-level">${options(levels,row?.level)}</select></label>
          <label>${t('source')}<select name="${letter}-source"><option value="">${t('noSource')}</option>${items.map((item) =>
            `<option value="${item.id}"${row?.evidence?.id === item.id ? ' selected' : ''}>${escapeHtml(item.source.identifier)}</option>`).join('')}</select></label>
          <label>${t('limits')}<textarea name="${letter}-limits" maxlength="1000" required>${escapeHtml(row?.limits ?? '')}</textarea></label></fieldset>`;
      }).join('')}
      <button class="action">${t('save')}</button></form>`;
    const snapshot = (revision) => `<p class="tag ${readinessState(revision) === 'blocked' ? 'danger' : ''}">${t(readinessState(revision))}</p>
      <p>${t('safety')} · ${tr(safety[revision.safety])}<br>${t('authorization')} · ${tr(authorization[revision.authorization])}</p>
      <p>${t('reviewer')} · <bdi>${escapeHtml(revision.reviewer === owner ? account.email : revision.reviewer)}</bdi></p>
      <time dir="ltr">${new Date(revision.recordedAt).toISOString()}</time>
      <dl class="reference-meta">${revision.dimensions.map((row, index) => `<div>
        <dt><bdi>${row.letter}</bdi> · ${tr(dimensions[index][3])}</dt><dd>${tr(levels[row.level])}
        <p dir="auto">${escapeHtml(row.limits)}</p>
        ${row.evidence ? `<a dir="ltr" href="${resolverUrl(row.evidence.source.identifier)}">${escapeHtml(row.evidence.source.identifier)}</a>` : ''}</dd></div>`).join('')}</dl>`;
    panel(`/workspace/projects/${id}/readiness`, `<a href="${workspacePath(lang,id)}">${t('back')}</a>
      <p dir="auto">${escapeHtml(project.title)}</p>
      ${invalid ? `<p class="form-error" role="alert">${t('invalid')}</p>` : ''}
      ${[...groups.values()].map(([latest, ...past]) => `<article class="surface panel">
        <h2 dir="auto">${escapeHtml(latest.intendedUse)}</h2>${snapshot(latest)}
        <details><summary>${t('revise')}</summary>${editor(latest)}</details>
        ${past.length ? `<details><summary>${t('history')}</summary>${past.map(snapshot).join('')}</details>` : ''}</article>`).join('')}
      <h2>${t('create')}</h2>${editor()}`, invalid ? 422 : 200);
  };
}
