import { randomUUID } from 'node:crypto';
import { escapeHtml, workspacePage, workspacePath } from './workspace-view.js';

export const economicsSchema = `
  CREATE TABLE economic_scenarios (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assumptions TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX economic_project ON economic_scenarios(project_id, created_at DESC, id);
  PRAGMA user_version = 7;
`;

export function economicsStore(db, now) {
  const list = db.prepare(`
    SELECT s.id, s.assumptions, s.created_at FROM economic_scenarios s JOIN projects p ON p.id = s.project_id
    WHERE p.owner_id = ? AND p.id = ? ORDER BY s.created_at DESC, s.id
  `);
  const save = db.prepare(`INSERT INTO economic_scenarios
    SELECT ?, id, ?, ? FROM projects WHERE owner_id = ? AND id = ?`);
  const remove = db.prepare(`
    DELETE FROM economic_scenarios WHERE id = ? AND project_id IN (
      SELECT id FROM projects WHERE owner_id = ? AND id = ?
    )
  `);
  return {
    list: (owner, project) => list.all(owner, project).map((row) => ({
      id: row.id, assumptions: JSON.parse(row.assumptions), createdAt: row.created_at,
    })),
    save: (owner, project, assumptions) => save.run(randomUUID(), JSON.stringify(assumptions), now(), owner, project).changes === 1,
    remove: (owner, project, id) => remove.run(id, owner, project).changes === 1,
  };
}

const currencies = ['EGP', 'EUR', 'USD', 'GBP', 'SAR', 'AED'];

export function readScenario(form) {
  const read = (name) => (form.get(name) ?? '').trim();
  const integer = (name, minimum, maximum) => {
    const text = read(name);
    const value = Number(text);
    return /^\d{1,7}$/.test(text) && value >= minimum && value <= maximum ? value : null;
  };
  const cents = (name, maximum) => {
    const match = read(name).match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return value <= maximum ? value : null;
  };
  const scenario = {
    name: read('name'), unit: read('unit'), currency: read('currency'),
    capacity: integer('capacity', 1, 1_000_000), utilization: integer('utilization', 0, 100),
    fixedCost: cents('fixedCost', 500_000_000), variableCost: cents('variableCost', 10_000_000),
    unitPrice: cents('unitPrice', 10_000_000),
  };
  return scenario.name.length > 0 && scenario.name.length <= 120 && scenario.unit.length > 0 && scenario.unit.length <= 60
    && currencies.includes(scenario.currency) && Object.values(scenario).every((value) => value !== null)
    ? scenario : null;
}

export function evaluateScenario(input) {
  const { capacity, utilization, fixedCost, variableCost, unitPrice } = input;
  const output = (rate, price = unitPrice) => {
    const units = Math.floor(capacity * rate / 100);
    const revenue = units * price;
    const totalCost = fixedCost + units * variableCost;
    return { units, rate, price, revenue, totalCost, operatingResult: revenue - totalCost };
  };
  const contribution = unitPrice - variableCost;
  const breakEvenUnits = fixedCost === 0 && contribution >= 0 ? 0
    : contribution > 0 ? Math.ceil(fixedCost / contribution) : null;
  return {
    base: output(utilization), breakEvenUnits,
    withinCapacity: breakEvenUnits !== null && breakEvenUnits <= capacity,
    sensitivity: {
      utilizationLow: output(Math.max(0, utilization - 10)),
      utilizationHigh: output(Math.min(100, utilization + 10)),
      priceLow: output(utilization, Math.round(unitPrice * 90 / 100)),
      priceHigh: output(utilization, Math.round(unitPrice * 110 / 100)),
    },
  };
}

