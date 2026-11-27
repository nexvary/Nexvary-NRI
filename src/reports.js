import { renderLicensedReport } from './licensing-store.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dimensions } from './content.js';
import { resolverUrl } from './crossref.js';
import { readinessState } from './readiness.js';
import { escapeHtml, workspacePage, workspacePath } from './workspace-view.js';

const script = fileURLToPath(new URL('../scripts/render-report.py', import.meta.url));
const formats = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const copy = {
  title: ['Report studio', 'استوديو التقارير'],
  choose: ['Choose a project', 'اختر مشروعًا'],
  back: ['Research workspace', 'مساحة الأبحاث'],
  pdf: ['Download PDF', 'نزّل PDF'],
  docx: ['Download DOCX', 'نزّل DOCX'],
  unavailable: ['The local report renderer is unavailable.', 'أداة إنشاء التقارير المحلية غير متاحة.'],
  quota: ['The daily report export limit has been reached.', 'بلغت الحد اليومي لتصدير التقارير.'],
  busy: ['A report is being generated. Try again shortly.', 'يجري إنشاء تقرير. حاول مرة أخرى بعد قليل.'],
  references: ['Dated references', 'المراجع المؤرخة'],
  evidence: ['Claim-source evidence', 'أدلة الادعاءات ومصادرها'],
  readiness: ['L-READY assessments', 'تقييمات L-READY'],
  limitations: ['Limitations', 'القيود'],
  scope: ['Provider metadata and human assessments are attributed to their source. L-READY is a proposed qualitative framework. This report does not certify readiness or validate scientific claims.', 'تُنسب بيانات المزوّدين والتقييمات البشرية إلى مصادرها. ‏L-READY إطار نوعي مقترح. لا يمنح هذا التقرير شهادة جاهزية أو يثبت صحة الادعاءات العلمية.'],
  version: ['Template version', 'إصدار القالب'],
  created: ['Generated (UTC)', 'وقت الإنشاء بتوقيت UTC'],
  empty: ['No records for this section.', 'لا توجد سجلات في هذا القسم.'],
  identifier: ['Source identifier', 'معرّف المصدر'],
  name: ['Title', 'العنوان'],
  provider: ['Provider', 'المزوّد'],
  notices: ['Provider notices', 'إشعارات المزوّد'],
  flagged: ['Retraction flagged by provider', 'أشار المزوّد إلى السحب'],
  unverified: ['Retraction status unverified', 'حالة السحب غير مؤكدة'],
  retrieved: ['Retrieved (UTC)', 'تاريخ الجلب بتوقيت UTC'],
  authors: ['Authors', 'المؤلفون'],
  claim: ['Claim', 'الادعاء'],
  study: ['Study / relation', 'الدراسة والعلاقة'],
  review: ['Human review', 'المراجعة البشرية'],
  intended: ['Intended use', 'الاستخدام المقصود'],
  dimension: ['Dimension', 'البُعد'],
  category: ['Category', 'الفئة'],
  status: ['Governance', 'الحوكمة'],
  supports: ['Supports', 'يدعم'],
  conflicts: ['Conflicts', 'يعارض'],
  inconclusive: ['Inconclusive', 'غير حاسم'],
  accepted: ['Link accepted', 'قُبل الربط'],
  rejected: ['Link rejected', 'رُفض الربط'],
  pending: ['Review pending', 'المراجعة قيد الانتظار'],
  unavailableEvidence: ['Unavailable', 'غير متاح'],
  preliminary: ['Preliminary', 'أولي'],
  independent: ['Independent within limited scope', 'مستقل ضمن نطاق محدود'],
  integrated: ['Integrated for intended use', 'متكامل للاستخدام المقصود'],
  blocked: ['Blocked by safety or authorization', 'متوقف بسبب السلامة أو التصريح'],
  gaps: ['Evidence gaps remain', 'لا تزال هناك فجوات في الأدلة'],
  recorded: ['Governance and evidence recorded', 'سُجلت الحوكمة والأدلة'],
};

export function resolveReportRoute(path) {
  if (path === '/workspace/report-projects') return { kind: 'report-projects' };
  const match = path.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/reports$/);
  if (match) return { kind: 'reports', id: match[1] };
}

const reportPath = (lang, id) => `/workspace/projects/${id}/reports?lang=${lang}`;
const utc = (value) => new Date(value).toISOString();

