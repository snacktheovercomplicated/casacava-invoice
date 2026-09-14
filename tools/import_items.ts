/**
 * Import a product CSV into the items table.
 *
 * Usage:
 *   deno run --allow-read tools/import_items.ts db/seed_items.csv > items.sql
 *   npx wrangler d1 execute casacava-invoice --remote --file=items.sql
 *
 * ---------------------------------------------------------------------------
 * IF YOUR CSV HAS DIFFERENT COLUMN NAMES, CHANGE ONLY THE BLOCK BELOW.
 * Nothing else in this file needs to be touched.
 *
 * The left-hand name is the database field. The right-hand list is the
 * column headings to look for in the CSV, tried in order, case-insensitive
 * and ignoring spaces and underscores. Put your storefront's heading first.
 * ---------------------------------------------------------------------------
 */
const COLUMN_MAP: Record<string, string[]> = {
  name_ar: ["name_ar", "arabic name", "الاسم", "اسم المنتج", "product name ar"],
  name_en: ["name_en", "english name", "name", "title", "product name"],
  category_ar: ["category_ar", "التصنيف", "القسم", "category ar"],
  category_en: ["category_en", "category", "categories", "product category"],
  unit_price_egp: ["unit_price_egp", "price", "regular price", "retail", "سعر"],
  wholesale_price_egp: ["wholesale_price_egp", "wholesale", "wholesale price", "sale price", "جملة"],
  unit_ar: ["unit_ar", "الوحدة"],
  unit_en: ["unit_en", "unit", "uom"],
  vat_rate_percent: ["vat_rate_percent", "vat", "tax", "tax rate"],
  egs_code: ["egs_code", "egs"],
  gpc_code: ["gpc_code", "gpc"],
  active: ["active", "is_active", "published", "status", "in stock"],
};

/** Everything below here is machinery. */

