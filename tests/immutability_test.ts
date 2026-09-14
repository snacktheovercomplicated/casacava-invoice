import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ALLOCATE_NUMBER_SQL as ALLOCATE } from "../src/worker/invoices.ts";

/**
 * These tests run the real migration files against a real SQLite database,
 * the same engine D1 runs. Every trigger here was also confirmed against a
 * live Cloudflare D1 instance before the schema was written.
 *
 * The point of all of this: hiding the edit button is not security. The
 * database itself has to refuse.
 */

const MIGRATIONS = [
  "db/migrations/0001_init.sql",
  "db/migrations/0002_immutability.sql",
  "db/migrations/0003_unused_numbers.sql",
];

const NOW = "2026-09-14T12:00:00.000Z";

/** Columns that MAY still be written after a document is issued. */
const ETA_COLUMNS = [
  "eta_status",
  "eta_uuid",
  "eta_submission_uuid",
  "eta_sent_payload",
  "eta_response",
  "submitted_at",
];
const CANCEL_COLUMNS = ["cancelled_by", "cancelled_at", "cancel_reason"];
const BOOKKEEPING_COLUMNS = ["updated_at"];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of MIGRATIONS) {
    db.exec(Deno.readTextFileSync(new URL(`../${file}`, import.meta.url)));
  }
  db.exec(`
    INSERT INTO users (id,email,password_verifier,password_salt,password_iters,
                       display_name,created_at,updated_at)
    VALUES ('u1','omar@casacavco.com','v','s',600,'Omar','${NOW}','${NOW}'),
           ('u2','mum@casacavco.com','v','s',600,'Mum','${NOW}','${NOW}');
    INSERT INTO company_settings (id,updated_at) VALUES (1,'${NOW}');
  `);
  return db;
}

/** A draft with one line. Most columns deliberately left NULL. */
function makeDraft(db: DatabaseSync, id = "inv1"): void {
  db.exec(`
    INSERT INTO invoices (id,doc_status,created_by,created_at,updated_at,
                          subtotal_piastres,vat_total_piastres,total_piastres)
    VALUES ('${id}','draft','u1','${NOW}','${NOW}',10000,1400,11400);
    INSERT INTO invoice_lines
      (id,invoice_id,line_no,name_ar,name_en,unit_ar,unit_en,
       unit_price_piastres,vat_rate_bp,quantity_milli,discount_type,discount_value,
       gross_piastres,discount_piastres,net_piastres,vat_piastres,total_piastres)
    VALUES ('${id}-l1','${id}',1,'نسكافيه جولد','Nescafe Gold','كجم','kg',
            10000,1400,1000,'none',0,10000,0,10000,1400,11400);
  `);
}

function issue(db: DatabaseSync, id = "inv1"): void {
  db.exec(`
    UPDATE invoices SET doc_status='issued', invoice_number='INV-2026-001',
      invoice_serial=1, invoice_year=2026, issue_date='2026-09-14',
      issued_by='u1', issued_at='${NOW}'
    WHERE id='${id}';
  `);
}

function invoiceColumns(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(invoices)").all() as Array<
    { name: string }
  >).map((r) => r.name);
}

function rowOf(db: DatabaseSync, id = "inv1"): Record<string, unknown> {
  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
}

function rejects(fn: () => void): Error | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error as Error;
  }
}

/* ========================================================================== */
/* A draft is freely editable                                                 */
/* ========================================================================== */

Deno.test("a draft can be edited, added to, and deleted", () => {
  const db = freshDb();
  makeDraft(db);

  db.exec("UPDATE invoices SET notes='a note' WHERE id='inv1'");
  db.exec("UPDATE invoice_lines SET quantity_milli=2000 WHERE id='inv1-l1'");
  db.exec(`
    INSERT INTO invoice_lines
      (id,invoice_id,line_no,name_en,unit_price_piastres,vat_rate_bp,
       quantity_milli,discount_type,discount_value,
       gross_piastres,discount_piastres,net_piastres,vat_piastres,total_piastres)
    VALUES ('inv1-l2','inv1',2,'Milk',340,1400,1000,'none',0,340,0,340,48,388);
  `);
  db.exec("DELETE FROM invoice_lines WHERE id='inv1-l2'");

  db.exec("DELETE FROM invoices WHERE id='inv1'");
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM invoice_lines").get() as { c: number }).c,
    0,
    "deleting a draft must take its lines with it",
  );
  db.close();
});

