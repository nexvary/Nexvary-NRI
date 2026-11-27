const repository = 'https://github.com/nexvary/Nexvary-NRI';
const website = 'https://nexvary.com';

export function systemInformation(tr) {
  const policies = [
    [
      ['Licensing', 'الترخيص'],
      ['The application source has no published license grant. PDF.js and the report renderer dependencies have their own licenses. The owner must approve the distribution terms before release.',
        'لا يوجد ترخيص منشور يمنح حقوق استخدام الشيفرة المصدرية للتطبيق. تخضع مكتبة PDF.js واعتماديات توليد التقارير لتراخيصها الخاصة. يجب أن يعتمد المالك شروط التوزيع قبل الإصدار.'],
    ],
    [
      ['Privacy policy draft', 'مسودة سياسة الخصوصية'],
      ['NRI stores account and research records, private messages, usage counters and security events in the workspace. Document bytes, message bodies and provider credentials are encrypted at rest. External AI use requires consent for the question and selected source metadata. Account export and deletion are available in Settings. Operators must publish their backup retention period and data request procedure.',
        'تخزّن المنصة بيانات الحساب والبحث والرسائل الخاصة وعدّادات الاستخدام وأحداث الأمان في مساحة العمل. تُشفّر ملفات المستندات ونصوص الرسائل وبيانات اعتماد المزوّد عند التخزين. يتطلب استخدام الذكاء الاصطناعي الخارجي موافقة على إرسال السؤال وبيانات المصادر المحددة. يمكن تصدير الحساب وحذفه من الإعدادات. على المشغّل نشر مدة الاحتفاظ بالنسخ الاحتياطية وإجراءات طلبات البيانات.'],
    ],
    [
      ['Terms of use draft', 'مسودة شروط الاستخدام'],
      ['Users should upload and share only material they are authorized to use, respect recipients’ privacy, and verify evidence before relying on an assessment. The owner must approve the final terms, permitted use and governing law before public release.',
        'على المستخدمين رفع ومشاركة المواد التي يملكون إذنًا باستخدامها، واحترام خصوصية المستلمين والتحقق من الأدلة قبل الاعتماد على أي تقييم. يجب أن يعتمد المالك الشروط النهائية والاستخدام المسموح والقانون الحاكم قبل الإطلاق العام.'],
    ],
  ];
  return `
    <p>${tr(['NRI organizes research projects, literature and evidence in a bilingual workspace. Researchers can track sources, review the evidence behind claims and produce versioned reports.',
      'تنظّم منصة NRI المشاريع البحثية والمراجع والأدلة في مساحة عمل ثنائية اللغة. تتيح للباحثين تتبّع المصادر ومراجعة أدلة الادعاءات وإعداد تقارير محفوظة بإصداراتها.'])}</p>
    <h2>${tr(['Scientific methodology and limitations', 'المنهجية العلمية وحدودها'])}</h2>
    <p>${tr(['L-READY reviews scientific evidence, independent verification, economics, availability, safety and governance, and societal value against an intended use. Reviewers record evidence gaps and safety or authorization blockers. The framework is proposed, has no aggregate score and confers no certification.',
      'يراجع إطار L-READY الأدلة العلمية والتحقق المستقل والجدوى الاقتصادية والإتاحة والسلامة والحوكمة والقيمة المجتمعية وفق الاستخدام المقصود. يوثّق المراجعون فجوات الأدلة وموانع السلامة أو الترخيص. الإطار مقترح ولا يعطي درجة إجمالية أو شهادة اعتماد.'])}</p>
    <h2>${tr(['Release and support', 'الإصدار والدعم'])}</h2>
    <ul class="about-links">
      <li><a href="${repository}/commits/feature/nri-08-source-review/">${tr(['Development changelog', 'سجل تغييرات التطوير'])}</a></li>
      <li><a href="${repository}#readme">${tr(['Installation and usage documentation', 'وثائق التثبيت والاستخدام'])}</a></li>
      <li><a href="${website}/contact">${tr(['Contact Nexvary support', 'التواصل مع دعم Nexvary'])}</a></li>
    </ul>
    <h2>${tr(['Legal information for owner review', 'معلومات قانونية بانتظار مراجعة المالك'])}</h2>
    ${policies.map(([heading, body]) => `<h3>${tr(heading)}</h3><p>${tr(body)}</p>`).join('')}`;
}

export function developerInformation(tr) {
  return `
    <h2 lang="en">Nexvary Inc.</h2>
    <p>${tr(['Nexvary Inc. develops NRI and works in software engineering, cybersecurity and artificial intelligence research.',
      'تطوّر شركة Nexvary Inc. منصة NRI وتعمل في هندسة البرمجيات والأمن السيبراني وأبحاث الذكاء الاصطناعي.'])}</p>
    <h2>${tr(['Official contact and channels', 'التواصل والقنوات الرسمية'])}</h2>
    <ul class="about-links">
      <li><a href="${website}/">${tr(['Company website', 'موقع الشركة'])}</a></li>
      <li><a href="${website}/about">${tr(['Company profile', 'ملف الشركة'])}</a></li>
      <li><a href="${website}/contact">${tr(['Contact form', 'نموذج التواصل'])}</a></li>
      <li><a href="mailto:info@nexvary.com"><bdi>info@nexvary.com</bdi></a></li>
      <li><a href="https://github.com/nexvary"><bdi>GitHub</bdi></a></li>
      <li><a href="https://www.youtube.com/@NexvaryInc"><bdi>YouTube</bdi></a></li>
      <li><a href="https://x.com/Nexvary"><bdi>X</bdi></a></li>
    </ul>`;
}
