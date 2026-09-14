-- A permanent record of every invoice number that was handed out but never
-- ended up on a document.
--
-- Issuing takes a number first, then stamps it onto the document. If the
-- second step fails, the number is spent and the series shows a gap. Gaps are
-- safe (a repeated number would not be), but in a tax audit a missing number
-- gets asked about — so each one is written down here with the time and the
-- reason, and can be shown to an inspector as a record rather than explained
-- as a quirk of the software.
--
-- This table is append-only. Like an issued invoice, it cannot be edited or
-- deleted, because a record of a gap that could be tidied away afterwards
-- would be worth nothing.

CREATE TABLE unused_invoice_numbers (
  id             TEXT PRIMARY KEY,
  document_type  TEXT NOT NULL
                 CHECK (document_type IN ('invoice','credit_note','debit_note')),
  year           INTEGER NOT NULL,
  serial         INTEGER NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  -- The draft it was meant for. That draft still exists and can be issued
  -- again; it will receive the next number, not this one.
  invoice_id     TEXT,
  allocated_by   TEXT REFERENCES users(id),
  allocated_at   TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  UNIQUE (document_type, year, serial)
);

CREATE INDEX idx_unused_numbers_when ON unused_invoice_numbers(allocated_at DESC);

CREATE TRIGGER trg_unused_numbers_no_update
BEFORE UPDATE ON unused_invoice_numbers
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'immutable: the record of a spent number cannot be changed');
END;

CREATE TRIGGER trg_unused_numbers_no_delete
BEFORE DELETE ON unused_invoice_numbers
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'immutable: the record of a spent number cannot be deleted');
END;
