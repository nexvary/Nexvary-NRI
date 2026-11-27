import { documentFormat, documentHeaders } from './documents.js';
import { renderLicensedReport } from './licensing-store.js';
import { buildReport } from './reports.js';
import { escapeHtml } from './workspace-view.js';

const kinds = {
  document: ['Document version', 'إصدار المستند'],
  reference: ['Reference snapshot', 'لقطة مرجع'],
  readiness: ['Readiness revision', 'مراجعة الجاهزية'],
  report: ['Report snapshot', 'لقطة تقرير'],
};
const formats = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function resolveResourceRoute(path) {
  const match = path.match(/^\/workspace\/projects\/([a-f0-9-]{36})\/shared-resources(?:\/([a-f0-9-]{36}))?$/);
  if (match) return { kind: 'shared-resources', id: match[1], grant: match[2] };
}

function choices(store, owner, project, kind) {
  switch (kind) {
    case 'document':
      return store.documents.list(owner,project).flatMap((doc) => store.documents.versions(owner,project,doc.id).
        map((version) => ({ kind,key:doc.id + ':' + version.number,title:version.filename + ' · v' + version.number,
          data:{document:doc.id,version:version.number} })));
    case 'reference':
      return store.references.list(owner,project).filter((item) => item.status === 'found' && item.provider !== 'orcid')
        .map((item) => ({ kind,key:JSON.stringify([item.provider,item.doi,item.checkedAt]),title:item.metadata.title ?? item.doi,data:item }));
    case 'readiness':
      return store.readiness.list(owner,project).map((item) => ({ kind,key:item.id + ':' + item.revision,
        title:item.intendedUse + ' · v' + item.revision,data:item }));
    case 'report':
      return [{ kind,key:'report',title:store.getProject(owner,project).title }];
  }
  return [];
}

