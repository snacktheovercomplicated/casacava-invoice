/** The shapes the Worker returns. Money is always whole piastres. */

export type Lang = "ar" | "en";
export type DocStatus = "draft" | "issued" | "cancelled";
export type DocumentType = "invoice" | "credit_note" | "debit_note";
export type PriceTier = "retail" | "wholesale";
export type DiscountType = "none" | "percent" | "amount";

export interface User {
  id: string;
  email: string;
  display_name: string;
  ui_language: Lang;
}

export interface Settings {
  id: number;
  legal_name_ar: string | null;
  legal_name_en: string | null;
  trade_name_ar: string | null;
  trade_name_en: string | null;
  tax_registration_number: string | null;
  commercial_register_number: string | null;
  address_ar: string | null;
  address_en: string | null;
  phone: string | null;
  email: string | null;
  logo_data_url: string | null;
  default_vat_rate_bp: number;
  default_document_language: Lang;
  payment_terms_ar: string | null;
  payment_terms_en: string | null;
  footer_note_ar: string | null;
  footer_note_en: string | null;
  terms_ar: string | null;
  terms_en: string | null;
}

export interface Item {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  category_ar: string | null;
  category_en: string | null;
  unit_price_piastres: number;
  wholesale_price_piastres: number | null;
  unit_ar: string | null;
  unit_en: string | null;
  vat_rate_bp: number | null;
  is_active: number;
  sort_order: number;
}

export interface Customer {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  phone: string | null;
  address: string | null;
  governorate: string | null;
  customer_type: "business" | "individual";
  tax_registration_number: string | null;
  preferred_document_language: Lang;
  is_active: number;
  notes: string | null;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  line_no: number;
  item_id: string | null;
  name_ar: string | null;
  name_en: string | null;
  unit_ar: string | null;
  unit_en: string | null;
  unit_price_piastres: number;
  vat_rate_bp: number;
  quantity_milli: number;
  discount_type: DiscountType;
  discount_value: number;
  gross_piastres: number;
  discount_piastres: number;
  net_piastres: number;
  vat_piastres: number;
  total_piastres: number;
}

export interface Invoice {
  id: string;
  document_type: DocumentType;
  references_invoice_id: string | null;
  /** The printed number of the document this corrects, filled in by the API. */
  references_invoice_number?: string | null;
  doc_status: DocStatus;
  eta_status: string | null;
  document_language: Lang;
  price_tier: PriceTier;
  invoice_number: string | null;
  invoice_serial: number | null;
  invoice_year: number | null;
  issue_date: string | null;
  customer_id: string | null;
  customer_name_ar: string | null;
  customer_name_en: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_governorate: string | null;
  customer_type: string | null;
  customer_tax_registration_number: string | null;
  company_snapshot?: Partial<Settings> | null;
  subtotal_piastres: number;
  discount_total_piastres: number;
  vat_total_piastres: number;
  total_piastres: number;
  notes: string | null;
  payment_terms: string | null;
  created_by: string;
  issued_by: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  cancelled_at: string | null;
}

/** What the editor sends back up. Totals are deliberately absent: the server works them out. */
export interface DraftLineInput {
  item_id: string | null;
  name_ar: string | null;
  name_en: string | null;
  unit_ar: string | null;
  unit_en: string | null;
  unit_price_piastres: number;
  vat_rate_bp: number;
  quantity_milli: number;
  discount_type: DiscountType;
  discount_value: number;
}

export interface DraftInput {
  document_type: DocumentType;
  references_invoice_id?: string | null;
  document_language: Lang;
  price_tier: PriceTier;
  customer_id: string | null;
  customer_name_ar: string | null;
  customer_name_en: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_governorate: string | null;
  customer_type: string | null;
  customer_tax_registration_number: string | null;
  notes: string | null;
  payment_terms: string | null;
  lines: DraftLineInput[];
}

export interface UnusedNumber {
  id: string;
  document_type: DocumentType;
  year: number;
  serial: number;
  invoice_number: string;
  invoice_id: string | null;
  allocated_by_name: string | null;
  allocated_at: string;
  failure_reason: string;
}

export interface UnexplainedNumber {
  document_type: DocumentType;
  year: number;
  serial: number;
  invoice_number: string;
}
