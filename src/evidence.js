import { evidenceSourceSelection } from './evidence-store.js';
import { resolverUrl } from './crossref.js';
import { escapeHtml, projectReferencesPath, workspacePage, workspacePath } from './workspace-view.js';

const copy = {
  heading: ['Evidence intelligence', 'تحليل الأدلة'],
  choose: ['Choose a project', 'اختر مشروعًا'],
  emptyProjects: ['Create a project first.', 'أنشئ مشروعًا أولًا.'],
  back: ['Back to project', 'العودة إلى المشروع'],
  references: ['Manage project sources', 'إدارة مصادر المشروع'],
  scope: ['Review decisions record a human judgment about the evidence link.', 'تسجل قرارات المراجعة حكمًا بشريًا على صلة الدليل بالادعاء.'],
  statement: ['Claim statement', 'نص الادعاء'],
  create: ['Add claim', 'أضف ادعاءً'],
  empty: ['No claims saved for this project.', 'لا توجد ادعاءات محفوظة لهذا المشروع.'],
  attach: ['Link evidence', 'اربط دليلًا'],
  source: ['Saved source', 'المصدر المحفوظ'],
  noSources: ['Save a source with reference metadata before linking evidence.', 'احفظ مصدرًا يتضمن بيانات مرجعية قبل ربط الأدلة.'],
  relation: ['Relationship', 'علاقة الدليل بالادعاء'],
  supports: ['Supports', 'يدعم'],
  conflicts: ['Conflicts', 'يعارض'],
  inconclusive: ['Inconclusive', 'غير حاسم'],
  type: ['Study type', 'نوع الدراسة'],
  limits: ['Limitations', 'القيود'],
  pending: ['Awaiting human review', 'بانتظار مراجعة بشرية'],
  accepted: ['Link accepted', 'قُبل ربط الدليل'],
  rejected: ['Link rejected', 'رُفض ربط الدليل'],
  note: ['Review rationale', 'مبررات المراجعة'],
  export: ['Export evidence matrix (JSON)', 'صدّر مصفوفة الأدلة بصيغة JSON'],
  invalid: ['Check the required fields and select an available source or review item.', 'تحقق من الحقول المطلوبة واختر مصدرًا أو عنصر مراجعة متاحًا.'],
};

export function resolveEvidenceRoute(path) {
  if (path === '/workspace/evidence-projects') return { kind: 'evidence-projects' };
  const match = path.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/evidence(\/export)?$/);
  if (match) return { kind: match[2] ? 'evidence-export' : 'evidence', id: match[1] };
}

const relations = ['supports', 'conflicts', 'inconclusive'];
const decisions = ['accepted', 'rejected'];
const evidencePath = (lang, id, suffix = '') => `/workspace/projects/${id}/evidence${suffix}?lang=${lang}`;

