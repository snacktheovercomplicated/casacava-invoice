-- Your company details and the number series. Run once, after the migrations.
-- Edit the values, then:
--   npx wrangler d1 execute casacava-invoice --remote --file=db/seed_company.sql

INSERT INTO company_settings (
  id,
  legal_name_ar, legal_name_en,
  trade_name_ar, trade_name_en,
  tax_registration_number, commercial_register_number,
  address_ar, address_en,
  phone, email,
  default_vat_rate_bp,
  default_document_language,
  payment_terms_ar, payment_terms_en,
  footer_note_ar, footer_note_en,
  updated_at
) VALUES (
  1,
  NULL, NULL,                      -- legal name: fill in
  'كازا كافا', 'Casa Cava',        -- trade name
  NULL, NULL,                      -- tax registration / commercial register: fill in
  NULL, NULL,                      -- address: fill in
  NULL, NULL,                      -- phone / email: fill in
  0,                               -- VAT OFF. Change to 1400 the day you register.
  'ar',
  'دفع عند الاستلام او تحويل',
  'Cash on delivery or bank transfer',
  'شكرا لثقتكم في كازا كافا. برجاء اتمام عملية الدفع عن طريق انستا باي علي الرقم 01094715831',
  'Thank you for trusting Casa Cava. Payment via InstaPay on 01094715831.',
  datetime('now')
)
ON CONFLICT (id) DO NOTHING;

-- The number series. One row per document type per year; the API creates
-- next year's row by itself the first time it needs it. These three just
-- set where 2026 starts.
INSERT INTO document_counters (document_type, year, prefix, next_number, pad_width)
VALUES ('invoice',     2026, 'INV', 1, 3),
       ('credit_note', 2026, 'CN',  1, 3),
       ('debit_note',  2026, 'DN',  1, 3)
ON CONFLICT (document_type, year) DO NOTHING;
