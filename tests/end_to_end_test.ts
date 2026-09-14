import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ALLOCATE_NUMBER_SQL as ALLOCATE } from "../src/worker/invoices.ts";
import { computeDocument, computeLine, resolveVatRateBp } from "../src/lib/money.ts";
import { amountInArabicWords } from "../src/lib/words_ar.ts";
import { amountInEnglishWords } from "../src/lib/words_en.ts";

/**
 * One real order, start to finish: real products out of the importer, the
 * money module doing the arithmetic, the database accepting the result, the
 * invoice being issued and then refusing to change.
 *
 * The value of this test is that it crosses the seams. If money.ts and the
 * schema ever disagreed about units, the CHECK constraints would reject the
 * rows here even though every module's own tests still passed.
 */

const NOW = "2026-09-14T12:00:00.000Z";

function setup(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of ["0001_init.sql", "0002_immutability.sql", "0003_unused_numbers.sql"]) {
    db.exec(Deno.readTextFileSync(new URL(`../db/migrations/${file}`, import.meta.url)));
  }
  db.exec(`
    INSERT INTO users (id,email,password_verifier,password_salt,password_iters,
                       display_name,created_at,updated_at)
    VALUES ('u1','omar@casacavco.com','v','s',600,'Omar','${NOW}','${NOW}');
    INSERT INTO company_settings (id,trade_name_ar,trade_name_en,
                                  default_vat_rate_bp,updated_at)
    VALUES (1,'كازا كافا','Casa Cava',0,'${NOW}');
  `);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "tools/import_items.ts", "db/seed_items.csv"],
    cwd: new URL("..", import.meta.url).pathname,
  });
  const { code, stdout } = command.outputSync();
  assert.equal(code, 0);
  db.exec(new TextDecoder().decode(stdout));
  return db;
}