export function createEvidenceHandler(store) {
  return ({ request, reply, redirect, route, lang, account, form }) => {
    const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
    const owner = account.id;
    const { kind, id } = route;
    const heading = t('heading');
    if (kind === 'evidence-projects') {
      const projects = store.listProjects(owner);
      reply(200, {
        title: heading, path: '/workspace/evidence-projects',
        html: `<section class="surface panel detail workspace-page"><h1>${heading}</h1>
          <h2>${t('choose')}</h2>${projects.length
            ? `<ul class="project-list">${projects.map((project) =>
              `<li><a href="${evidencePath(lang, project.id)}"><bdi>${escapeHtml(project.title)}</bdi></a></li>`).join('')}</ul>`
            : `<a href="${workspacePath(lang)}">${t('emptyProjects')}</a>`}</section>`,
      });
      return;
    }

    const project = store.getProject(owner, id);
    if (!project) {
      reply(404, workspacePage(lang, 'missing'));
      return;
    }
    if (kind === 'evidence-export') {
      reply(200, null, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="nri-evidence.json"',
      }, JSON.stringify({ version: 1, project, claims: store.evidence.list(owner, id) }, null, 2));
      return;
    }

    const sources = store.references.list(owner, id).filter((source) => source.status === 'found' && source.provider !== 'orcid');
    const action = evidencePath(lang, id);
    const selected = new URL(request.url, 'http://localhost').searchParams.get('source');
    let invalid = false;
    if (request.method === 'POST') {
      const field = (name) => (form.get(name) ?? '').trim();
      const bounded = (value, max) => value.length > 0 && value.length <= max;
      const statement = field('statement');
      const relation = field('relation');
      const studyType = field('studyType');
      const limitations = field('limitations');
      const source = sources.find((entry) => evidenceSourceSelection(entry) === field('source'));
      const decision = field('decision');
      const note = field('note');
      let saved = false;
      switch (field('intent')) {
        case 'claim':
          saved = bounded(statement, 2000) && store.evidence.addClaim(owner, id, statement);
          break;
        case 'link':
          saved = source && relations.includes(relation) && bounded(studyType, 120) && bounded(limitations, 2000) &&
            store.evidence.link(owner, id, { ...source, claim: field('claim'), relation, studyType, limitations });
          break;
        case 'review':
          saved = decisions.includes(decision) && bounded(note, 2000) &&
            store.evidence.review(owner, id, { item: field('item'), decision, note });
          break;
      }
      if (saved) {
        redirect(action);
        return;
      }
      invalid = true;
    }
    const claims = store.evidence.list(owner, id);
    const date = (ms) => `<time datetime="${new Date(ms).toISOString()}">${new Date(ms).toISOString()}</time>`;
    const sourceOptions = sources.map((source) => {
      const value = evidenceSourceSelection(source);
      const label = [source.provider, source.doi, new Date(source.checkedAt).toISOString()].join(' · ');
      return `<option value="${value}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    const matrix = claims.map((claim) => `<article class="surface panel reference-record">
      <h2 dir="auto">${escapeHtml(claim.statement)}</h2>
      ${claim.evidence.map((item) => `<section class="provider-block">
        <h3>${t(item.relation)}</h3>
        <p><a href="${resolverUrl(item.source.identifier)}" dir="ltr">${escapeHtml(item.source.identifier)}</a>
          <bdi>${escapeHtml(item.source.provider)}</bdi> ${date(item.source.retrievedAt)}</p>
        <dl class="reference-meta"><div><dt>${t('type')}</dt><dd dir="auto">${escapeHtml(item.studyType)}</dd></div>
          <div><dt>${t('limits')}</dt><dd dir="auto">${escapeHtml(item.limitations)}</dd></div></dl>
        ${item.review ? `<p><strong>${t(item.review.decision)}</strong> ${date(item.review.reviewedAt)}</p>
          <p dir="auto">${escapeHtml(item.review.note)}</p>` : `<form method="post" action="${action}" class="workspace-form">
          <p>${t('pending')}</p><input type="hidden" name="intent" value="review"><input type="hidden" name="item" value="${item.id}">
          <label>${t('note')}<textarea name="note" maxlength="2000" required></textarea></label>
          <div class="project-tools">${decisions.map((key) => `<button class="action" name="decision" value="${key}">${t(key)}</button>`).join('')}</div>
        </form>`}</section>`).join('')}
      ${sources.length ? `<form method="post" action="${action}" class="workspace-form">
        <input type="hidden" name="intent" value="link"><input type="hidden" name="claim" value="${claim.id}">
        <label>${t('source')}<select name="source" required>${sourceOptions}</select></label>
        <label>${t('relation')}<select name="relation">${relations.map((key) =>
          `<option value="${key}">${t(key)}</option>`).join('')}</select></label>
        <label>${t('type')}<input name="studyType" maxlength="120" required></label>
        <label>${t('limits')}<textarea name="limitations" maxlength="2000" required></textarea></label>
        <button class="action">${t('attach')}</button></form>` : `<p>${t('noSources')}</p>`}
    </article>`).join('');
    reply(invalid ? 422 : 200, {
      title: heading, path: `/workspace/projects/${id}/evidence`,
      html: `<section class="surface panel detail workspace-page">
        <a href="${workspacePath(lang, id)}">${t('back')}</a>
        <h1>${heading}</h1><p dir="auto">${escapeHtml(project.title)}</p><p>${t('scope')}</p>
        <nav class="project-tools"><a href="${projectReferencesPath(lang,id)}">${t('references')}</a>
          <a href="${evidencePath(lang,id,'/export')}">${t('export')}</a></nav>
        ${invalid ? `<p class="form-error" role="alert">${t('invalid')}</p>` : ''}
        <form method="post" action="${action}" class="workspace-form">
          <input type="hidden" name="intent" value="claim">
          <label>${t('statement')}<textarea name="statement" maxlength="2000" required></textarea></label>
          <button class="action">${t('create')}</button>
        </form>
        ${matrix || `<p>${t('empty')}</p>`}
      </section>`,
    });
  };
}