export function createResourceHandler(store,release,renderReport) {
  let active = false;
  return async function handle({ request,reply,redirect,route,lang,account,form,stillSignedIn }) {
    const t = (en, ar) => lang === 'ar' ? ar : en;
    const actor = account.id;
    const { id, grant } = route;
    const path = '/workspace/projects/' + id + '/shared-resources';
    const link = (item) => path + (item ? '/' + item : '') + '?lang=' + lang;
    const params = new URL(request.url,'http://localhost').searchParams;
    const section = t('Shared research resources','الموارد البحثية المشتركة');
    const when = new Intl.DateTimeFormat(lang,{ dateStyle:'medium',timeStyle:'short',timeZone:'UTC' });
    const page = (body, status = 200) => reply(status,{
      title:section,path:grant ? path + '/' + grant : path,
      html:`<section class="surface panel detail workspace-page"><h1>${section}</h1>${body}</section>`,
    });
    if (grant) {
      const row = store.resources.get(actor,id,grant);
      if (!row) return reply(404);
      const { data } = row;
      if (row.kind === 'document' && ['pdf', 'document'].includes(params.get('download'))) {
        const file = store.documents.download(row.owner,id,data.document,data.version);
        if (!file) return reply(404);
        const headers = documentHeaders(file, data.version);
        if (documentFormat(file.name) === 'pdf') headers['Content-Disposition'] = 'attachment; filename="shared-document.pdf"';
        return reply(200,null,headers,file.bytes);
      }
      if (form) {
        const format = form.get('format');
        if (row.kind !== 'report' || !Object.hasOwn(formats,format)) return reply(422);
        if (!renderReport || active) return reply(503);
        active = true;
        let result;
        try {
          result = await renderLicensedReport(store.licensing,actor,() => renderReport(data[lang],format),
            () => stillSignedIn() && Boolean(store.resources.get(actor,id,grant)));
        } finally { active = false; }
        if (result.status === 429) return page(`<p role="alert">${t('The daily report export limit has been reached.','بلغت الحد اليومي لتصدير التقارير.')}</p><a href="${link(grant)}">${t('Return to the report','العودة إلى التقرير')}</a>`,429);
        if (result.status !== 200) return reply(result.status);
        const { file } = result;
        return reply(200,null,{ 'Content-Type':formats[format], 'Content-Length':file.length,
          'Content-Disposition':`attachment; filename="shared-report.${format}"` },file);
      }
      let detail;
      if (row.kind === 'document') {
        if (!store.documents.get(row.owner,id,data.document)) return reply(404);
        detail = `<a class="action" href="${link(grant)}&amp;download=document">${t('Download shared document version','نزّل إصدار المستند المشترك')}</a>`;
      } else if (row.kind === 'reference') {
        detail = `<p><bdi>${escapeHtml(data.provider)} · ${escapeHtml(data.doi)}</bdi> · ${when.format(data.checkedAt)} UTC</p>
          <p dir="auto">${escapeHtml((data.metadata.authors ?? []).join(' · '))}</p>
          <p dir="auto">${escapeHtml(data.metadata.venue ?? '')}</p>
          <details><summary>${t('Source metadata','بيانات المصدر')}</summary><p dir="auto">${escapeHtml(JSON.stringify(data.metadata))}</p></details>`;
      } else if (row.kind === 'readiness') {
        const terms = {
          unresolved:t('Unresolved','غير محسومة'), unsafe:t('Unsafe','غير آمنة'), documented:t('Documented','موثقة'),
          unknown:t('Unknown','غير معروفة'), missing:t('Missing','مفقودة'),
          unavailable:t('Unavailable','غير متاحة'), preliminary:t('Preliminary','أولية'),
          limited:t('Limited','محدودة'), integrated:t('Integrated','متكاملة'),
        };
        detail = `<dl class="reference-meta"><div><dt>${t('Safety','السلامة')}</dt><dd>${terms[data.safety]}</dd></div>
          <div><dt>${t('Authorization','التصريح')}</dt><dd>${terms[data.authorization]}</dd></div></dl>
          <ul class="project-list">${data.dimensions.map((dimension) => `<li><bdi>${escapeHtml(dimension.letter)}</bdi>
            · ${escapeHtml(terms[dimension.level] ?? dimension.level)}<p dir="auto">${escapeHtml(dimension.limits)}</p>
            ${dimension.evidence?.source ? `<small><bdi>${escapeHtml(dimension.evidence.source.identifier)} · ${escapeHtml(dimension.evidence.source.provider)}</bdi></small>` : ''}</li>`).join('')}</ul>`;
      } else {
        const report = data[lang];
        detail = `<p dir="auto">${escapeHtml(report.subtitle)}</p>
          ${renderReport ? `<form class="project-tools" method="post" action="${link(grant)}">
            <button class="action" name="format" value="pdf">PDF</button>
            <button class="action" name="format" value="docx">DOCX</button></form>` : ''}
          ${report.sections.map((item) => `<section class="provider-block"><h3>${escapeHtml(item.title)}</h3>
            ${item.text?.map((item) => `<p dir="auto">${escapeHtml(item)}</p>`).join('') ?? ''}
            ${item.rows ? `<ul class="project-list">${item.rows.map((row) => `<li><dl>${row.map((value,i) =>
              `<div><dt>${escapeHtml(item.headers[i])}</dt><dd dir="auto">${escapeHtml(value)}</dd></div>`).join('')}</dl></li>`).join('')}</ul>` : ''}
          </section>`).join('')}`;
      }
      return page(`<a href="${link()}">${section}</a><h2 dir="auto">${escapeHtml(row.title)}</h2>${detail}`);
    }
    const offsetField = params.get('offset') ?? '';
    const offset = /^\d{1,8}$/.test(offsetField) ? Number(offsetField) : 0;
    const current = store.resources.list(actor,id,offset);
    if (!current) return reply(404);
    const owner = current.role === 'owner';
    if (form) {
      if (!owner) return reply(403);
      if (form.get('intent') === 'revoke') return store.resources.revoke(actor,id,form.get('grant')) ? redirect(link()) : reply(404);
      if (form.get('intent') !== 'share') return reply(422);
      const kind = form.get('kind');
      const key = form.get('resource');
      const selected = Object.hasOwn(kinds,kind) ? choices(store,actor,id,kind).find((item) => item.key === key) : undefined;
      if (!selected) return reply(422);
      if (kind === 'report') {
        const project = store.getProject(actor,id);
        const stamp = Date.now();
        selected.data = Object.fromEntries(['ar','en'].map((language) => [language,buildReport(store,actor,project,language,release,() => stamp)]));
        selected.key += ':' + stamp;
      }
      return store.resources.grant(actor,id,form.get('recipient'),selected) ? redirect(link()) : reply(422);
    }
    const kind = Object.hasOwn(kinds,params.get('kind')) ? params.get('kind') : 'document';
    const search = (params.get('q') ?? '').trim().slice(0,150);
    const options = owner ? choices(store,actor,id,kind).filter((item) => !search || item.title.toLowerCase().includes(search.toLowerCase())).slice(0,100) : [];
    const members = owner ? store.teams.activeMembers(actor,id) : [];
    return page(`<a href="/workspace/projects/${id}/team?lang=${lang}">${t('Project team','فريق المشروع')}</a>
      <h2 dir="auto">${escapeHtml(current.title)}</h2>
      ${owner ? `<form class="workspace-form" method="get" action="${path}">
        <input type="hidden" name="lang" value="${lang}">
        <label>${t('Resource type','نوع المورد')}<select name="kind">${Object.entries(kinds).map(([key,label]) =>
          `<option value="${key}"${key === kind ? ' selected' : ''}>${t(...label)}</option>`).join('')}</select></label>
        <label>${t('Find a resource','ابحث عن مورد')}<input name="q" maxlength="150" dir="auto" value="${escapeHtml(search)}"></label>
        <button class="action">${t('Show resources','اعرض الموارد')}</button></form>
        <p>${t('Sharing a report captures current references, evidence, readiness and the project description. PDF sharing grants one version.','تلتقط مشاركة التقرير المراجع والأدلة والجاهزية ووصف المشروع الحالية. تتيح مشاركة PDF إصدارًا واحدًا.')}</p>
        ${members.length && options.length ? `<form class="workspace-form" method="post" action="${link()}">
          <input type="hidden" name="kind" value="${kind}">
          <label>${t('Recipient','المستلم')}<select name="recipient">${members.map((member) => `<option value="${member.account_id}">${escapeHtml(member.name ?? member.account_id)}</option>`).join('')}</select></label>
          <label>${t('Resource','المورد')}<select name="resource">${options.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.title)}</option>`).join('')}</select></label>
          <button class="action" name="intent" value="share">${t('Grant read access','امنح صلاحية القراءة')}</button></form>` :
          `<p>${t('No matching resources or accepted recipients.','لا توجد موارد مطابقة أو مستلمون مقبولون.')}</p>`}` : ''}
      ${current.grants.length ? `<ul class="project-list">${current.grants.slice(0,50).map((entry) =>
        `<li class="provider-block"><p>${t(...kinds[entry.kind])} · <bdi>${escapeHtml(entry.title)}</bdi></p>
          <small>${when.format(entry.granted_at)} UTC</small>
          ${owner ? `<small><bdi>${escapeHtml(entry.granted_by ?? '')} → ${escapeHtml(entry.recipient)}</bdi>
            · ${entry.effective ? t('Active','نشطة') : t('Inactive','غير نشطة')}
            ${entry.revoked_at ? `· ${t('Revoked','أُلغيت')} ${when.format(entry.revoked_at)} UTC · <bdi>${escapeHtml(entry.revoked_by ?? '')}</bdi>` : ''}</small>` : ''}
          ${!owner || !entry.revoked_at ? `<a href="${link(entry.id)}">${t('Open resource','افتح المورد')}</a>` : ''}
          ${owner && !entry.revoked_at ? `<form method="post" action="${link()}">
            <input type="hidden" name="grant" value="${entry.id}"><button class="action" name="intent" value="revoke">${t('Revoke access','ألغِ الوصول')}</button></form>` : ''}
        </li>`).join('')}</ul>` : `<p>${t('No shared resources on this page.','لا توجد موارد مشتركة في هذه الصفحة.')}</p>`}
      ${offset || current.grants.length > 50 ? `<nav class="project-tools">
        ${offset ? `<a href="${link()}&amp;offset=${Math.max(0,offset-50)}">${t('Previous','السابق')}</a>` : ''}
        ${current.grants.length > 50 ? `<a href="${link()}&amp;offset=${offset+50}">${t('Next','التالي')}</a>` : ''}</nav>` : ''}`);
  };
}
