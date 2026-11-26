// Each pair contains English followed by Arabic.
export const copy = {
  product: ['Research Intelligence', 'ذكاء الأبحاث'],
  motto: ['From scientific evidence to strategic decisions.', 'من الأدلة العلمية إلى القرارات الاستراتيجية.'],
  skip: ['Skip to content', 'انتقل إلى المحتوى'],
  navigation: ['Main navigation', 'التنقّل الرئيسي'],
  language: ['Change language', 'تغيير اللغة'],
  signIn: ['Sign in to see your workspace', 'سجّل الدخول لعرض مساحة عملك'],
  noResearch: ['No projects yet', 'لا توجد مشاريع بعد'],
  noActivity: ['No library activity yet', 'لا يوجد نشاط في المكتبة بعد'],
  latest: ['Recent research', 'أبحاثي الأخيرة'],
  quick: ['Explore the L-READY framework', 'استكشف إطار L-READY'],
  statistics: ['Workspace statistics', 'إحصاءات مساحة العمل'],
  activity: ['Recent library activity', 'أحدث نشاط في المكتبة'],
  sources: ['Reference provider websites', 'مواقع مزوّدي المراجع'],
  planned: ['Planned module', 'وحدة قيد التخطيط'],
  unavailable: ['This module is scheduled for a later milestone.', 'هذه الوحدة مجدولة لمرحلة تطوير لاحقة.'],
  empty: ['No workspace data is stored by this preview.', 'لا تحفظ هذه النسخة بيانات مساحة العمل.'],
  framework: ['L-READY is a proposed qualitative research framework.', '‏L-READY إطار بحثي نوعي مقترح.'],
  aboutSystem: ['About the system', 'عن النظام'],
  aboutDeveloper: ['About the developer', 'عن المطوّر'],
  version: ['Version', 'الإصدار'],
  build: ['Development preview', 'نسخة تطوير تجريبية'],
  developer: ['Nexvary Inc. develops NRI. Visit the company website for official information and contact options.', 'تطوّر شركة Nexvary Inc. منصة NRI. تفضّل بزيارة موقع الشركة للمعلومات الرسمية ووسائل التواصل.'],
  website: ['Nexvary Inc. website', 'موقع Nexvary Inc.'],
  docs: ['Project documentation', 'وثائق المشروع'],
  status: ['Development status', 'حالة التطوير'],
  api: ['Live API spend', 'إنفاق الواجهات البرمجية الفعلي'],
  inactive: ['Inactive', 'غير مفعّل'],
  unknown: ['Page unavailable', 'الصفحة غير متاحة'],
  home: ['Return to the dashboard', 'العودة إلى لوحة التحكم'],
};

export const modules = {
  dashboard: ['🏠', 'blue', ['Dashboard', 'لوحة التحكم']],
  research: ['📚', 'blue', ['Research workspace', 'إدارة الأبحاث'], ['Manage projects and research records', 'إدارة المشاريع والسجلات البحثية']],
  library: ['📖', 'blue', ['Scientific library', 'المكتبة العلمية'], ['Search private PDFs and saved sources', 'ابحث في ملفات PDF الخاصة والمصادر المحفوظة']],
  references: ['🔗', 'blue', ['Reference validator', 'التحقق من المراجع']],
  evidence: ['🔎', 'pink', ['Evidence intelligence', 'تحليل الأدلة'], ['Review the evidence behind claims', 'مراجعة الأدلة التي تستند إليها الادعاءات']],
  'l-ready': ['🛡️', 'green', ['L-READY', 'L-READY'], ['Explore technology readiness', 'استكشاف جاهزية التكنولوجيا']],
  economics: ['📊', 'gold', ['Economic analytics', 'التحليل الاقتصادي'], ['Examine costs and assumptions', 'فحص التكاليف والافتراضات']],
  assistant: ['🧠', 'violet', ['AI assistant', 'المساعد الذكي'], ['Optional research assistance', 'مساعدة بحثية اختيارية']],
  network: ['🌐', 'blue', ['Research network', 'شبكة الباحثين'], ['Discover researchers and collaborate', 'التعرّف على الباحثين والتعاون معهم']],
  collaboration: ['🤝', 'gold', ['Projects and collaboration', 'المشاريع والتعاون']],
  messages: ['💬', 'blue', ['Messages', 'الرسائل']],
  observatory: ['🔭', 'blue', ['Technology observatory', 'مرصد التكنولوجيا']],
  analytics: ['📈', 'green', ['Scientific analytics', 'التحليلات العلمية']],
  education: ['🎓', 'violet', ['Education and training', 'التعليم والتدريب'], ['Tutorials and scientific learning resources', 'الدروس والموارد التعليمية العلمية']],
  reports: ['📑', 'blue', ['Reports and exports', 'التقارير والمخرجات']],
  settings: ['⚙️', 'blue', ['System and settings', 'النظام والإعدادات']],
  about: ['ℹ️', 'blue', ['About NRI', 'عن المنصة']],
};

export const dimensions = [
  ['L', '⚗️', 'blue', ['Scientific evidence', 'الأدلة العلمية']],
  ['R', '🔎', 'pink', ['Independent verification', 'التحقق المستقل']],
  ['E', '🪙', 'gold', ['Economics', 'الجدوى الاقتصادية']],
  ['A', '⚙️', 'blue', ['Availability', 'الإتاحة التشغيلية']],
  ['D', '🛡️', 'green', ['Safety and governance', 'السلامة والحوكمة']],
  ['Y', '🌿', 'green', ['Societal value', 'القيمة المجتمعية']],
];

export const metrics = [
  ['📄', 'projects', ['Research projects', 'مشاريع الأبحاث']],
  ['📚', 'pdfs', ['Private PDFs', 'ملفات PDF الخاصة']],
  ['🔗', 'sources', ['Saved sources', 'المصادر المحفوظة']],
  ['🔎', 'evidence', ['Evidence links', 'روابط الأدلة']],
];

export const providers = {
  ORCID: 'https://orcid.org/',
  Crossref: 'https://www.crossref.org/',
  OpenAlex: 'https://openalex.org/',
  DOAJ: 'https://doaj.org/',
  PubMed: 'https://pubmed.ncbi.nlm.nih.gov/',
  arXiv: 'https://arxiv.org/',
  Zenodo: 'https://zenodo.org/',
};