function normaliseHeading(text: string): string {
  return text.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** A CSV reader that copes with quoted fields, embedded commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const body = text.replace(/^﻿/, ""); // strip a BOM if Excel added one

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (inQuotes) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function sqlString(value: string | null): string {
  if (value === null || value.trim() === "") return "NULL";
  return "'" + value.trim().replace(/'/g, "''") + "'";
}

/** "1,080.50" or "١٠٨٠" -> 108050 piastres. Blank -> null. */
function toPiastres(text: string, context: string): number | null {
  const cleaned = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "")
    .trim();
  if (cleaned === "") return null;

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new Error(`${context}: "${text}" is not a price`);
  const [, sign, whole = "", fraction = ""] = match;
  if (fraction.length > 2) {
    throw new Error(`${context}: "${text}" has more than two decimal places`);
  }
  const piastres = Number((whole || "0") + fraction.padEnd(2, "0"));
  return sign === "-" ? -piastres : piastres;
}

/** "14" or "14%" or "0.14" -> 1400 basis points. Blank -> null (inherit). */
function toBasisPoints(text: string): number | null {
  const cleaned = text.replace("%", "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`"${text}" is not a VAT rate`);
  // 0.14 means 14%; 14 means 14%.
  const percent = value > 0 && value < 1 ? value * 100 : value;
  return Math.round(percent * 100);
}

function toActive(text: string): number {
  const value = text.trim().toLowerCase();
  if (value === "") return 1;
  return ["0", "no", "false", "draft", "inactive", "out of stock", "private"]
      .includes(value)
    ? 0
    : 1;
}

/** A stable id derived from the name, so re-importing updates rather than duplicates. */
function slugify(nameEn: string, nameAr: string, index: number): string {
  const base = (nameEn || nameAr || "").toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base ? `${base}-${index + 1}` : `item-${index + 1}`;
}

function main(): void {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: deno run --allow-read tools/import_items.ts <file.csv>");
    Deno.exit(1);
  }

  const rows = parseCsv(Deno.readTextFileSync(path));
  if (rows.length < 2) throw new Error("the CSV has no data rows");

  const headings = rows[0].map(normaliseHeading);

  // Work out which CSV column feeds each database field.
  const columnIndex: Record<string, number> = {};
  const unmapped: string[] = [];
  for (const [field, candidates] of Object.entries(COLUMN_MAP)) {
    const found = candidates
      .map((candidate) => headings.indexOf(normaliseHeading(candidate)))
      .find((index) => index >= 0);
    if (found === undefined) unmapped.push(field);
    else columnIndex[field] = found;
  }

  if (columnIndex.name_ar === undefined && columnIndex.name_en === undefined) {
    throw new Error(
      "no name column found. Headings seen: " + rows[0].join(", ") +
        "\nEdit COLUMN_MAP at the top of this file.",
    );
  }
  if (columnIndex.unit_price_egp === undefined) {
    throw new Error(
      "no price column found. Headings seen: " + rows[0].join(", ") +
        "\nEdit COLUMN_MAP at the top of this file.",
    );
  }

  const cell = (row: string[], field: string): string => {
    const index = columnIndex[field];
    return index === undefined ? "" : (row[index] ?? "");
  };

  const statements: string[] = [];
  const seenIds = new Set<string>();

  rows.slice(1).forEach((row, index) => {
    const nameAr = cell(row, "name_ar").trim();
    const nameEn = cell(row, "name_en").trim();
    if (!nameAr && !nameEn) return; // blank line

    let id = slugify(nameEn, nameAr, index);
    while (seenIds.has(id)) id += "x";
    seenIds.add(id);

    const where = `row ${index + 2}`;
    const price = toPiastres(cell(row, "unit_price_egp"), where) ?? 0;
    const wholesale = toPiastres(cell(row, "wholesale_price_egp"), where);
    const vat = toBasisPoints(cell(row, "vat_rate_percent"));

    statements.push(
      `INSERT INTO items (id, name_ar, name_en, category_ar, category_en,\n` +
        `  unit_price_piastres, wholesale_price_piastres, unit_ar, unit_en,\n` +
        `  vat_rate_bp, is_active, egs_code, gpc_code, sort_order,\n` +
        `  created_at, updated_at)\n` +
        `VALUES (${sqlString(id)}, ${sqlString(nameAr)}, ${sqlString(nameEn)},\n` +
        `  ${sqlString(cell(row, "category_ar"))}, ${sqlString(cell(row, "category_en"))},\n` +
        `  ${price}, ${wholesale === null ? "NULL" : wholesale},\n` +
        `  ${sqlString(cell(row, "unit_ar"))}, ${sqlString(cell(row, "unit_en"))},\n` +
        `  ${vat === null ? "NULL" : vat}, ${toActive(cell(row, "active"))},\n` +
        `  ${sqlString(cell(row, "egs_code"))}, ${sqlString(cell(row, "gpc_code"))}, ${index},\n` +
        `  datetime('now'), datetime('now'))\n` +
        `ON CONFLICT (id) DO UPDATE SET\n` +
        `  name_ar = excluded.name_ar, name_en = excluded.name_en,\n` +
        `  category_ar = excluded.category_ar, category_en = excluded.category_en,\n` +
        `  unit_price_piastres = excluded.unit_price_piastres,\n` +
        `  wholesale_price_piastres = excluded.wholesale_price_piastres,\n` +
        `  unit_ar = excluded.unit_ar, unit_en = excluded.unit_en,\n` +
        `  vat_rate_bp = excluded.vat_rate_bp, is_active = excluded.is_active,\n` +
        `  sort_order = excluded.sort_order, updated_at = datetime('now');`,
    );
  });

  console.log("-- Generated by tools/import_items.ts from " + path);
  console.log("-- " + statements.length + " items.");
  console.log(
    "-- VAT: a blank vat_rate_bp means the item follows " +
      "company_settings.default_vat_rate_bp.",
  );
  if (unmapped.length > 0) {
    console.log("-- No CSV column matched: " + unmapped.join(", ") + " (left empty).");
  }
  console.log();
  console.log(statements.join("\n\n"));

  console.error(
    `${statements.length} items ready.` +
      (unmapped.length ? `  Unmapped fields: ${unmapped.join(", ")}` : ""),
  );
}

if (import.meta.main) main();

export { COLUMN_MAP, parseCsv, toActive, toBasisPoints, toPiastres };
