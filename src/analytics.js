import { readBoundedBody } from './request-body.js';
import { escapeHtml } from './workspace-view.js';

const csvLimit = 64 * 1024;
const rowLimit = 501;
const columnLimit = 12;

export function parseCsv(input) {
  const csv = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd();
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const endField = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  for (let i = 0; i <= csv.length; i++) {
    const char = csv[i] ?? '\n';
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
      continue;
    }
    if (char === ',' || char === '\n') {
      endField();
      if (row.length > columnLimit) return null;
      if (char === '\n') {
        rows.push(row);
        row = [];
        if (rows.length > rowLimit) return null;
      }
    } else if (char === '"' && !closed && field === '') {
      quoted = true;
    } else if (closed || char === '"') {
      return null;
    } else field += char;
  }
  if (quoted || rows.length < 2) return null;
  const header = rows.shift().map((value) => value.trim());
  if (header.some((value) => !value || value.length > 120) || new Set(header).size !== header.length
    || rows.some((value) => value.length !== header.length)) return null;
  return { header, rows };
}

export function summarizeCsv(input, column, unit) {
  const csv = parseCsv(input);
  if (!csv) return null;
  const selected = column || csv.header[0];
  const index = csv.header.indexOf(selected);
  if (index < 0) return null;
  const values = csv.rows.map((row) => row[index].trim());
  if (values.some((value) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e12)) return null;
  const numbers = values.map(Number);
  const sorted = [...numbers].sort((a, b) => a - b);
  const count = numbers.length;
  const quantile = (p) => {
    const position = (count - 1) * p;
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  const min = sorted[0];
  const max = sorted.at(-1);
  const mean = numbers.reduce((sum, value) => sum + value, 0) / count;
  const q1 = quantile(.25);
  const q3 = quantile(.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const binCount = max === min ? 1 : 8;
  const width = (max - min) / binCount;
  const histogram = Array.from({ length: binCount }, (_, i) => ({
    from: min + i * width, to: i === binCount - 1 ? max : min + (i + 1) * width, count: 0,
  }));
  for (const value of numbers) {
    const index = width ? Math.min(binCount - 1, Math.floor((value - min) / width)) : 0;
    histogram[index].count++;
  }
  return {
    formulaVersion: 1, column: selected, unit, values: numbers,
    stats: {
      count, min, max, mean, median: quantile(.5), q1, q3,
      sampleStdDev: count > 1 ? Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)) : null,
    },
    outliers: { lowerFence, upperFence, rows: numbers.flatMap((value, index) =>
      value < lowerFence || value > upperFence ? [{ row: index + 2, value }] : []) },
    histogram,
  };
}

const copy = {
  title: ['Scientific analytics', 'التحليلات العلمية'],
  guidance: ['Describe one numeric CSV column with up to 500 data rows. Use a header row and decimal points. Results are descriptive.', 'حلّل عمودًا رقميًا واحدًا في CSV بحد أقصى 500 سجل. استخدم صف عناوين ونقطة عشرية. النتائج وصفية.'],
  file: ['CSV file (up to 64 KiB)', 'ملف CSV بحد أقصى 64 كيلوبايت'],
  paste: ['Or paste CSV', 'أو ألصق CSV'],
  column: ['Column header (blank for first column)', 'اسم العمود، أو اتركه فارغًا للعمود الأول'],
  unit: ['Measurement unit', 'وحدة القياس'],
  analyze: ['Analyze column', 'حلّل العمود'],
  export: ['Export results (JSON)', 'صدّر النتائج بصيغة JSON'],
  invalid: ['Provide a valid UTF-8 CSV file or pasted CSV with a named numeric column and no missing values.', 'أدخل CSV بصيغة UTF-8 يحتوي على عمود رقمي مسمّى بلا قيم مفقودة.'],
  count: ['Count', 'العدد'],
  min: ['Minimum', 'الحد الأدنى'],
  max: ['Maximum', 'الحد الأقصى'],
  mean: ['Mean', 'المتوسط'],
  median: ['Median', 'الوسيط'],
  q1: ['First quartile', 'الربيع الأول'],
  q3: ['Third quartile', 'الربيع الثالث'],
  sampleStdDev: ['Sample standard deviation', 'الانحراف المعياري للعينة'],
  unavailable: ['Unavailable for one observation', 'غير متاح لمشاهدة واحدة'],
  histogram: ['Distribution', 'توزيع القيم'],
  outliers: ['Potential outliers (1.5 × IQR)', 'القيم المتطرفة المحتملة (1.5 × المدى الربيعي)'],
  noOutliers: ['No rows flagged by the IQR rule.', 'لم ترصد قاعدة المدى الربيعي قيَمًا متطرفة.'],
};