/* ========================================================================== */
/* An issued document is frozen                                               */
/* ========================================================================== */

Deno.test("EVERY frozen column on an issued invoice refuses to change", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);

  const before = rowOf(db);
  const writable = new Set([
    ...ETA_COLUMNS,
    ...CANCEL_COLUMNS,
    ...BOOKKEEPING_COLUMNS,
    "doc_status", // only via the permitted transition; tested separately
  ]);

  const alternatives: Record<string, unknown> = {
    id: "tampered",
    document_type: "credit_note",
    references_invoice_id: "inv1",
    document_language: "en",
    price_tier: "wholesale",
    invoice_number: "INV-2026-999",
    invoice_serial: 999,
    invoice_year: 2099,
    issue_date: "2099-01-01",
    customer_id: "cust-x",
    customer_name_ar: "عميل آخر",
    customer_name_en: "Someone Else",
    customer_phone: "01000000000",
    customer_address: "somewhere else",
    customer_governorate: "ALX",
    customer_type: "business",
    customer_tax_registration_number: "999-999-999",
    company_snapshot_json: '{"tampered":true}',
    subtotal_piastres: 1,
    discount_total_piastres: 500,
    vat_total_piastres: 1,
    total_piastres: 2,
    notes: "tampered",
    payment_terms: "tampered",
    created_by: "u2",
    issued_by: "u2",
    created_at: "2099-01-01T00:00:00.000Z",
    issued_at: "2099-01-01T00:00:00.000Z",
  };

  const checked: string[] = [];
  for (const column of invoiceColumns(db)) {
    if (writable.has(column)) continue;
    assert.ok(
      column in alternatives,
      `new column "${column}" has no immutability test — add one`,
    );
    const error = rejects(() => {
      const statement = db.prepare(
        `UPDATE invoices SET ${column} = ? WHERE id = 'inv1'`,
      );
      statement.run(alternatives[column] as never);
    });
    assert.ok(error, `changing ${column} on an issued invoice was ALLOWED`);
    checked.push(column);
  }

  assert.ok(checked.length >= 28, `only ${checked.length} columns were checked`);
  assert.deepEqual(rowOf(db), before, "the issued row must be byte-identical");
  db.close();
});

Deno.test("THE NULL TRAP: a column that was NULL at issue time cannot be filled later", () => {
  // This is the bug that a naive trigger written with `=` instead of `IS`
  // would have: NULL = NULL is NULL, so NOT(...) is never true, so the
  // trigger silently lets the write through.
  const db = freshDb();
  makeDraft(db);
  issue(db);

  const nullColumns = invoiceColumns(db).filter((c) => rowOf(db)[c] === null);
  const allowedToFill = new Set([...ETA_COLUMNS, ...CANCEL_COLUMNS]);

  const filled: string[] = [];
  for (const column of nullColumns) {
    if (allowedToFill.has(column)) continue;
    const error = rejects(() => {
      db.prepare(`UPDATE invoices SET ${column} = ? WHERE id = 'inv1'`).run(
        "filled-in-after-the-fact",
      );
    });
    if (!error) filled.push(column);
    else {
      assert.match(
        error.message,
        /immutable/,
        `${column} was rejected, but by a CHECK rather than the trigger`,
      );
    }
  }

  assert.deepEqual(filled, [], "these NULL columns were filled after issuing");
  assert.ok(nullColumns.length > 5, "the fixture should leave several columns NULL");
  db.close();
});

Deno.test("an issued invoice cannot be deleted, or flipped back to draft", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);

  assert.match(
    rejects(() => db.exec("DELETE FROM invoices WHERE id='inv1'"))!.message,
    /never deleted/,
  );
  assert.match(
    rejects(() => db.exec("UPDATE invoices SET doc_status='draft' WHERE id='inv1'"))!
      .message,
    /immutable/,
  );
  db.close();
});

