/**
 * Every English string in the interface. Nothing is written in a component.
 *
 * This file is the source of truth for the shape: `ar.ts` is typed against it,
 * so forgetting to translate a new string is a compile error, not something
 * discovered later by Mum.
 *
 * To add a string: add it here, then add the same key to ar.ts.
 */
const en = {
  appName: "Casa Cava",
  appSection: "Invoices",

  nav: {
    invoices: "Invoices",
    items: "Products",
    customers: "Customers",
    settings: "Settings",
    signOut: "Sign out",
    language: "العربية",
  },

  common: {
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    remove: "Remove",
    search: "Search",
    loading: "Loading…",
    retry: "Try again",
    back: "Back",
    confirm: "Confirm",
    none: "None",
    all: "All",
    yes: "Yes",
    no: "No",
    required: "Required",
    optional: "optional",
    egp: "EGP",
    of: "of",
    unnamed: "Untitled",
  },

  status: {
    offline: "Offline — changes are saved on this device",
    backOnline: "Back online",
    syncing: "Syncing…",
    pendingChanges: (count: number) =>
      count === 1 ? "1 change waiting to sync" : `${count} changes waiting to sync`,
  },

  login: {
    title: "Sign in",
    subtitle: "Casa Cava invoices",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    working: "Signing in…",
    failed: "Wrong email or password",
    offline: "You need a connection to sign in the first time",
  },

  invoices: {
    title: "Invoices",
    newInvoice: "New invoice",
    empty: "No invoices yet",
    emptyFiltered: "Nothing matches that",
    searchPlaceholder: "Number, or customer name",
    filterStatus: "Status",
    filterFrom: "From",
    filterTo: "To",
    clearFilters: "Clear",
    number: "Number",
    date: "Date",
    customer: "Customer",
    total: "Total",
    draftNoNumber: "Draft",
    issuedBy: "Issued by",
    cancelledOn: "Cancelled",
    openPdf: "PDF",
    documentTypes: {
      invoice: "Invoice",
      credit_note: "Credit note",
      debit_note: "Debit note",
    },
    docStatus: {
      draft: "Draft",
      issued: "Issued",
      cancelled: "Cancelled",
    },
    gaps: {
      heading: "Unused invoice numbers",
      explain:
        "These numbers were taken but never ended up on a document. They are " +
        "recorded here with the time and reason so the gap can be explained.",
      recorded: "Recorded",
      unexplained: "Unexplained",
      unexplainedNote:
        "These numbers are missing from the series with no record of why. " +
        "This list should normally be empty.",
      reason: "Reason",
      when: "When",
      whichDraft: "Meant for",
      show: "Show unused numbers",
      hide: "Hide",
      count: (count: number) =>
        count === 1 ? "1 unused number" : `${count} unused numbers`,
    },
  },

  editor: {
    newTitle: "New invoice",
    editTitle: "Edit draft",
    viewTitle: "Invoice",
    documentType: "Document",
    documentLanguage: "Invoice language",
    documentLanguageHelp: "The language this invoice prints in, whatever the app is set to",
    priceTier: "Prices",
    tierRetail: "Retail",
    tierWholesale: "Wholesale",
    customer: "Customer",
    chooseCustomer: "Choose a customer",
    walkIn: "Type the details instead",
    savedCustomer: "Saved customer",
    lines: "Items",
    addLine: "Add an item",
    pickProduct: "Pick a product",
    freeText: "Type an item instead",
    lineName: "Item",
    quantity: "Quantity",
    unitPrice: "Unit price",
    discount: "Discount",
    discountNone: "None",
    discountPercent: "Percent",
    discountAmount: "Amount",
    vatRate: "VAT",
    lineTotal: "Line total",
    noLines: "No items yet",
    subtotal: "Subtotal",
    discountTotal: "Discount",
    vatTotal: "VAT",
    grandTotal: "Total",
    amountInWords: "In words",
    notes: "Notes",
    paymentTerms: "Payment terms",
    saveDraft: "Save draft",
    deleteDraft: "Delete draft",
    deleteDraftConfirm: "Delete this draft? Drafts can be deleted freely.",
    issue: "Issue invoice",
    issueTitle: "Issue this invoice?",
    issueBody:
      "It will take the next invoice number and can never be edited or deleted " +
      "afterwards. Corrections are made with a credit note.",
    issueConfirm: "Yes, issue it",
    issueOffline:
      "Issuing needs a connection. An invoice number can only be given out by " +
      "the server, so that both of you never get the same number. The draft is " +
      "saved and you can issue it when you are back online.",
    issuing: "Issuing…",
    issuedNotice: "Issued. This invoice can no longer be changed.",
    cancelInvoice: "Cancel invoice",
    cancelTitle: "Cancel this invoice?",
    cancelBody: "It keeps its number and stays on record, marked cancelled.",
    cancelReason: "Reason",
    cancelConfirm: "Cancel it",
    creditNote: "Make a credit note",
    creditNoteBody:
      "This makes a new draft that points at this invoice. Edit it down to what " +
      "is actually being credited, then issue it.",
    references: "Corrects",
    readOnly: "Issued invoices cannot be edited",
  },

  items: {
    title: "Products",
    newItem: "New product",
    empty: "No products yet",
    searchPlaceholder: "Search products",
    nameAr: "Arabic name",
    nameEn: "English name",
    nameHelp: "One of the two is enough",
    categoryAr: "Arabic category",
    categoryEn: "English category",
    unitPrice: "Retail price",
    wholesalePrice: "Wholesale price",
    unitAr: "Arabic unit",
    unitEn: "English unit",
    vatRate: "VAT rate",
    vatInherit: "Follow the company default",
    vatOwn: "Set for this product only",
    active: "In the list",
    showInactive: "Show hidden products",
    deactivate: "Hide",
    deactivateConfirm:
      "Hide this product? It stays on every invoice that already uses it — " +
      "products are never deleted.",
    hidden: "Hidden",
  },

  customers: {
    title: "Customers",
    newCustomer: "New customer",
    empty: "No customers yet",
    searchPlaceholder: "Name or phone",
    nameAr: "Arabic name",
    nameEn: "English name",
    phone: "Phone",
    address: "Address",
    governorate: "Governorate",
    type: "Type",
    typeBusiness: "Business",
    typeIndividual: "Individual",
    taxNumber: "Tax registration number",
    taxNumberRequired: "A business customer must have a tax registration number",
    preferredLanguage: "Preferred invoice language",
    deleteConfirm: "Remove this customer?",
    keptHasDocuments: "Kept, because invoices refer to it",
  },

  settings: {
    title: "Settings",
    company: "Company",
    legalNameAr: "Legal name (Arabic)",
    legalNameEn: "Legal name (English)",
    tradeNameAr: "Trade name (Arabic)",
    tradeNameEn: "Trade name (English)",
    taxRegistration: "Tax registration number",
    commercialRegister: "Commercial register number",
    addressAr: "Address (Arabic)",
    addressEn: "Address (English)",
    phone: "Phone",
    email: "Email",
    logo: "Logo",
    logoChoose: "Choose an image",
    logoRemove: "Remove logo",
    documents: "Documents",
    defaultVat: "Default VAT rate",
    defaultVatHelp:
      "Every product without its own rate follows this. Set it to 14% on the day " +
      "you register for VAT and the whole catalogue moves at once.",
    defaultLanguage: "Default invoice language",
    paymentTermsAr: "Payment terms (Arabic)",
    paymentTermsEn: "Payment terms (English)",
    footerAr: "Footer note (Arabic)",
    footerEn: "Footer note (English)",
    termsAr: "Terms (Arabic)",
    termsEn: "Terms (English)",
    arabic: "Arabic",
    english: "English",
    missingEnglish:
      "No English version. An English invoice will print the Arabic text here.",
    missingArabic:
      "No Arabic version. An Arabic invoice will print the English text here.",
    bilingualHint:
      "Each of these prints on the invoice in the invoice's own language. " +
      "Fill in both sides if you send invoices in both.",
  },

  errors: {
    generic: "Something went wrong",
    network: "Could not reach the server",
    notFound: "Not found",
    notADraft: "This document has been issued and can no longer be edited",
    signedOut: "Your session has ended. Please sign in again.",
    needsName: "A name in at least one language is needed",
    needsLine: "Add at least one item before issuing",
    badNumber: "That is not a valid number",
    tooManyDecimals: "Too many decimal places",
  },
};

/** The shape every language file must have. ar.ts is checked against this. */
export type Strings = typeof en;

export default en;
