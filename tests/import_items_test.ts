import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseCsv, toActive, toBasisPoints, toPiastres } from "../tools/import_items.ts";

function generate(csvPath: string): string {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "tools/import_items.ts", csvPath],
    cwd: new URL("..", import.meta.url).pathname,
  });
  const { code, stdout, stderr } = command.outputSync();
  assert.equal(code, 0, new TextDecoder().decode(stderr));
  return new TextDecoder().decode(stdout);
}

function dbWithSchema(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(Deno.readTextFileSync(new URL("../db/migrations/0001_init.sql", import.meta.url)));
  db.exec(Deno.readTextFileSync(new URL("../db/migrations/0002_immutability.sql", import.meta.url)));
  return db;
}

Deno.test("prices convert from EGP to whole piastres", () => {
  assert.equal(toPiastres("1080", "x"), 108000);
  assert.equal(toPiastres("1,080.50", "x"), 108050);
  assert.equal(toPiastres("0.05", "x"), 5);
  assert.equal(toPiastres("EGP 240.00", "x"), 24000);
  assert.equal(toPiastres("١٠٨٠", "x"), 108000);
  assert.equal(toPiastres("", "x"), null);
  assert.throws(() => toPiastres("1.234", "x"));
});

Deno.test("VAT reads as a percentage or a fraction", () => {
  assert.equal(toBasisPoints("14"), 1400);
  assert.equal(toBasisPoints("14%"), 1400);
  assert.equal(toBasisPoints("0.14"), 1400);
  assert.equal(toBasisPoints("0"), 0);
  assert.equal(toBasisPoints(""), null, "blank must mean 'follow the company default'");
});

Deno.test("an item counts as active unless the CSV clearly says otherwise", () => {
  assert.equal(toActive(""), 1);
  assert.equal(toActive("1"), 1);
  assert.equal(toActive("publish"), 1);
  assert.equal(toActive("0"), 0);
  assert.equal(toActive("no"), 0);
  assert.equal(toActive("out of stock"), 0);
});

Deno.test("the CSV reader copes with quotes, commas and newlines inside a field", () => {
  const rows = parseCsv('a,b\n"one, two","line\nbreak"\n"say ""hi""",x\n');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["one, two", "line\nbreak"],
    ['say "hi"', "x"],
  ]);
});

Deno.test("the 23 seeded products load into the real schema", () => {
  const db = dbWithSchema();
  db.exec(generate("db/seed_items.csv"));

  const count = (db.prepare("SELECT COUNT(*) c FROM items").get() as { c: number }).c;
  assert.equal(count, 23);

  const gold = db.prepare(
    "SELECT * FROM items WHERE name_en LIKE 'Nescafe Gold Coarse%'",
  ).get() as Record<string, unknown>;
  assert.equal(gold.unit_price_piastres, 108000, "1080.00 EGP");
  assert.equal(gold.wholesale_price_piastres, 90000, "900.00 EGP");
  assert.equal(gold.unit_ar, "كجم");
  assert.equal(gold.unit_en, "kg");
  assert.equal(gold.vat_rate_bp, null, "blank VAT must inherit the company default");
  assert.equal(gold.is_active, 1);
  assert.equal(gold.egs_code, null, "phase 2");
  assert.equal(gold.gpc_code, null, "phase 2");

  // every item kept both names and both prices
  const incomplete = (db.prepare(
    `SELECT COUNT(*) c FROM items
     WHERE name_ar IS NULL OR name_en IS NULL OR wholesale_price_piastres IS NULL`,
  ).get() as { c: number }).c;
  assert.equal(incomplete, 0);

  // wholesale is never above retail
  const wrong = (db.prepare(
    "SELECT COUNT(*) c FROM items WHERE wholesale_price_piastres > unit_price_piastres",
  ).get() as { c: number }).c;
  assert.equal(wrong, 0);
  db.close();
});

Deno.test("re-importing updates prices instead of duplicating products", () => {
  const db = dbWithSchema();
  const sql = generate("db/seed_items.csv");
  db.exec(sql);
  db.exec(sql);
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM items").get() as { c: number }).c,
    23,
    "importing twice must not double the catalogue",
  );
  db.close();
});

Deno.test("a differently-shaped export still imports, via COLUMN_MAP", () => {
  // What a storefront export tends to look like: different headings,
  // different order, a currency symbol, a status word, a missing Arabic name.
  const temp = Deno.makeTempFileSync({ suffix: ".csv" });
  Deno.writeTextFileSync(
    temp,
    "Status,Product Name,Regular price,Sale price,Categories,Tax rate,UOM\n" +
      'publish,"Nescafe Gold, Coarse","EGP 1,080.00",900,Nescafe,14,kg\n' +
      "draft,Tamarind,100,80,Cold Drinks,,kg\n",
  );

  const db = dbWithSchema();
  db.exec(generate(temp));

  const rows = db.prepare("SELECT * FROM items ORDER BY sort_order").all() as
    Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);

  assert.equal(rows[0].name_en, "Nescafe Gold, Coarse", "a quoted comma survived");
  assert.equal(rows[0].name_ar, null, "no Arabic name in this export, and that is allowed");
  assert.equal(rows[0].unit_price_piastres, 108000);
  assert.equal(rows[0].wholesale_price_piastres, 90000);
  assert.equal(rows[0].vat_rate_bp, 1400, "an explicit 14 overrides the company default");
  assert.equal(rows[0].category_en, "Nescafe");
  assert.equal(rows[0].unit_en, "kg");
  assert.equal(rows[0].is_active, 1);

  assert.equal(rows[1].name_en, "Tamarind");
  assert.equal(rows[1].is_active, 0, "'draft' must import as inactive");
  assert.equal(rows[1].vat_rate_bp, null);

  db.close();
  Deno.removeSync(temp);
});

Deno.test("a CSV with no recognisable price column fails loudly", () => {
  const temp = Deno.makeTempFileSync({ suffix: ".csv" });
  Deno.writeTextFileSync(temp, "Thing,Cost in pounds\nCoffee,100\n");
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "tools/import_items.ts", temp],
    cwd: new URL("..", import.meta.url).pathname,
  });
  const { code, stderr } = command.outputSync();
  assert.notEqual(code, 0, "it must refuse rather than import an empty catalogue");
  assert.match(new TextDecoder().decode(stderr), /COLUMN_MAP/);
  Deno.removeSync(temp);
});
