-- Casa Cava invoicing — initial schema.
--
-- MONEY:      every money column is an INTEGER count of piastres (1 EGP = 100).
-- QUANTITY:   every quantity is an INTEGER scaled by 1000 (1.500 kg = 1500).
-- RATES:      every VAT / percentage-discount rate is in basis points
--             (10000 = 100.00%, 1400 = 14.00%, 0 = 0.00%).
-- There is no floating-point number anywhere in this database.

------------------------------------------------------------------------------
-- The two people who can log in.
------------------------------------------------------------------------------
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  -- password_verifier is NOT the value the app sends. The app sends a
  -- PBKDF2 digest of the password; the server salts and hashes THAT again
  -- before storing it here. A copy of this database therefore cannot be
  -- used to log in. See src/lib/password.ts.
  password_verifier TEXT NOT NULL,
  password_salt     TEXT NOT NULL,          -- server-side salt, base64, per user
  password_iters    INTEGER NOT NULL,       -- server-side iteration count
  display_name   TEXT NOT NULL,
  ui_language    TEXT NOT NULL DEFAULT 'ar' CHECK (ui_language IN ('ar','en')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

------------------------------------------------------------------------------
-- One row per logged-in device, so nobody has to log in while packing orders.
------------------------------------------------------------------------------
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,            -- SHA-256 of the token, never the token
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

------------------------------------------------------------------------------
-- Your company details. Exactly one row. Printed on every document.
------------------------------------------------------------------------------
CREATE TABLE company_settings (
  id                         INTEGER PRIMARY KEY CHECK (id = 1),
  legal_name_ar  TEXT, legal_name_en  TEXT,
  trade_name_ar  TEXT, trade_name_en  TEXT,
  tax_registration_number    TEXT,
  commercial_register_number TEXT,
  address_ar     TEXT, address_en     TEXT,
  phone          TEXT, email          TEXT,
  logo_data_url  TEXT,                      -- the logo itself, base64 data URI

  -- THE VAT SWITCH. 0 = not VAT-registered (today). Set this to 1400 on the
  -- day you register and every item that has not been given its own rate
  -- follows automatically. No migration, no bulk edit.
  default_vat_rate_bp        INTEGER NOT NULL DEFAULT 0
                             CHECK (default_vat_rate_bp BETWEEN 0 AND 10000),

  default_document_language  TEXT NOT NULL DEFAULT 'ar'
                             CHECK (default_document_language IN ('ar','en')),
  payment_terms_ar TEXT, payment_terms_en TEXT,
  footer_note_ar   TEXT, footer_note_en   TEXT,
  terms_ar         TEXT, terms_en         TEXT,
  updated_at     TEXT NOT NULL
);

------------------------------------------------------------------------------
-- Your product catalogue. Rows are deactivated, never deleted.
------------------------------------------------------------------------------
CREATE TABLE items (
  id            TEXT PRIMARY KEY,
  name_ar       TEXT, name_en     TEXT,
  category_ar   TEXT, category_en TEXT,
  unit_price_piastres      INTEGER NOT NULL DEFAULT 0
                           CHECK (unit_price_piastres >= 0),
  wholesale_price_piastres INTEGER
                           CHECK (wholesale_price_piastres IS NULL
                                  OR wholesale_price_piastres >= 0),
  unit_ar       TEXT, unit_en     TEXT,

  -- NULL means "use company_settings.default_vat_rate_bp".
  -- A number here overrides it for this item only.
  vat_rate_bp   INTEGER CHECK (vat_rate_bp IS NULL
                               OR vat_rate_bp BETWEEN 0 AND 10000),

  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  egs_code      TEXT,                       -- phase 2 (ETA), null for now
  gpc_code      TEXT,                       -- phase 2 (ETA), null for now
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (COALESCE(name_ar, name_en) IS NOT NULL)
);
CREATE INDEX idx_items_active ON items(is_active, sort_order);

------------------------------------------------------------------------------
-- The people you sell to.
------------------------------------------------------------------------------
CREATE TABLE customers (
  id            TEXT PRIMARY KEY,
  name_ar       TEXT, name_en TEXT,
  phone         TEXT,
  address       TEXT,
  governorate   TEXT,                       -- a code, e.g. 'CAI'; the UI translates it
  customer_type TEXT NOT NULL DEFAULT 'individual'
                CHECK (customer_type IN ('business','individual')),
  tax_registration_number     TEXT,
  preferred_document_language TEXT NOT NULL DEFAULT 'ar'
                CHECK (preferred_document_language IN ('ar','en')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (COALESCE(name_ar, name_en) IS NOT NULL),
  CHECK (customer_type <> 'business'
         OR (tax_registration_number IS NOT NULL
             AND TRIM(tax_registration_number) <> ''))
);
CREATE INDEX idx_customers_active ON customers(is_active);

------------------------------------------------------------------------------
-- One row per document. Frozen the moment it stops being a draft.
------------------------------------------------------------------------------
CREATE TABLE invoices (
  id                    TEXT PRIMARY KEY,   -- made by the device; works offline
  document_type         TEXT NOT NULL DEFAULT 'invoice'
                        CHECK (document_type IN ('invoice','credit_note','debit_note')),
  references_invoice_id TEXT REFERENCES invoices(id),

  -- Our internal state. The only status phase 1 uses.
  doc_status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK (doc_status IN ('draft','issued','cancelled')),
  -- The tax authority's state. Stays NULL for the whole of phase 1.
  eta_status            TEXT CHECK (eta_status IS NULL OR eta_status IN
                        ('submitted','cleared','rejected','cancelled')),

  document_language     TEXT NOT NULL DEFAULT 'ar'
                        CHECK (document_language IN ('ar','en')),
  price_tier            TEXT NOT NULL DEFAULT 'retail'
                        CHECK (price_tier IN ('retail','wholesale')),

  -- All four NULL until the moment of issuing.
  invoice_number TEXT UNIQUE,
  invoice_serial INTEGER,
  invoice_year   INTEGER,
  issue_date     TEXT,

  -- Customer snapshot. Never joined to the live customer row when printing.
  customer_id TEXT REFERENCES customers(id),
  customer_name_ar TEXT, customer_name_en TEXT,
  customer_phone   TEXT, customer_address TEXT, customer_governorate TEXT,
  customer_type    TEXT, customer_tax_registration_number TEXT,
  -- Your own details, frozen as they were on the day. Change your address
  -- next year and last year's invoices still print last year's address.
  company_snapshot_json TEXT,

  subtotal_piastres       INTEGER NOT NULL DEFAULT 0,
  discount_total_piastres INTEGER NOT NULL DEFAULT 0,
  vat_total_piastres      INTEGER NOT NULL DEFAULT 0,
  total_piastres          INTEGER NOT NULL DEFAULT 0,

  notes TEXT, payment_terms TEXT,

  created_by    TEXT NOT NULL REFERENCES users(id),
  issued_by     TEXT REFERENCES users(id),
  cancelled_by  TEXT REFERENCES users(id),
  cancel_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  issued_at  TEXT, cancelled_at TEXT,

  -- Phase 2. Created now, written only when the ETA integration exists.
  eta_uuid TEXT, eta_submission_uuid TEXT,
  eta_sent_payload TEXT, eta_response TEXT, submitted_at TEXT,

  CHECK (doc_status = 'draft' OR invoice_number IS NOT NULL),
  CHECK (document_type = 'invoice' OR references_invoice_id IS NOT NULL),
  CHECK (total_piastres = subtotal_piastres + vat_total_piastres),
  CHECK (id <> references_invoice_id)
);
CREATE INDEX idx_invoices_status ON invoices(doc_status, issue_date);
CREATE INDEX idx_invoices_date   ON invoices(issue_date);
CREATE INDEX idx_invoices_cust   ON invoices(customer_id);
CREATE INDEX idx_invoices_type   ON invoices(document_type, invoice_year, invoice_serial);
CREATE INDEX idx_invoices_refs   ON invoices(references_invoice_id);

------------------------------------------------------------------------------
-- The lines on a document, each carrying its own frozen copy of the product.
------------------------------------------------------------------------------
CREATE TABLE invoice_lines (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  item_id    TEXT REFERENCES items(id),     -- NULL for a free-text line

  -- Item snapshot. Today's price and VAT rate, frozen.
  name_ar TEXT, name_en TEXT, unit_ar TEXT, unit_en TEXT,
  unit_price_piastres INTEGER NOT NULL CHECK (unit_price_piastres >= 0),
  -- Resolved at save time: never NULL here, even though items.vat_rate_bp may be.
  vat_rate_bp         INTEGER NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),

  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  discount_type  TEXT NOT NULL DEFAULT 'none'
                 CHECK (discount_type IN ('none','percent','amount')),
  -- percent -> basis points; amount -> piastres; none -> 0
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),

  gross_piastres    INTEGER NOT NULL CHECK (gross_piastres    >= 0),
  discount_piastres INTEGER NOT NULL CHECK (discount_piastres >= 0),
  net_piastres      INTEGER NOT NULL CHECK (net_piastres      >= 0),
  vat_piastres      INTEGER NOT NULL CHECK (vat_piastres      >= 0),
  total_piastres    INTEGER NOT NULL CHECK (total_piastres    >= 0),

  UNIQUE (invoice_id, line_no),
  CHECK (net_piastres   = gross_piastres - discount_piastres),
  CHECK (total_piastres = net_piastres   + vat_piastres),
  CHECK (discount_type <> 'none'    OR discount_value = 0),
  CHECK (discount_type <> 'percent' OR discount_value <= 10000)
);
CREATE INDEX idx_lines_invoice ON invoice_lines(invoice_id, line_no);

------------------------------------------------------------------------------
-- The next number to hand out. One counter per document type PER YEAR.
------------------------------------------------------------------------------
CREATE TABLE document_counters (
  document_type TEXT NOT NULL
                CHECK (document_type IN ('invoice','credit_note','debit_note')),
  year          INTEGER NOT NULL,
  prefix        TEXT NOT NULL,
  next_number   INTEGER NOT NULL DEFAULT 1,
  -- How many digits the number is padded to: INV-2026-001.
  -- Numbers past this simply get longer; they are never cut short.
  pad_width     INTEGER NOT NULL DEFAULT 3,
  PRIMARY KEY (document_type, year)
);