Deno.test("the lines of an issued invoice cannot be changed, added to, or removed", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);

  assert.match(
    rejects(() =>
      db.exec("UPDATE invoice_lines SET unit_price_piastres=1 WHERE id='inv1-l1'")
    )!.message,
    /parent document is issued/,
  );
  assert.match(
    rejects(() => db.exec("UPDATE invoice_lines SET quantity_milli=9 WHERE id='inv1-l1'"))!
      .message,
    /parent document is issued/,
  );
  assert.match(
    rejects(() => db.exec("DELETE FROM invoice_lines WHERE id='inv1-l1'"))!.message,
    /parent document is issued/,
  );
  assert.match(
    rejects(() =>
      db.exec(`
        INSERT INTO invoice_lines
          (id,invoice_id,line_no,name_en,unit_price_piastres,vat_rate_bp,
           quantity_milli,discount_type,discount_value,
           gross_piastres,discount_piastres,net_piastres,vat_piastres,total_piastres)
        VALUES ('sneaky','inv1',2,'Extra',100,0,1000,'none',0,100,0,100,0,100);
      `)
    )!.message,
    /parent document is issued/,
  );

  const line = db.prepare("SELECT * FROM invoice_lines WHERE id='inv1-l1'").get() as
    Record<string, number>;
  assert.equal(line.unit_price_piastres, 10000);
  assert.equal(line.quantity_milli, 1000);
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM invoice_lines").get() as { c: number }).c,
    1,
  );
  db.close();
});

/* ========================================================================== */
/* The two things that ARE still allowed                                      */
/* ========================================================================== */

Deno.test("the tax authority columns can still be written in phase 2", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);

  db.exec(`
    UPDATE invoices SET eta_status='submitted', eta_uuid='ETA-123',
      eta_submission_uuid='SUB-9', eta_sent_payload='{}', eta_response='{}',
      submitted_at='${NOW}', updated_at='${NOW}'
    WHERE id='inv1';
  `);
  const row = rowOf(db);
  assert.equal(row.eta_status, "submitted");
  assert.equal(row.eta_uuid, "ETA-123");
  assert.equal(row.total_piastres, 11400, "the money must not have moved");
  db.close();
});

Deno.test("an issued invoice can be cancelled, once, with a reason", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);

  db.exec(`
    UPDATE invoices SET doc_status='cancelled', cancelled_by='u2',
      cancelled_at='${NOW}', cancel_reason='wrong customer', updated_at='${NOW}'
    WHERE id='inv1';
  `);
  const row = rowOf(db);
  assert.equal(row.doc_status, "cancelled");
  assert.equal(row.cancel_reason, "wrong customer");
  assert.equal(row.invoice_number, "INV-2026-001", "the number survives");
  assert.equal(row.total_piastres, 11400);
  db.close();
});

Deno.test("a cancelled invoice is frozen just as hard, and cannot be un-cancelled", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);
  db.exec(
    `UPDATE invoices SET doc_status='cancelled', cancelled_by='u1',
     cancelled_at='${NOW}', cancel_reason='x' WHERE id='inv1'`,
  );

  for (
    const sql of [
      "UPDATE invoices SET doc_status='issued' WHERE id='inv1'",
      "UPDATE invoices SET notes='x' WHERE id='inv1'",
      "UPDATE invoices SET cancel_reason='different reason' WHERE id='inv1'",
      "UPDATE invoices SET cancelled_by='u2' WHERE id='inv1'",
      "DELETE FROM invoices WHERE id='inv1'",
      "UPDATE invoice_lines SET unit_price_piastres=1 WHERE id='inv1-l1'",
    ]
  ) {
    assert.ok(rejects(() => db.exec(sql)), `should have been refused: ${sql}`);
  }
  db.close();
});