export function buildReport(store, owner, project, lang, release, now = Date.now) {
  const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
  const tr = (pair) => pair[lang === 'ar' ? 1 : 0];
  const refs = store.references.list(owner, project.id).filter((ref) => ref.status === 'found' && ref.provider !== 'orcid');
  const claims = store.evidence.list(owner, project.id);
  const revisions = new Map();
  for (const revision of store.readiness.list(owner, project.id)) {
    if (!revisions.has(revision.id)) revisions.set(revision.id, revision);
  }
  const independent = new Map();
  for (const review of store.readiness.reviews(owner, project.id)) {
    if (!independent.has(review.revision)) independent.set(review.revision, []);
    independent.get(review.revision).push(review);
  }
  const reviewRows = [...revisions.values()].flatMap((revision) => (independent.get(revision.revision) ?? []).map((review) => [
    revision.intendedUse, String(revision.revision),
    `${review.decision === 'accepted' ? tr(['Accepted','مقبول']) : tr(['Changes requested','طُلبت تعديلات'])} · ${utc(review.recorded_at)}\n${review.note}`,
  ]));
  const table = (title, keys, rows) => rows.length
    ? { title: t(title), headers: keys.map(t), rows } : { title: t(title), text: [t('empty')] };
  const notice = (metadata) => {
    if (metadata.isRetracted === true) return t('flagged');
    const updates = [...(metadata.updatedBy ?? []), ...(metadata.updates ?? [])];
    return updates.length ? updates.map((update) => [update.type, update.doi, update.date].filter(Boolean).join(' · ')).join('\n') : t('unverified');
  };
  const sourceLine = (source) => `${resolverUrl(source.identifier)}\n${source.provider} · ${utc(source.retrievedAt)}\n${notice(source.metadata)}`;
  return {
    lang, title: project.title, subtitle: `NEXVARY NRI ${release} · ${t('version')} 1 · ${t('created')} ${utc(now())}`,
    sections: [
      table('references', ['name', 'authors', 'identifier', 'provider', 'retrieved', 'notices'], refs.map((ref) => [
        ref.metadata.title || ref.doi, ref.metadata.authors?.join(', ') || '',
        resolverUrl(ref.doi), ref.provider, utc(ref.checkedAt), notice(ref.metadata),
      ])),
      table('evidence', ['claim', 'identifier', 'study', 'limitations', 'review'], claims.flatMap((claim) =>
        claim.evidence.length ? claim.evidence.map((item) => [
          claim.statement, sourceLine(item.source), `${item.studyType} · ${t(item.relation)}`, item.limitations,
          item.review ? `${t(item.review.decision)} · ${utc(item.review.reviewedAt)}\n${item.review.note}` : t('pending'),
        ]) : [[claim.statement, '', '', '', t('pending')]])),
      table('readiness', ['intended', 'dimension', 'category', 'identifier', 'limitations', 'status'],
        [...revisions.values()].flatMap((revision) => revision.dimensions.map((row, index) => [
          revision.intendedUse, row.letter + ' · ' + tr(dimensions[index][3]),
          t(row.level === 'unavailable' ? 'unavailableEvidence' : row.level),
          row.evidence ? sourceLine(row.evidence.source) : '', row.limits,
          `${t(readinessState(revision))}\n${utc(revision.recordedAt)}`,
        ]))),
      ...(reviewRows.length ? [{
        title: tr(['Independent L-READY reviews', 'مراجعات L-READY المستقلة']),
        headers: [t('intended'), t('version'), t('review')], rows: reviewRows,
      }] : []),
      { title: t('limitations'), text: [t('scope'), ...(project.description ? [project.description] : [])] },
    ],
  };
}

export function createLocalReportRenderer(executable = process.env.NRI_REPORT_PYTHON) {
  if (!executable) return null;
  return (report, format) => new Promise((resolve, reject) => {
    const child = execFile(executable, [script, format], {
      encoding: 'buffer', timeout: 20_000, maxBuffer: 12 * 1024 * 1024, windowsHide: true,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(report));
  });
}

export function createReportHandler(store, release, renderReport) {
  let active = false;
  return async ({ request, reply, route, lang, account, form, stillSignedIn }) => {
    const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
    const { id } = route;
    const owner = account.id;
    const title = t('title');
    const panel = (path, html, status = 200) => reply(status, {
      title, path, html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>${html}</section>`,
    });
    if (!id) {
      panel('/workspace/report-projects', `<h2>${t('choose')}</h2><ul class="project-list">${store.listProjects(owner).map((project) =>
        `<li><a href="${reportPath(lang, project.id)}"><bdi>${escapeHtml(project.title)}</bdi></a></li>`).join('')}</ul>
        <a href="${workspacePath(lang)}">${t('back')}</a>`);
      return;
    }
    const project = store.getProject(owner, id);
    if (!project) {
      reply(404, workspacePage(lang, 'missing'));
      return;
    }
    const show = (status, key) => panel(`/workspace/projects/${id}/reports`, `
      <a href="${workspacePath(lang,id)}">${t('back')}</a><h2 dir="auto">${escapeHtml(project.title)}</h2>
      <p>${t('scope')}</p>
      ${key ? `<p class="form-error" role="alert">${t(key)}</p>` : ''}
      ${renderReport ? `<form class="project-tools" method="post" action="${reportPath(lang,id)}">
        <button class="action" name="format" value="pdf">${t('pdf')}</button>
        <button class="action" name="format" value="docx">${t('docx')}</button>
      </form>` : ''}`, status);
    if (request.method !== 'POST') {
      show(200, renderReport ? null : 'unavailable');
      return;
    }
    const format = form.get('format') ?? '';
    if (!Object.hasOwn(formats, format)) {
      reply(422);
      return;
    }
    if (!renderReport || active) {
      show(503, active ? 'busy' : 'unavailable');
      return;
    }
    active = true;
    let result;
    try {
      const report = buildReport(store, owner, project, lang, release);
      if (Buffer.byteLength(JSON.stringify(report)) > 512 * 1024) return reply(413);
      result = await renderLicensedReport(store.licensing,owner,() => renderReport(report,format),
        () => stillSignedIn() && Boolean(store.getProject(owner,id)));
    } catch {
      return show(503,'unavailable');
    } finally {
      active = false;
    }
    if (result.status === 429) return show(429,'quota');
    if (result.status !== 200) return result.status === 503 ? show(503,'unavailable') : reply(result.status);
    const { file } = result;
    reply(200, null, { 'Content-Type': formats[format], 'Content-Length': file.length,
      'Content-Disposition': `attachment; filename="nri-research-report.${format}"` }, file);
  };
}