export async function handleAnalytics({ request, reply, lang, stillSignedIn }) {
  const t = (key) => copy[key][lang === 'ar' ? 1 : 0];
  let input = '';
  let column = '';
  let unit = '';
  let result;
  let status = 200;
  if (request.method === 'POST') {
    const type = request.headers['content-type'] ?? '';
    if (!/^multipart\/form-data\s*;/i.test(type)) {
      reply(415);
      return;
    }
    const body = await readBoundedBody(request, 2 * csvLimit);
    if (!body) {
      reply(413);
      return;
    }
    if (!stillSignedIn()) {
      reply(401);
      return;
    }
    try {
      const fields = await new Response(body, { headers: { 'Content-Type': type } }).formData();
      const pasted = fields.get('csv');
      const file = fields.get('file');
      const hasFile = file instanceof File && file.size > 0;
      column = typeof fields.get('column') === 'string' ? fields.get('column').trim().slice(0, 121) : '';
      unit = typeof fields.get('unit') === 'string' ? fields.get('unit').trim().slice(0, 61) : '';
      if (hasFile && file.size > csvLimit) {
        reply(413);
        return;
      }
      input = hasFile ? new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) : typeof pasted === 'string' ? pasted : '';
      if (!stillSignedIn()) return reply(403);
      if (Buffer.byteLength(input) > csvLimit) {
        reply(413);
        return;
      }
      if (column.length <= 120 && unit.length <= 60 && !(hasFile && pasted?.trim?.())) result = summarizeCsv(input, column, unit);
      if (result && fields.get('intent') === 'export') {
        reply(200, null, { 'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="nri-analytics.json"' }, JSON.stringify(result, null, 2));
        return;
      }
    } catch {
      status = 422;
    }
    if (!result) status = 422;
  }
  const format = new Intl.NumberFormat(lang, { maximumSignificantDigits: 8 });
  const formatNumber = (number) => format.format(number);
  const body = result ? `<article class="surface panel reference-record">
    <h2><bdi>${escapeHtml(result.column)}</bdi> <bdi>${escapeHtml(result.unit)}</bdi></h2>
    <dl class="reference-meta">${Object.entries(result.stats).map(([key, value]) =>
      `<div><dt>${t(key)}</dt><dd>${value === null ? t('unavailable') : formatNumber(value)}</dd></div>`).join('')}</dl>
    <h3>${t('histogram')}</h3><ul class="project-list">${result.histogram.map((bin) =>
      `<li><bdi>${formatNumber(bin.from)} – ${formatNumber(bin.to)}</bdi>
        <meter min="0" max="${result.stats.count}" value="${bin.count}" aria-label="${formatNumber(bin.from)} – ${formatNumber(bin.to)}"></meter>
        <bdi>${formatNumber(bin.count)}</bdi></li>`).join('')}</ul>
    <h3>${t('outliers')}</h3>
    ${result.outliers.rows.length ? `<ul>${result.outliers.rows.map(({ row, value }) =>
      `<li><bdi>#${row} · ${formatNumber(value)}</bdi></li>`).join('')}</ul>` : `<p>${t('noOutliers')}</p>`}
  </article>` : '';
  reply(status, { title: t('title'), path: '/workspace/analytics', html: `
    <section class="surface panel detail workspace-page"><h1>${t('title')}</h1><p>${t('guidance')}</p>
      ${status === 422 ? `<p class="form-error" role="alert">${t('invalid')}</p>` : ''}
      <form method="post" enctype="multipart/form-data" action="/workspace/analytics?lang=${lang}" class="workspace-form">
        <label>${t('file')}<input type="file" name="file" accept=".csv,text/csv"></label>
        <label>${t('paste')}<textarea name="csv" rows="5" dir="ltr" maxlength="${csvLimit}">${escapeHtml(input)}</textarea></label>
        <label>${t('column')}<input name="column" dir="auto" maxlength="120" value="${escapeHtml(column)}"></label>
        <label>${t('unit')}<input name="unit" dir="auto" maxlength="60" value="${escapeHtml(unit)}"></label>
        <div class="project-tools"><button class="action" name="intent" value="analyze">${t('analyze')}</button>
          <button class="action" name="intent" value="export">${t('export')}</button></div>
      </form>${body}</section>` });
}