const copy = {
  title: ['Economic feasibility', 'الجدوى الاقتصادية'],
  choose: ['Choose a project', 'اختر مشروعًا'],
  back: ['Research workspace', 'مساحة الأبحاث'],
  note: ['Hypothetical one-year operating model. Estimates use entered assumptions and omit taxes, financing and capital investment.', 'نموذج تشغيلي افتراضي لسنة واحدة. تعتمد التقديرات على الافتراضات المدخلة وتستبعد الضرائب والتمويل والاستثمار الرأسمالي.'],
  method: ['Units sold are capacity × utilization rounded down. Revenue is units sold × price. Total cost is fixed cost plus units sold × variable cost.', 'الوحدات المباعة تساوي الطاقة مضروبة في الاستغلال مع التقريب للأسفل. الإيراد يساوي الوحدات المباعة مضروبة في السعر. التكلفة الإجمالية هي التكلفة الثابتة مضافًا إليها تكلفة الوحدات المتغيرة.'],
  name: ['Scenario name', 'اسم السيناريو'],
  unit: ['Output unit', 'وحدة الإنتاج'],
  currency: ['Currency', 'العملة'],
  capacity: ['Annual capacity (units)', 'الطاقة السنوية بالوحدات'],
  utilization: ['Capacity utilization (%)', 'استغلال الطاقة (%)'],
  fixedCost: ['Annual fixed cost', 'التكلفة الثابتة السنوية'],
  variableCost: ['Variable cost per unit', 'التكلفة المتغيرة للوحدة'],
  unitPrice: ['Sale price per unit', 'سعر بيع الوحدة'],
  units: ['Units sold', 'الوحدات المباعة'],
  revenue: ['Revenue', 'الإيراد'],
  totalCost: ['Total cost', 'التكلفة الإجمالية'],
  operatingResult: ['Operating result', 'النتيجة التشغيلية'],
  breakEven: ['Break-even units', 'وحدات نقطة التعادل'],
  unreachable: ['Unattainable at this contribution margin', 'غير ممكنة بهامش المساهمة الحالي'],
  overCapacity: ['Exceeds annual capacity', 'تتجاوز الطاقة السنوية'],
  sensitivity: ['One-variable sensitivity', 'تحليل حساسية لمتغير واحد'],
  utilizationLow: ['Utilization −10 percentage points', 'الاستغلال أقل بـ 10 نقاط مئوية'],
  utilizationHigh: ['Utilization +10 percentage points', 'الاستغلال أعلى بـ 10 نقاط مئوية'],
  priceLow: ['Unit price −10%', 'سعر الوحدة أقل بـ 10%'],
  priceHigh: ['Unit price +10%', 'سعر الوحدة أعلى بـ 10%'],
  save: ['Save scenario', 'احفظ السيناريو'],
  remove: ['Remove scenario', 'أزل السيناريو'],
  export: ['Export scenarios (JSON)', 'صدّر السيناريوهات بصيغة JSON'],
  invalid: ['Enter valid, non-negative assumptions within the form limits.', 'أدخل افتراضات صالحة غير سالبة ضمن حدود النموذج.'],
};

export function resolveEconomicsRoute(pathname) {
  if (pathname === '/workspace/economics-projects') return { kind: 'economics-projects' };
  const match = pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/economics(\/export)?$/);
  if (match) return { kind: match[2] ? 'economics-export' : 'economics', id: match[1] };
}

const fields = { name: 120, unit: 60, capacity: 1_000_000, utilization: 100, fixedCost: 5_000_000, variableCost: 100_000, unitPrice: 100_000 };
const path = (lang, id, suffix = '') => `/workspace/projects/${id}/economics${suffix}?lang=${lang}`;