Deno.test("the cancel columns cannot be rewritten once the transition is done", () => {
  // Cancelling is a one-way door. You cannot quietly rewrite who cancelled
  // an invoice or why, a week later.
  const db = freshDb();
  makeDraft(db);
  issue(db);
  db.exec(
    `UPDATE invoices SET doc_status='cancelled', cancelled_by='u1',
     cancelled_at='${NOW}', cancel_reason='original reason' WHERE id='inv1'`,
  );
  assert.match(
    rejects(() =>
      db.exec("UPDATE invoices SET cancel_reason='rewritten' WHERE id='inv1'")
    )!.message,
    /immutable/,
  );
  assert.equal(rowOf(db).cancel_reason, "original reason");
  db.close();
});

/* ========================================================================== */
/* Corrections are new documents, never edits                                 */
/* ========================================================================== */

Deno.test("a credit note is a new row pointing at the original", () => {
  const db = freshDb();
  makeDraft(db);
  issue(db);

  db.exec(`
    INSERT INTO invoices (id,document_type,references_invoice_id,doc_status,
                          created_by,created_at,updated_at,
                          subtotal_piastres,vat_total_piastres,total_piastres)
    VALUES ('cn1','credit_note','inv1','draft','u1','${NOW}','${NOW}',10000,1400,11400);
  `);
  const note = rowOf(db, "cn1");
  assert.equal(note.references_invoice_id, "inv1");
  assert.equal(rowOf(db, "inv1").doc_status, "issued", "the original is untouched");
  db.close();
});

Deno.test("a credit note must say what it corrects, and cannot reference itself", () => {
  const db = freshDb();
  assert.ok(
    rejects(() =>
      db.exec(`
        INSERT INTO invoices (id,document_type,doc_status,created_by,created_at,updated_at)
        VALUES ('cn2','credit_note','draft','u1','${NOW}','${NOW}');
      `)
    ),
    "a credit note with no reference must be refused",
  );
  assert.ok(
    rejects(() =>
      db.exec(`
        INSERT INTO invoices (id,document_type,references_invoice_id,doc_status,
                              created_by,created_at,updated_at)
        VALUES ('cn3','credit_note','cn3','draft','u1','${NOW}','${NOW}');
      `)
    ),
    "a document referencing itself must be refused",
  );
  db.close();
});

/* ========================================================================== */
/* Invoice numbers                                                            */
/* ========================================================================== */


Deno.test("numbers are handed out in order, one series per type per year", () => {
  const db = freshDb();
  const take = (type: string, year: number, prefix: string) =>
    db.prepare(ALLOCATE).get(type, year, prefix) as
      { serial: number; invoice_number: string };

  assert.equal(take("invoice", 2026, "INV").invoice_number, "INV-2026-001");
  assert.equal(take("invoice", 2026, "INV").invoice_number, "INV-2026-002");
  assert.equal(take("invoice", 2026, "INV").invoice_number, "INV-2026-003");

  // Credit notes run their own series, from 1, in the same year.
  assert.equal(take("credit_note", 2026, "CN").invoice_number, "CN-2026-001");
  assert.equal(take("credit_note", 2026, "CN").invoice_number, "CN-2026-002");

  // The new year starts again at 1. The year is part of the number, so
  // INV-2026-001 and INV-2027-001 are different documents.
  assert.equal(take("invoice", 2027, "INV").invoice_number, "INV-2027-001");

  // and 2026 carries on undisturbed
  assert.equal(take("invoice", 2026, "INV").invoice_number, "INV-2026-004");
  db.close();
});

Deno.test("a number is never issued twice", () => {
  const db = freshDb();
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const row = db.prepare(ALLOCATE).get("invoice", 2026, "INV") as
      { invoice_number: string };
    assert.ok(!seen.has(row.invoice_number), `duplicate ${row.invoice_number}`);
    seen.add(row.invoice_number);
  }
  assert.equal(seen.size, 500);
  db.close();
});