Deno.test("a whole wholesale order, from catalogue to issued invoice", () => {
  const db = setup();

  const companyVat = (db.prepare(
    "SELECT default_vat_rate_bp v FROM company_settings WHERE id=1",
  ).get() as { v: number }).v;
  assert.equal(companyVat, 0, "not VAT-registered today");

  // Mum picks three products and the wholesale tier.
  const picks = [
    { like: "Nescafe Gold Coarse%", quantityMilli: 5000 }, // 5 kg
    { like: "Full Cream Milk Powder (New Zealand)%", quantityMilli: 2500 }, // 2.5 kg
    { like: "Tamarind%", quantityMilli: 1250 }, // 1.25 kg
  ];

  const lines = picks.map((pick, index) => {
    const item = db.prepare(
      "SELECT * FROM items WHERE name_en LIKE ? AND is_active = 1",
    ).get(pick.like) as Record<string, number | string | null>;
    assert.ok(item, `missing product for ${pick.like}`);

    // Wholesale tier sets the default price for every line.
    const unitPricePiastres = item.wholesale_price_piastres as number;
    const vatRateBp = resolveVatRateBp(item.vat_rate_bp as number | null, companyVat);

    const totals = computeLine({
      unitPricePiastres,
      quantityMilli: pick.quantityMilli,
      vatRateBp,
      discountType: index === 0 ? "percent" : "none",
      discountValue: index === 0 ? 500 : 0, // 5% off the coffee
    });
    return { item, unitPricePiastres, vatRateBp, totals, pick, index };
  });

  const document = computeDocument(lines.map((l) => l.totals));

  // 5 kg at 900.00 less 5% = 4275.00; 2.5 kg at 280.00 = 700.00;
  // 1.25 kg at 80.00 = 100.00. No VAT yet.
  assert.equal(lines[0].totals.grossPiastres, 450_000);
  assert.equal(lines[0].totals.discountPiastres, 22_500);
  assert.equal(lines[0].totals.netPiastres, 427_500);
  assert.equal(lines[1].totals.netPiastres, 70_000);
  assert.equal(lines[2].totals.netPiastres, 10_000);
  assert.equal(document.subtotalPiastres, 507_500);
  assert.equal(document.vatTotalPiastres, 0);
  assert.equal(document.totalPiastres, 507_500);

  // Save it as a draft. The database's CHECK constraints are the referee:
  // if money.ts and the schema disagreed about units, this would throw.
  db.exec(`
    INSERT INTO invoices (id,document_type,doc_status,document_language,price_tier,
                          customer_name_ar,customer_name_en,customer_phone,
                          customer_governorate,customer_type,
                          subtotal_piastres,discount_total_piastres,
                          vat_total_piastres,total_piastres,
                          created_by,created_at,updated_at)
    VALUES ('ord1','invoice','draft','ar','wholesale',
            'محل الأمل للبقالة','Al Amal Grocery','01001234567','CAI','individual',
            ${document.subtotalPiastres},${document.discountTotalPiastres},
            ${document.vatTotalPiastres},${document.totalPiastres},
            'u1','${NOW}','${NOW}');
  `);

  const insertLine = db.prepare(`
    INSERT INTO invoice_lines
      (id,invoice_id,line_no,item_id,name_ar,name_en,unit_ar,unit_en,
       unit_price_piastres,vat_rate_bp,quantity_milli,discount_type,discount_value,
       gross_piastres,discount_piastres,net_piastres,vat_piastres,total_piastres)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const line of lines) {
    insertLine.run(
      `ord1-l${line.index + 1}`, "ord1", line.index + 1, line.item.id as string,
      line.item.name_ar as string, line.item.name_en as string,
      line.item.unit_ar as string, line.item.unit_en as string,
      line.unitPricePiastres, line.vatRateBp, line.pick.quantityMilli,
      line.index === 0 ? "percent" : "none", line.index === 0 ? 500 : 0,
      line.totals.grossPiastres, line.totals.discountPiastres,
      line.totals.netPiastres, line.totals.vatPiastres, line.totals.totalPiastres,
    );
  }

  // The stored lines must add back up to the stored document totals.
  const summed = db.prepare(`
    SELECT SUM(net_piastres) net, SUM(vat_piastres) vat, SUM(total_piastres) total
    FROM invoice_lines WHERE invoice_id='ord1'
  `).get() as { net: number; vat: number; total: number };
  const stored = db.prepare(
    "SELECT subtotal_piastres s, vat_total_piastres v, total_piastres t FROM invoices WHERE id='ord1'",
  ).get() as { s: number; v: number; t: number };
  assert.equal(summed.net, stored.s);
  assert.equal(summed.vat, stored.v);
  assert.equal(summed.total, stored.t);

  // Issue it: take a number, then freeze.
  const allocated = db.prepare(ALLOCATE).get("invoice", 2026, "INV") as
    { serial: number; invoice_number: string };
  assert.equal(allocated.invoice_number, "INV-2026-001");

  db.prepare(`
    UPDATE invoices SET doc_status='issued', invoice_number=?, invoice_serial=?,
      invoice_year=2026, issue_date='2026-09-14', issued_by='u1', issued_at=?,
      updated_at=? WHERE id='ord1'
  `).run(allocated.invoice_number, allocated.serial, NOW, NOW);

  // The words that print under the total, in the document's own language.
  assert.equal(
    amountInArabicWords(stored.t),
    "فقط خمسة آلاف وخمسة وسبعون جنيهاً لا غير",
  );
  assert.equal(
    amountInEnglishWords(stored.t),
    "Five Thousand Seventy Five Egyptian Pounds only",
  );

  // And now it is frozen.
  assert.throws(() =>
    db.exec("UPDATE invoices SET total_piastres=1 WHERE id='ord1'")
  );
  assert.throws(() =>
    db.exec("UPDATE invoice_lines SET quantity_milli=1 WHERE id='ord1-l1'")
  );
  assert.throws(() => db.exec("DELETE FROM invoices WHERE id='ord1'"));

  // A later price rise must not reach back into the issued invoice.
  db.exec("UPDATE items SET wholesale_price_piastres = 99999 WHERE id LIKE 'nescafe-gold-coarse%'");
  const frozen = db.prepare(
    "SELECT unit_price_piastres p FROM invoice_lines WHERE id='ord1-l1'",
  ).get() as { p: number };
  assert.equal(frozen.p, 90_000, "the issued line keeps the price it was issued at");

  db.close();
});

Deno.test("switching the company to 14% changes new invoices, never old ones", () => {
  const db = setup();

  const item = db.prepare("SELECT * FROM items WHERE name_en LIKE 'Tamarind%'").get() as
    Record<string, number | null>;
  assert.equal(item.vat_rate_bp, null, "this item inherits");

  const before = computeLine({
    unitPricePiastres: item.unit_price_piastres as number,
    quantityMilli: 1000,
    vatRateBp: resolveVatRateBp(item.vat_rate_bp as number | null, 0),
    discountType: "none",
    discountValue: 0,
  });
  assert.equal(before.vatPiastres, 0);
  assert.equal(before.totalPiastres, 10_000);

  // The day Casa Cava registers: one row changes.
  db.exec("UPDATE company_settings SET default_vat_rate_bp = 1400 WHERE id = 1");
  const companyVat = (db.prepare(
    "SELECT default_vat_rate_bp v FROM company_settings WHERE id=1",
  ).get() as { v: number }).v;

  const after = computeLine({
    unitPricePiastres: item.unit_price_piastres as number,
    quantityMilli: 1000,
    vatRateBp: resolveVatRateBp(item.vat_rate_bp as number | null, companyVat),
    discountType: "none",
    discountValue: 0,
  });
  assert.equal(after.vatPiastres, 1_400);
  assert.equal(after.totalPiastres, 11_400);

  // No item row had to be touched for that to happen.
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM items WHERE vat_rate_bp IS NOT NULL")
      .get() as { c: number }).c,
    0,
  );
  db.close();
});