export function createEconomicsHandler(store) {
  return ({ request, reply, redirect, route, lang, account, form }) => {
    const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
    const { kind, id } = route;
    const owner = account.id;
    const title = t('title');
    const panel = (path, html, status) => reply(status, {
      title, path, html: `<section class="surface panel detail workspace-page"><h1>${title}</h1>${html}</section>`,
    });
    if (kind === 'economics-projects') {
      panel('/workspace/economics-projects', `<h2>${t('choose')}</h2><ul class="project-list">${store.listProjects(owner).map((p) =>
        `<li><a href="${path(lang,p.id)}"><bdi>${escapeHtml(p.title)}</bdi></a></li>`).join('')}</ul><a href="${workspacePath(lang)}">${t('back')}</a>`, 200);
      return;
    }
    if (!store.getProject(owner, id)) {
      reply(404, workspacePage(lang, 'missing'));
      return;
    }
    const action = path(lang, id);
    let invalid = false;
    if (request.method === 'POST') {
      const assessment = readScenario(form);
      const saved = form.get('intent') === 'remove'
        ? store.economics.remove(owner, id, form.get('id') ?? '')
        : assessment && store.economics.save(owner, id, assessment);
      if (saved) {
        redirect(action);
        return;
      }
      invalid = true;
    }
    const scenarios = store.economics.list(owner, id).map((record) => ({
      ...record, results: evaluateScenario(record.assumptions),
    }));
    if (kind === 'economics-export') {
      reply(200, null, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="nri-economics.json"',
      }, JSON.stringify({ formulaVersion: 1, hypothetical: true, period: 'year', currencyScale: 100, scenarios }, null, 2));
      return;
    }
    const currency = (code) => new Intl.NumberFormat(lang, { style: 'currency', currency: code });
    const number = (value) => new Intl.NumberFormat(lang).format(value);
    const result = (amount, code) => currency(code).format(amount / 100);
    const cards = scenarios.map(({ id, assumptions, results }) => {
      const { base, sensitivity, breakEvenUnits, withinCapacity } = results;
      const { currency: code } = assumptions;
      const units = escapeHtml(assumptions.unit);
      const value = (key) => ['fixedCost', 'variableCost', 'unitPrice'].includes(key)
        ? result(assumptions[key], code) : number(assumptions[key]);
      return `<article class="surface panel reference-record"><h2 dir="auto">${escapeHtml(assumptions.name)}</h2>
        <dl class="reference-meta">${['capacity', 'utilization', 'fixedCost', 'variableCost', 'unitPrice'].map((key) =>
          `<div><dt>${t(key)}</dt><dd>${value(key)}</dd></div>`).join('')}
          <div><dt>${t('units')}</dt><dd>${number(base.units)} <bdi>${units}</bdi></dd></div>
          <div><dt>${t('revenue')}</dt><dd>${result(base.revenue,code)}</dd></div>
          <div><dt>${t('totalCost')}</dt><dd>${result(base.totalCost,code)}</dd></div>
          <div><dt>${t('operatingResult')}</dt><dd>${result(base.operatingResult,code)}</dd></div>
          <div><dt>${t('breakEven')}</dt><dd>${breakEvenUnits === null ? t('unreachable') :
            `${number(breakEvenUnits)} <bdi>${units}</bdi> ${withinCapacity ? '' : t('overCapacity')}`}</dd></div></dl>
        <h3>${t('sensitivity')}</h3><dl class="reference-meta">${Object.entries(sensitivity).map(([key, row]) =>
          `<div><dt>${t(key)}</dt><dd>${result(row.operatingResult,code)}</dd></div>`).join('')}</dl>
        <form method="post" action="${action}"><input type="hidden" name="id" value="${id}">
          <button class="action danger" name="intent" value="remove">${t('remove')}</button></form></article>`;
    }).join('');
    const editor = Object.entries(fields).map(([key, max]) => {
      const numeric = key !== 'name' && key !== 'unit';
      const numericAttrs = `type="number" min="${key === 'capacity' ? 1 : 0}" max="${max}" step="${['capacity','utilization'].includes(key) ? '1' : '0.01'}"`;
      return `<label>${t(key)}<input name="${key}" ${numeric ? numericAttrs : `maxlength="${max}"`} required></label>`;
    }).join('');
    panel(`/workspace/projects/${id}/economics`, `<a href="${workspacePath(lang,id)}">${t('back')}</a>
      <p>${t('note')}</p><p>${t('method')}</p>
      ${invalid ? `<p class="form-error" role="alert">${t('invalid')}</p>` : ''}
      <form method="post" action="${action}" class="workspace-form">
        <label>${t('currency')}<select name="currency">${currencies.map((code) => `<option>${code}</option>`).join('')}</select></label>
        ${editor}<button class="action">${t('save')}</button></form>
      ${cards ? `<p><a href="${path(lang,id,'/export')}">${t('export')}</a></p>
        <div class="provider-comparison">${cards}</div>` : ''}`, invalid ? 422 : 200);
  };
}