Deno.test("the counter cannot be wound backwards", () => {
  const db = freshDb();
  db.prepare(ALLOCATE).get("invoice", 2026, "INV");
  db.prepare(ALLOCATE).get("invoice", 2026, "INV");

  for (
    const sql of [
      "UPDATE document_counters SET next_number = 1 WHERE document_type='invoice'",
      "UPDATE document_counters SET next_number = next_number WHERE document_type='invoice'",
      "UPDATE document_counters SET year = 2025 WHERE document_type='invoice'",
    ]
  ) {
    assert.match(rejects(() => db.exec(sql))!.message, /never go backwards/);
  }
  db.close();
});

Deno.test("two invoices cannot share a number", () => {
  const db = freshDb();
  makeDraft(db, "a");
  makeDraft(db, "b");
  issue(db, "a");
  assert.ok(
    rejects(() =>
      db.exec(
        `UPDATE invoices SET doc_status='issued', invoice_number='INV-2026-001',
         invoice_serial=1, invoice_year=2026, issue_date='2026-09-14',
         issued_by='u1', issued_at='${NOW}' WHERE id='b'`,
      )
    ),
    "the second invoice must not be allowed to take the same number",
  );
  db.close();
});

Deno.test("an invoice cannot be issued without a number", () => {
  const db = freshDb();
  makeDraft(db);
  assert.ok(
    rejects(() => db.exec("UPDATE invoices SET doc_status='issued' WHERE id='inv1'")),
    "issuing with no number must be refused",
  );
  db.close();
});

/* ========================================================================== */
/* Other guardrails                                                           */
/* ========================================================================== */

Deno.test("a business customer must have a tax registration number", () => {
  const db = freshDb();
  assert.ok(
    rejects(() =>
      db.exec(`
        INSERT INTO customers (id,name_ar,customer_type,created_at,updated_at)
        VALUES ('c1','شركة','business','${NOW}','${NOW}');
      `)
    ),
  );
  db.exec(`
    INSERT INTO customers (id,name_ar,customer_type,tax_registration_number,
                           created_at,updated_at)
    VALUES ('c2','شركة','business','123-456-789','${NOW}','${NOW}');
    INSERT INTO customers (id,name_ar,customer_type,created_at,updated_at)
    VALUES ('c3','فرد','individual','${NOW}','${NOW}');
  `);
  db.close();
});

Deno.test("a customer or item needs at least one name, in either language", () => {
  const db = freshDb();
  assert.ok(
    rejects(() =>
      db.exec(
        `INSERT INTO customers (id,created_at,updated_at) VALUES ('c9','${NOW}','${NOW}')`,
      )
    ),
  );
  assert.ok(
    rejects(() =>
      db.exec(
        `INSERT INTO items (id,created_at,updated_at) VALUES ('i9','${NOW}','${NOW}')`,
      )
    ),
  );
  // either one alone is fine
  db.exec(`
    INSERT INTO items (id,name_ar,created_at,updated_at) VALUES ('i1','بن','${NOW}','${NOW}');
    INSERT INTO items (id,name_en,created_at,updated_at) VALUES ('i2','Coffee','${NOW}','${NOW}');
  `);
  db.close();
});

Deno.test("the arithmetic stored on a line has to be internally consistent", () => {
  const db = freshDb();
  makeDraft(db);
  assert.ok(
    rejects(() =>
      db.exec(`
        INSERT INTO invoice_lines
          (id,invoice_id,line_no,name_en,unit_price_piastres,vat_rate_bp,
           quantity_milli,discount_type,discount_value,
           gross_piastres,discount_piastres,net_piastres,vat_piastres,total_piastres)
        VALUES ('bad','inv1',2,'X',100,0,1000,'none',0,100,0,999,0,999);
      `)
    ),
    "net must equal gross minus discount",
  );
  assert.ok(
    rejects(() =>
      db.exec(
        `INSERT INTO invoices (id,doc_status,created_by,created_at,updated_at,
         subtotal_piastres,vat_total_piastres,total_piastres)
         VALUES ('bad2','draft','u1','${NOW}','${NOW}',100,14,999)`,
      )
    ),
    "total must equal subtotal plus VAT",
  );
  db.close();
});

Deno.test("company_settings can only ever hold one row", () => {
  const db = freshDb();
  assert.ok(
    rejects(() => db.exec(`INSERT INTO company_settings (id,updated_at) VALUES (2,'${NOW}')`)),
  );
  db.close();
});

