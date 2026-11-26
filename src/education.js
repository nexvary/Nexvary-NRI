import { summarizeCsv } from './analytics.js';

export const educationSchema = `
  CREATE TABLE lesson_progress (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    lesson TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    passed_at INTEGER,
    PRIMARY KEY(account_id, lesson)
  ) STRICT;
  PRAGMA user_version = 12;
`;

export function educationStore(db, now) {
  const save = db.prepare(`
    INSERT INTO lesson_progress VALUES (?, ?, 1, ?)
    ON CONFLICT(account_id, lesson) DO UPDATE SET attempts=attempts+1,
      passed_at=COALESCE(lesson_progress.passed_at, excluded.passed_at)
  `);
  const list = db.prepare('SELECT lesson, attempts, passed_at AS passedAt FROM lesson_progress WHERE account_id=?');
  return {
    record: (owner, id, passed) => save.run(owner, id, passed ? now() : null),
    list: (owner) => list.all(owner),
  };
}

const lessons = {
  provenance: {
    title: ['Trace a research source', 'تتبّع مصدرًا بحثيًا'],
    objective: ['A DOI identifies a registered record. Preserve who supplied the metadata and when you retrieved it. If a provider has no result, the work’s status remains uncertain.',
      'يحدّد معرّف DOI سجلًا مسجلًا. احتفظ بهوية مزوّد البيانات ووقت جلبها. إذا لم يُرجع المزوّد نتيجة، تظل حالة العمل غير مؤكدة.'],
    question: ['What should you use to reproduce a reference check?', 'ما الذي تستخدمه لإعادة إجراء تحقق مرجعي؟'],
    options: [
      ['Only the article title', 'عنوان المقال فقط'],
      ['The identifier, provider, and retrieval timestamp', 'المعرّف والمزوّد ووقت الجلب'],
      ['A count of search results', 'عدد نتائج البحث'],
    ],
    answer: 1,
  },
  variability: {
    title: ['Compare the mean and median', 'قارن المتوسط والوسيط'],
    objective: ['The mean uses every value. The median is the middle ordered value, or the mean of the two middle values for an even count. A large observation can move the mean more than the median.',
      'يستخدم المتوسط جميع القيم. الوسيط هو القيمة الوسطى بعد ترتيب القيم، أو متوسط القيمتين الوسطيتين إذا كان العدد زوجيًا. يمكن لمشاهدة كبيرة أن تؤثر في المتوسط أكثر من الوسيط.'],
    question: ['For the illustrative sequence 1, 2, 2, 3, 100, which value is the median?', 'ما وسيط السلسلة التوضيحية 1، 2، 2، 3، 100؟'],
    options: [['2', '2'], ['3', '3'], ['21.6', '21.6']],
    answer: 0,
  },
};

const copy = {
  title: ['Research learning library', 'مكتبة تعلّم البحث'],
  submit: ['Check answer', 'تحقّق من الإجابة'],
  correct: ['Correct', 'صحيح'],
  retry: ['Review the explanation and try again.', 'راجع الشرح وحاول مجددًا.'],
  complete: ['Completed', 'مكتمل'],
  attempts: ['Attempts', 'المحاولات'],
  scenario: ['Illustrative calculation', 'حساب توضيحي'],
  choose: ['Fifth value in 1, 2, 2, 3, …', 'القيمة الخامسة في 1، 2، 2، 3، …'],
  simulate: ['Recalculate', 'أعد الحساب'],
  mean: ['Mean', 'المتوسط'],
  median: ['Median', 'الوسيط'],
  invalid: ['Select one of the available options.', 'اختر أحد الخيارات المتاحة.'],
};

export function createEducationHandler(store) {
  return ({ request, reply, lang, account, form }) => {
    const tr = (pair) => pair[lang === 'ar' ? 1 : 0];
    const t = (key) => tr(copy[key]);
    const owner = account.id;
    const action = '/workspace/education?lang=' + lang;
    const scenarios = ['4', '10', '100'];
    const query = new URL('http://localhost' + request.url).searchParams.get('last');
    const last = scenarios.includes(query) ? query : '4';
    const model = summarizeCsv('value\n1\n2\n2\n3\n' + last, 'value', '');
    let feedback;
    let status = 200;
    if (request.method === 'POST') {
      const id = form.get('lesson');
      const answer = form.get('answer');
      if (!Object.hasOwn(lessons, id) || !['0','1','2'].includes(answer)) {
        status = 422;
        feedback = t('invalid');
      } else {
        const correct = lessons[id].answer === Number(answer);
        store.education.record(owner, id, correct);
        feedback = t(correct ? 'correct' : 'retry');
      }
    }
    const progress = new Map(store.education.list(owner).map((row) => [row.lesson, row]));
    const number = (value) => new Intl.NumberFormat(lang).format(value);
    reply(status, {
      title: t('title'), path: '/workspace/education',
      html: `<section class="surface panel detail workspace-page"><h1>${t('title')}</h1>
        ${feedback ? `<p role="status">${feedback}</p>` : ''}
        ${Object.entries(lessons).map(([id, lesson]) => {
          const stats = progress.get(id);
          return `<article class="surface panel reference-record">
            <h2>${tr(lesson.title)}</h2><p>${tr(lesson.objective)}</p>
            <p>${t('attempts')} · ${number(stats?.attempts ?? 0)}${stats?.passedAt ? ` · ${t('complete')}` : ''}</p>
            <form class="workspace-form" method="post" action="${action}">
              <input type="hidden" name="lesson" value="${id}">
              <fieldset class="provider-block"><legend>${tr(lesson.question)}</legend>
                ${lesson.options.map((option, index) => `<label><input type="radio" name="answer" value="${index}" required> ${tr(option)}</label>`).join('')}
              </fieldset><button class="action">${t('submit')}</button>
            </form></article>`;
        }).join('')}
        <section class="surface panel"><h2>${t('scenario')}</h2>
          <form class="workspace-form" method="get" action="/workspace/education">
            <input type="hidden" name="lang" value="${lang}">
            <label>${t('choose')}<select name="last">${scenarios.map((option) =>
              `<option value="${option}"${option === last ? ' selected' : ''}>${number(Number(option))}</option>`).join('')}</select></label>
            <button class="action">${t('simulate')}</button></form>
          <dl class="reference-meta"><div><dt>${t('mean')}</dt><dd>${number(model.stats.mean)}</dd></div>
            <div><dt>${t('median')}</dt><dd>${number(model.stats.median)}</dd></div></dl>
        </section></section>`,
    });
  };
}
