-- Immutability. This is the database refusing to let an issued document change,
-- regardless of what the API or the app does.
--
-- Once an invoice leaves 'draft', the ONLY writes that survive are:
--   (a) issued -> cancelled, together with cancelled_at / cancelled_by /
--       cancel_reason
--   (b) the six phase-2 ETA columns, plus updated_at
-- Everything else is compared with SQLite's NULL-safe `IS`. Using `=` would
-- silently permit filling in any column that happened to be NULL at issue
-- time, because `NULL = NULL` is NULL, not true, and `NOT NULL` is not false.

CREATE TRIGGER trg_invoice_no_update_unless_draft
BEFORE UPDATE ON invoices
FOR EACH ROW
WHEN OLD.doc_status <> 'draft' AND NOT (
      NEW.id                      IS OLD.id
  AND NEW.document_type           IS OLD.document_type
  AND NEW.references_invoice_id   IS OLD.references_invoice_id
  AND NEW.document_language       IS OLD.document_language
  AND NEW.price_tier              IS OLD.price_tier
  AND NEW.invoice_number          IS OLD.invoice_number
  AND NEW.invoice_serial          IS OLD.invoice_serial
  AND NEW.invoice_year            IS OLD.invoice_year
  AND NEW.issue_date              IS OLD.issue_date
  AND NEW.customer_id             IS OLD.customer_id
  AND NEW.customer_name_ar        IS OLD.customer_name_ar
  AND NEW.customer_name_en        IS OLD.customer_name_en
  AND NEW.customer_phone          IS OLD.customer_phone
  AND NEW.customer_address        IS OLD.customer_address
  AND NEW.customer_governorate    IS OLD.customer_governorate
  AND NEW.customer_type           IS OLD.customer_type
  AND NEW.customer_tax_registration_number IS OLD.customer_tax_registration_number
  AND NEW.company_snapshot_json   IS OLD.company_snapshot_json
  AND NEW.subtotal_piastres       IS OLD.subtotal_piastres
  AND NEW.discount_total_piastres IS OLD.discount_total_piastres
  AND NEW.vat_total_piastres      IS OLD.vat_total_piastres
  AND NEW.total_piastres          IS OLD.total_piastres
  AND NEW.notes                   IS OLD.notes
  AND NEW.payment_terms           IS OLD.payment_terms
  AND NEW.created_by              IS OLD.created_by
  AND NEW.issued_by               IS OLD.issued_by
  AND NEW.created_at              IS OLD.created_at
  AND NEW.issued_at               IS OLD.issued_at
  AND (
        -- no status change: the cancel columns are frozen too
        (    NEW.doc_status    IS OLD.doc_status
         AND NEW.cancelled_by  IS OLD.cancelled_by
         AND NEW.cancelled_at  IS OLD.cancelled_at
         AND NEW.cancel_reason IS OLD.cancel_reason)
        -- or the one permitted transition, which may set them
     OR (OLD.doc_status = 'issued' AND NEW.doc_status = 'cancelled')
      )
)
BEGIN
  SELECT RAISE(ABORT, 'immutable: this document is issued and cannot be edited');
END;

CREATE TRIGGER trg_invoice_no_delete_unless_draft
BEFORE DELETE ON invoices
FOR EACH ROW
WHEN OLD.doc_status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'immutable: issued documents are never deleted');
END;

-- Lines: the parent's status decides. The subquery is the whole point —
-- without it, a line could be rewritten while its invoice sat frozen.
CREATE TRIGGER trg_line_no_insert_unless_draft
BEFORE INSERT ON invoice_lines
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM invoices
             WHERE id = NEW.invoice_id AND doc_status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'immutable: parent document is issued and cannot be edited');
END;

CREATE TRIGGER trg_line_no_update_unless_draft
BEFORE UPDATE ON invoice_lines
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM invoices
             WHERE id = OLD.invoice_id AND doc_status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'immutable: parent document is issued and cannot be edited');
END;

CREATE TRIGGER trg_line_no_delete_unless_draft
BEFORE DELETE ON invoice_lines
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM invoices
             WHERE id = OLD.invoice_id AND doc_status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'immutable: parent document is issued and cannot be edited');
END;

-- A number, once handed out, is never handed out again and never walks
-- backwards. The counter only ever increases.
CREATE TRIGGER trg_counter_only_increases
BEFORE UPDATE ON document_counters
FOR EACH ROW
WHEN NEW.next_number <= OLD.next_number
  OR NEW.document_type IS NOT OLD.document_type
  OR NEW.year          IS NOT OLD.year
BEGIN
  SELECT RAISE(ABORT, 'invoice numbers never go backwards');
END;
