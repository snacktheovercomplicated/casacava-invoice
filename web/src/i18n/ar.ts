/**
 * Every Arabic string in the interface.
 *
 * Typed as `Strings`, so if a key is added to en.ts and forgotten here the
 * build fails rather than showing English text to an Arabic user.
 */
import type { Strings } from "./en.ts";

const ar: Strings = {
  appName: "كازا كافا",
  appSection: "الفواتير",

  nav: {
    invoices: "الفواتير",
    items: "المنتجات",
    customers: "العملاء",
    settings: "الإعدادات",
    signOut: "تسجيل الخروج",
    language: "English",
    switchToArabic: "التبديل إلى الإنجليزية",
  },

  theme: {
    label: "المظهر",
    auto: "تلقائي",
    light: "فاتح",
    dark: "داكن",
    autoHint: "يتبع إعداد هاتفك أو جهازك",
    change: "تغيير المظهر",
  },

  common: {
    save: "حفظ",
    saving: "جاري الحفظ…",
    saved: "تم الحفظ",
    cancel: "إلغاء",
    close: "إغلاق",
    delete: "حذف",
    edit: "تعديل",
    add: "إضافة",
    remove: "إزالة",
    search: "بحث",
    loading: "جاري التحميل…",
    retry: "إعادة المحاولة",
    back: "رجوع",
    confirm: "تأكيد",
    none: "بدون",
    all: "الكل",
    yes: "نعم",
    no: "لا",
    required: "مطلوب",
    optional: "اختياري",
    egp: "جنيه",
    of: "من",
    unnamed: "بدون اسم",
  },

  status: {
    offline: "غير متصل — التعديلات محفوظة على هذا الجهاز",
    backOnline: "عاد الاتصال",
    syncing: "جاري المزامنة…",
    pendingChanges: (count: number) =>
      count === 1 ? "تعديل واحد في انتظار المزامنة" : `${count} تعديلات في انتظار المزامنة`,
  },

  login: {
    title: "تسجيل الدخول",
    subtitle: "فواتير كازا كافا",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    submit: "دخول",
    working: "جاري الدخول…",
    failed: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    offline: "تحتاج إلى اتصال لتسجيل الدخول أول مرة",
  },

  invoices: {
    title: "الفواتير",
    newInvoice: "فاتورة جديدة",
    empty: "لا توجد فواتير بعد",
    emptyFiltered: "لا توجد نتائج مطابقة",
    searchPlaceholder: "رقم الفاتورة أو اسم العميل",
    filterStatus: "الحالة",
    filterFrom: "من تاريخ",
    filterTo: "إلى تاريخ",
    clearFilters: "مسح",
    number: "الرقم",
    date: "التاريخ",
    customer: "العميل",
    total: "الإجمالي",
    draftNoNumber: "مسودة",
    issuedBy: "أصدرها",
    cancelledOn: "ملغاة",
    openPdf: "PDF",
    documentTypes: {
      invoice: "فاتورة",
      credit_note: "إشعار خصم",
      debit_note: "إشعار إضافة",
    },
    docStatus: {
      draft: "مسودة",
      issued: "صادرة",
      cancelled: "ملغاة",
    },
    gaps: {
      heading: "أرقام فواتير غير مستخدمة",
      explain:
        "هذه أرقام تم حجزها ولم تُسجَّل على أي مستند. تُحفظ هنا بالوقت والسبب " +
        "حتى يمكن تفسير الرقم الناقص.",
      recorded: "مسجلة",
      unexplained: "غير مفسرة",
      unexplainedNote:
        "هذه الأرقام ناقصة من التسلسل بدون أي سجل يوضح السبب. " +
        "من المفترض أن تكون هذه القائمة فارغة دائماً.",
      reason: "السبب",
      when: "الوقت",
      whichDraft: "كانت مخصصة لـ",
      show: "عرض الأرقام غير المستخدمة",
      hide: "إخفاء",
      count: (count: number) =>
        count === 1 ? "رقم واحد غير مستخدم" : `${count} أرقام غير مستخدمة`,
    },
  },

  editor: {
    newTitle: "فاتورة جديدة",
    editTitle: "تعديل مسودة",
    viewTitle: "فاتورة",
    documentType: "نوع المستند",
    documentLanguage: "لغة الفاتورة",
    documentLanguageHelp: "اللغة التي تُطبع بها هذه الفاتورة، مهما كانت لغة البرنامج",
    priceTier: "الأسعار",
    tierRetail: "قطاعي",
    tierWholesale: "جملة",
    customer: "العميل",
    chooseCustomer: "اختر عميلاً",
    walkIn: "أدخل البيانات يدوياً",
    savedCustomer: "عميل محفوظ",
    lines: "الأصناف",
    addLine: "إضافة صنف",
    pickProduct: "اختر منتجاً",
    freeText: "اكتب صنفاً يدوياً",
    lineName: "الصنف",
    quantity: "الكمية",
    unitPrice: "سعر الوحدة",
    discount: "الخصم",
    discountNone: "بدون",
    discountPercent: "نسبة",
    discountAmount: "مبلغ",
    vatRate: "ضريبة القيمة المضافة",
    lineTotal: "إجمالي السطر",
    noLines: "لا توجد أصناف بعد",
    subtotal: "المجموع",
    discountTotal: "الخصم",
    vatTotal: "الضريبة",
    grandTotal: "الإجمالي",
    amountInWords: "المبلغ كتابةً",
    notes: "ملاحظات",
    paymentTerms: "شروط الدفع",
    saveDraft: "حفظ المسودة",
    deleteDraft: "حذف المسودة",
    deleteDraftConfirm: "حذف هذه المسودة؟ يمكن حذف المسودات بحرية.",
    issue: "إصدار الفاتورة",
    issueTitle: "إصدار هذه الفاتورة؟",
    issueBody:
      "سوف تأخذ رقم الفاتورة التالي ولا يمكن تعديلها أو حذفها بعد ذلك أبداً. " +
      "التصحيحات تتم عن طريق إشعار خصم.",
    issueConfirm: "نعم، أصدرها",
    issueOffline:
      "الإصدار يحتاج إلى اتصال. رقم الفاتورة لا يصدر إلا من الخادم، حتى لا " +
      "يحصل كلاكما على نفس الرقم. المسودة محفوظة ويمكنك إصدارها عند عودة الاتصال.",
    issuing: "جاري الإصدار…",
    issuedNotice: "تم الإصدار. لا يمكن تغيير هذه الفاتورة بعد الآن.",
    cancelInvoice: "إلغاء الفاتورة",
    cancelTitle: "إلغاء هذه الفاتورة؟",
    cancelBody: "تحتفظ برقمها وتبقى في السجل مع تعليمها كملغاة.",
    cancelReason: "السبب",
    cancelConfirm: "إلغاؤها",
    creditNote: "إنشاء إشعار خصم",
    creditNoteBody:
      "ينشئ هذا مسودة جديدة مرتبطة بهذه الفاتورة. عدّلها لتشمل ما يتم رده فعلاً " +
      "ثم أصدرها.",
    references: "تصحيح لـ",
    readOnly: "الفواتير الصادرة لا يمكن تعديلها",
  },

  items: {
    title: "المنتجات",
    newItem: "منتج جديد",
    empty: "لا توجد منتجات بعد",
    searchPlaceholder: "ابحث في المنتجات",
    nameAr: "الاسم بالعربية",
    nameEn: "الاسم بالإنجليزية",
    nameHelp: "يكفي أحد الاسمين",
    categoryAr: "التصنيف بالعربية",
    categoryEn: "التصنيف بالإنجليزية",
    unitPrice: "سعر القطاعي",
    wholesalePrice: "سعر الجملة",
    unitAr: "الوحدة بالعربية",
    unitEn: "الوحدة بالإنجليزية",
    vatRate: "نسبة الضريبة",
    vatInherit: "اتباع الإعداد العام",
    vatOwn: "تحديد لهذا المنتج فقط",
    active: "ظاهر في القائمة",
    showInactive: "عرض المنتجات المخفية",
    deactivate: "إخفاء",
    deactivateConfirm:
      "إخفاء هذا المنتج؟ سيبقى على كل فاتورة تستخدمه بالفعل — المنتجات لا تُحذف أبداً.",
    hidden: "مخفي",
  },

  customers: {
    title: "العملاء",
    newCustomer: "عميل جديد",
    empty: "لا يوجد عملاء بعد",
    searchPlaceholder: "الاسم أو الهاتف",
    nameAr: "الاسم بالعربية",
    nameEn: "الاسم بالإنجليزية",
    phone: "الهاتف",
    address: "العنوان",
    governorate: "المحافظة",
    type: "النوع",
    typeBusiness: "شركة",
    typeIndividual: "فرد",
    taxNumber: "الرقم الضريبي",
    taxNumberRequired: "الشركات يجب أن يكون لها رقم ضريبي",
    preferredLanguage: "لغة الفاتورة المفضلة",
    deleteConfirm: "إزالة هذا العميل؟",
    keptHasDocuments: "تم الاحتفاظ به لوجود فواتير مرتبطة",
  },

  settings: {
    title: "الإعدادات",
    company: "بيانات الشركة",
    legalNameAr: "الاسم القانوني (عربي)",
    legalNameEn: "الاسم القانوني (إنجليزي)",
    tradeNameAr: "الاسم التجاري (عربي)",
    tradeNameEn: "الاسم التجاري (إنجليزي)",
    taxRegistration: "الرقم الضريبي",
    commercialRegister: "رقم السجل التجاري",
    addressAr: "العنوان (عربي)",
    addressEn: "العنوان (إنجليزي)",
    phone: "الهاتف",
    email: "البريد الإلكتروني",
    logo: "الشعار",
    logoChoose: "اختر صورة",
    logoRemove: "إزالة الشعار",
    documents: "المستندات",
    defaultVat: "نسبة الضريبة الافتراضية",
    defaultVatHelp:
      "كل منتج ليس له نسبة خاصة يتبع هذه النسبة. اضبطها على ١٤٪ يوم التسجيل " +
      "في ضريبة القيمة المضافة وتتحرك كل المنتجات دفعة واحدة.",
    defaultLanguage: "لغة الفاتورة الافتراضية",
    paymentTermsAr: "شروط الدفع (عربي)",
    paymentTermsEn: "شروط الدفع (إنجليزي)",
    footerAr: "ملاحظة التذييل (عربي)",
    footerEn: "ملاحظة التذييل (إنجليزي)",
    termsAr: "الشروط (عربي)",
    termsEn: "الشروط (إنجليزي)",
    arabic: "عربي",
    english: "إنجليزي",
    missingEnglish:
      "لا توجد نسخة إنجليزية. الفاتورة الإنجليزية ستطبع النص العربي هنا.",
    missingArabic:
      "لا توجد نسخة عربية. الفاتورة العربية ستطبع النص الإنجليزي هنا.",
    bilingualHint:
      "كل خانة من هذه تُطبع على الفاتورة بلغة الفاتورة نفسها. " +
      "املأ الجانبين إذا كنت ترسل فواتير باللغتين.",
  },

  errors: {
    generic: "حدث خطأ ما",
    network: "تعذر الوصول إلى الخادم",
    notFound: "غير موجود",
    notADraft: "هذا المستند صادر ولا يمكن تعديله بعد الآن",
    signedOut: "انتهت الجلسة. برجاء تسجيل الدخول مرة أخرى.",
    needsName: "مطلوب اسم بإحدى اللغتين على الأقل",
    needsLine: "أضف صنفاً واحداً على الأقل قبل الإصدار",
    badNumber: "هذا ليس رقماً صحيحاً",
    tooManyDecimals: "عدد الخانات العشرية أكبر من المسموح",
  },
};

export default ar;