/* ========================================================================== */
/* Proving the test above is not passing by accident                          */
/* ========================================================================== */

Deno.test("MUTATION CHECK: rewriting the trigger with '=' reopens the NULL hole", () => {
  // If someone ever "tidies up" the trigger by replacing IS with =, the
  // NULL TRAP test must fail. This test deliberately builds that broken
  // version and confirms the hole is real, so the protection above cannot
  // quietly become decorative.
  const init = Deno.readTextFileSync(new URL("../db/migrations/0001_init.sql", import.meta.url));
  const good = Deno.readTextFileSync(new URL("../db/migrations/0002_immutability.sql", import.meta.url));
  const broken = good.replace(/ IS OLD\./g, " = OLD.");
  assert.notEqual(broken, good, "the replacement should have changed something");

  const build = (triggerSql: string) => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(init);
    db.exec(triggerSql);
    db.exec(`
      INSERT INTO users (id,email,password_verifier,password_salt,password_iters,
                         display_name,created_at,updated_at)
      VALUES ('u1','omar@casacavco.com','v','s',600,'Omar','${NOW}','${NOW}');
    `);
    makeDraft(db);
    issue(db);
    return db;
  };

  // The careless version lets a column that was NULL be filled in later...
  const brokenDb = build(broken);
  assert.equal(
    rejects(() =>
      brokenDb.exec("UPDATE invoices SET customer_phone='01000000000' WHERE id='inv1'")
    ),
    null,
    "expected the '=' version to be vulnerable; if this fails the check is obsolete",
  );
  brokenDb.close();

  // ...and the shipped version does not.
  const goodDb = build(good);
  assert.ok(
    rejects(() =>
      goodDb.exec("UPDATE invoices SET customer_phone='01000000000' WHERE id='inv1'")
    ),
  );
  goodDb.close();
});

Deno.test("numbers are padded to three digits, and grow rather than get cut short", () => {
  // The padding is cosmetic: INV-2026-007 reads better than INV-2026-7.
  // But padding on its own would take the LAST three characters, so invoice
  // 1000 would come out as "000" and 1001 would collide with 001 and refuse
  // to issue. This pins the boundary.
  const db = freshDb();
  const take = () =>
    (db.prepare(ALLOCATE).get("invoice", 2026, "INV") as { invoice_number: string })
      .invoice_number;

  assert.equal(take(), "INV-2026-001");
  assert.equal(take(), "INV-2026-002");

  // Jump the counter to just under the boundary.
  db.exec(
    "UPDATE document_counters SET next_number = 999 WHERE document_type='invoice' AND year=2026",
  );
  assert.equal(take(), "INV-2026-999");
  assert.equal(take(), "INV-2026-1000", "the fourth digit must appear, not wrap");
  assert.equal(take(), "INV-2026-1001");

  db.exec(
    "UPDATE document_counters SET next_number = 12345 WHERE document_type='invoice' AND year=2026",
  );
  assert.equal(take(), "INV-2026-12345");
  db.close();
});

Deno.test("every number in a long run is unique and in order", () => {
  const db = freshDb();
  db.exec(
    "INSERT INTO document_counters (document_type, year, prefix, next_number, pad_width) " +
      "VALUES ('invoice', 2026, 'INV', 995, 3)",
  );
  const seen = new Set<string>();
  let previous = 0;
  for (let i = 0; i < 30; i++) {
    const row = db.prepare(ALLOCATE).get("invoice", 2026, "INV") as
      { invoice_number: string; serial: number };
    assert.ok(!seen.has(row.invoice_number), `duplicate ${row.invoice_number}`);
    assert.ok(row.serial > previous, "serials must only ever increase");
    seen.add(row.invoice_number);
    previous = row.serial;
  }
  // Straddles 999 -> 1000 without repeating or reordering.
  assert.ok(seen.has("INV-2026-999"));
  assert.ok(seen.has("INV-2026-1000"));
  assert.equal(seen.size, 30);
  db.close();
});
