import { developerInformation, systemInformation } from './about.js';
import { copy, modules, dimensions, metrics, providers } from './content.js';

import { icon } from './icons.js';
import { libraryEntryPath } from './library.js';
import { escapeHtml, loginPath, workspacePath } from './workspace-view.js';

const primary = ['dashboard', 'research', 'library', 'evidence', 'l-ready', 'economics', 'assistant', 'network', 'collaboration', 'reports', 'settings', 'about'];
const shortcuts = ['research', 'evidence', 'l-ready', 'economics', 'assistant', 'network'];
const additional = ['references', 'messages', 'observatory', 'analytics', 'education'];
const repo = 'https://github.com/nexvary/Nexvary-NRI';

export function render({ lang, view, version, page, workspace, unread = 0, invitations = 0 }) {
  const formatCost = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
  const tr = (pair) => pair[lang === 'ar' ? 1 : 0];
  const t = (key) => tr(copy[key]);
  const href = (target, language = lang) => `/?lang=${language}&amp;view=${target}`;
  const label = (id) => tr(modules[id][2]);
  const dashboardLink = view === 'dashboard' ? ' data-dashboard-nav' : '';
  const link = (id) => `<a href="${href(id)}"${dashboardLink}${view === id ? ' aria-current="page"' : ''}>${icon(modules[id][0])}<span>${label(id)}</span></a>`;
  const tile = (id) => {
    const [glyph, color, name, description] = modules[id];
    return `<a class="tile surface ${color}" href="${href(id)}"${dashboardLink}>${icon(glyph)}<strong>${tr(name)}</strong><small>${tr(description)}</small></a>`;
  };
  const dimensionList = `<ul class="dimensions">${dimensions.map(([letter, glyph, color, name]) =>
    `<li class="${color}">${icon(glyph)}<bdi>${letter}</bdi><small>${tr(name)}</small></li>`).join('')}</ul>`;
  const isModule = Object.hasOwn(modules, view);
  const title = page?.title ?? (isModule ? label(view) : t(view === 'developer' ? 'aboutDeveloper' : 'unknown'));
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const dashboard = () => `
    <p id="dashboard-navigation-status" role="status" aria-live="polite" hidden>${t('dashboardLoading')}</p>
    <section class="hero surface" aria-labelledby="hero-title">
      <div class="hero-copy">
        <h1 id="hero-title" class="wordmark"><bdi>NEXVARY <em>NRI</em></bdi></h1>
        <p class="hero-name">${t('product')}</p>
        <p>${t('motto')}</p>
      </div>
      <div class="hero-links">${['references', 'evidence', 'analytics', 'observatory'].map(link).join('')}</div>
    </section>
    <div class="dashboard-grid">
      <div class="workspace">
        <nav class="shortcuts" aria-label="${t('navigation')}">${shortcuts.map(tile).join('')}</nav>
        <div class="workspace-panels">
          <section class="surface panel">
            <h2>${icon('🗂️')}${t('latest')}</h2>
            ${workspace?.projects.length ? `<ul class="records">${workspace.projects.map((project) =>
              `<li>${icon('📄')}<span><a href="${workspacePath(lang, project.id)}"><bdi>${escapeHtml(project.title)}</bdi></a>
              <time dir="ltr">${new Date(project.updatedAt).toISOString().slice(0, 10)}</time></span></li>`).join('')}</ul>`
              : workspace ? `<p>${t('noResearch')}</p>` : `<a class="action" href="${loginPath(lang)}">${t('signIn')}</a>`}
          </section>
          <section class="surface panel">
            <h2>${icon('🧪')}${t('quick')}</h2>
            ${dimensionList}
            <a class="action" href="${href('l-ready')}">${label('l-ready')} <span aria-hidden="true">↗</span></a>
          </section>
        </div>
        <div class="discovery">${['network', 'library', 'education'].map(tile).join('')}</div>
        <section class="surface panel providers">
          <h2>${icon('🔗')}${t('sources')}</h2>
          <ul>${Object.entries(providers).map(([name, url]) => `<li><a href="${url}" lang="en" dir="ltr">${name}</a></li>`).join('')}</ul>
        </section>
      </div>
      <aside class="dashboard-aside">
        <section class="surface panel">
          <h2>${icon('📊')}${t('statistics')}</h2>
          ${workspace ? `<dl class="metrics">${metrics.map(([glyph, key, name]) =>
            `<div>${icon(glyph)}<dt>${tr(name)}</dt><dd>${new Intl.NumberFormat(lang).format(workspace.metrics[key])}</dd></div>`).join('')}</dl>` : ''}
          ${workspace ? `<dl class="metrics">
            <div>${icon('🧾')}<dt>${tr(['Estimated API usage today (UTC)', 'تكلفة الاستخدام التقديرية اليوم (UTC)'])}</dt>
              <dd><bdi>${formatCost.format(workspace.usage.observedCost / 1_000_000)}</bdi></dd></div>
            <div>${icon('📊')}<dt>${tr(['Provider-reported tokens', 'الرموز التي أبلغ عنها المزوّد'])}</dt>
              <dd>${new Intl.NumberFormat(lang).format(workspace.usage.observedTokens)}</dd></div>
          </dl>` : `<dl class="metrics"><div>${icon('🧾')}<dt>${t('api')}</dt><dd class="inactive">${t('inactive')}</dd></div></dl>`}
          ${workspace?.orcid ? `<p><a href="https://orcid.org/${escapeHtml(workspace.orcid)}"><bdi>ORCID ${escapeHtml(workspace.orcid)}</bdi></a>
            · ${tr(['Self-reported', 'أضافه صاحب الحساب'])}</p>` : ''}
        </section>
        ${workspace ? `<section class="surface panel">
          <h2>${icon('🕒')}${t('activity')}</h2>
          ${workspace.activity.length ? `<ul class="activity">${workspace.activity.map((item) =>
            `<li>${icon(item.kind !== 'source' ? '📄' : '🔗')}<a href="${libraryEntryPath(lang, item)}"><bdi>${escapeHtml(item.title)}</bdi></a></li>`).join('')}</ul>`
            : `<p>${t('noActivity')}</p>`}
        </section>` : ''}
        <section class="surface panel summary"><h2>${t('aboutSystem')}</h2><p>${t('motto')}</p><a href="${href('about')}">${label('about')}</a></section>
      </aside>
    </div>`;
  const about = () => `
    <section class="surface panel detail">
      <nav class="tabs" aria-label="${label('about')}">
        <a href="${href('about')}"${view === 'about' ? ' aria-current="page"' : ''}>${t('aboutSystem')}</a>
        <a href="${href('developer')}"${view === 'developer' ? ' aria-current="page"' : ''}>${t('aboutDeveloper')}</a>
      </nav>
      <h1>${t(view === 'about' ? 'aboutSystem' : 'aboutDeveloper')}</h1>
      ${view === 'about'
        ? `<p>${t('version')} <bdi>${version}</bdi> · ${t('build')}</p>${systemInformation(tr)}`
        : developerInformation(tr)}
    </section>`;
  const detail = () => `
    <section class="surface panel detail">
      <h1>${icon(modules[view][0])}${title}</h1>
      ${modules[view][3] ? `<p>${tr(modules[view][3])}</p>` : ''}
      ${view === 'l-ready' ? `<p>${t('framework')}</p>${dimensionList}` : ''}
      <p class="tag">${t('planned')}</p>
      <p>${t('unavailable')}</p>
      ${view === 'research' || view === 'library' ? `<p>${t('empty')}</p>` : ''}
      <a class="action" href="${href('dashboard')}">${t('home')}</a>
    </section>`;
  const content = page?.html ?? (view === 'dashboard' ? dashboard()
    : view === 'about' || view === 'developer' ? about()
      : isModule ? detail()
        : `<section class="surface panel detail"><h1>${title}</h1><a class="action" href="${href('dashboard')}">${t('home')}</a></section>`);
  const otherLanguage = lang === 'ar' ? 'en' : 'ar';
  const validView = isModule || view === 'developer' ? view : 'dashboard';
  const languageLink = page ? `${page.path}?lang=${otherLanguage}` : href(validView, otherLanguage);
  if (page?.controlCenter) return `<!doctype html>
<html lang="${lang}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | NRI CONTROL CENTER</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">${t('skip')}</a>
  <header class="topbar">
    <strong lang="en" dir="ltr">NRI CONTROL CENTER — NEXVARY INC.</strong>
    <nav class="language" aria-label="${t('language')}">
      <a href="${languageLink}" hreflang="${otherLanguage}" lang="${otherLanguage}" dir="auto">${icon('🌐')}${otherLanguage === 'ar' ? 'العربية' : 'English'}</a>
    </nav>
  </header>
  <main id="main" class="control-center" tabindex="-1">
    <nav class="project-tools" aria-label="${tr(['Control Center', 'مركز التحكم'])}">
      ${page.billingOnly ? '' : `<a href="#overview">${tr(['Dashboard', 'لوحة التحكم'])}</a>
      <a href="#plans">${tr(['Subscription plans', 'خطط الاشتراك'])}</a>`}
      <a href="/workspace/settings?lang=${lang}">${tr(['Researcher settings', 'إعدادات الباحث'])}</a>
    </nav>
    ${content}
  </main>
</body>
</html>`;
  return `<!doctype html>
<html lang="${lang}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${title} | NEXVARY NRI</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">${t('skip')}</a>
  <header class="topbar">
    <a class="wordmark" href="${href('dashboard')}" lang="en" dir="ltr">NEXVARY <em>NRI</em><span>Research Intelligence</span></a>
    <nav class="language" aria-label="${t('language')}">
      ${invitations ? `<a href="/workspace/team-invitations?lang=${lang}">${icon('🤝')}${tr(['Team invitations', 'دعوات الفريق'])} · ${new Intl.NumberFormat(lang).format(invitations)}</a>` : ''}
      ${unread ? `<a href="${href('messages')}">${icon('💬')}${tr(['Unread messages', 'الرسائل غير المقروءة'])} · ${new Intl.NumberFormat(lang).format(unread)}</a>` : ''}
      <a href="${languageLink}" hreflang="${otherLanguage}" lang="${otherLanguage}" dir="auto">${icon('🌐')}${otherLanguage === 'ar' ? 'العربية' : 'English'}</a>
    </nav>
  </header>
  <div class="layout">
    <aside class="surface sidebar" dir="${direction}">
      <nav aria-label="${t('navigation')}">
        <ul>${primary.map((id) => `<li>${link(id)}</li>`).join('')}</ul>
      </nav>
      <div class="version surface"><bdi>NEXVARY NRI</bdi><bdi>v${version}</bdi></div>
    </aside>
    <main id="main" tabindex="-1" dir="${direction}">${content}</main>
  </div>
  <footer class="surface footer"><nav aria-label="${t('docs')}">
    <ul>${additional.map((id) => `<li>${link(id)}</li>`).join('')}<li><a href="${repo}/blob/main/docs/PROJECT.md">${icon('📘')}${t('docs')}</a></li></ul>
  </nav></footer>
  ${view === 'dashboard' && !page ? '<script src="/dashboard-navigation.js" defer></script>' : ''}
</body>
</html>`;
}
