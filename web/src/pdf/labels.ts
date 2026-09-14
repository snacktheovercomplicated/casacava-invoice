/**
 * The words printed ON the document.
 *
 * Deliberately separate from the interface translations in src/i18n. These
 * follow the INVOICE's language, not the app's: working in Arabic and sending
 * an English invoice is normal, and then every label on the paper is English
 * while every button around it stays Arabic.
 */
export interface DocumentLabels {
  invoice: string;
  creditNote: string;
  debitNote: string;
  number: string;
  issueDate: string;
  billTo: string;
  phone: string;
  address: string;
  taxNumber: string;
  commercialRegister: string;
  item: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vat: string;
  amount: string;
  subtotal: string;
  discountTotal: string;
  vatTotal: string;
  total: string;
  amountInWords: string;
  notes: string;
  paymentTerms: string;
  terms: string;
  noItems: string;
  cancelled: string;
  draft: string;
  corrects: string;
  issuedBy: string;
  page: string;
  pageOf: string;
}

const ar: DocumentLabels = {
  invoice: "فاتورة",
  creditNote: "إشعار خصم",
  debitNote: "إشعار إضافة",
  number: "رقم الفاتورة",
  issueDate: "تاريخ الإصدار",
  billTo: "العميل",
  phone: "الهاتف",
  address: "العنوان",
  taxNumber: "الرقم الضريبي",
  commercialRegister: "السجل التجاري",
  item: "الصنف / البيان",
  quantity: "الكمية",
  unitPrice: "سعر الوحدة",
  discount: "الخصم",
  vat: "الضريبة",
  amount: "الإجمالي",
  subtotal: "المجموع",
  discountTotal: "إجمالي الخصم",
  vatTotal: "ضريبة القيمة المضافة",
  total: "الإجمالي المستحق",
  amountInWords: "المبلغ كتابةً",
  notes: "ملاحظات",
  paymentTerms: "شروط الدفع",
  terms: "الشروط والأحكام",
  noItems: "لا توجد أصناف",
  cancelled: "ملغاة",
  draft: "مسودة — غير صادرة",
  corrects: "تصحيح للفاتورة",
  issuedBy: "أصدرها",
  page: "صفحة",
  pageOf: "من",
};

const en: DocumentLabels = {
  invoice: "Invoice",
  creditNote: "Credit Note",
  debitNote: "Debit Note",
  number: "Invoice number",
  issueDate: "Issue date",
  billTo: "Bill to",
  phone: "Phone",
  address: "Address",
  taxNumber: "Tax registration no.",
  commercialRegister: "Commercial register no.",
  item: "Item / Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  discount: "Discount",
  vat: "VAT",
  amount: "Amount",
  subtotal: "Subtotal",
  discountTotal: "Total discount",
  vatTotal: "VAT",
  total: "Total due",
  amountInWords: "Amount in words",
  notes: "Notes",
  paymentTerms: "Payment terms",
  terms: "Terms and conditions",
  noItems: "No items",
  cancelled: "CANCELLED",
  draft: "DRAFT — NOT ISSUED",
  corrects: "Corrects invoice",
  issuedBy: "Issued by",
  page: "Page",
  pageOf: "of",
};

export const DOCUMENT_LABELS: Record<"ar" | "en", DocumentLabels> = { ar, en };
