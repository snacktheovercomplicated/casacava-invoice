/** Products, customers and the company settings row. */
import type { Env } from "./types.ts";
import {
  badRequest,
  json,
  notFound,
  nowIso,
  readJson,
  requireEnum,
  requireInteger,
  requireString,
} from "./http.ts";

const LANGUAGES = ["ar", "en"] as const;
const CUSTOMER_TYPES = ["business", "individual"] as const;

/* -------------------------------------------------------------------------- */
/* Company settings                                                           */
/* -------------------------------------------------------------------------- */

export async function getSettings(env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM company_settings WHERE id = 1")
    .first<Record<string, unknown>>();
  if (!row) throw notFound("Company settings have not been set up yet");
  return json({ settings: row });
}

const SETTINGS_TEXT_FIELDS = [
  "legal_name_ar", "legal_name_en", "trade_name_ar", "trade_name_en",
  "tax_registration_number", "commercial_register_number",
  "address_ar", "address_en", "phone", "email", "logo_data_url",
  "payment_terms_ar", "payment_terms_en", "footer_note_ar", "footer_note_en",
  "terms_ar", "terms_en",
] as const;

export async function updateSettings(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const assignments: string[] = [];
  const binds: unknown[] = [];

  for (const field of SETTINGS_TEXT_FIELDS) {
    if (!(field in body)) continue;
    // The logo is a data URI and is the one field that may legitimately be big.
    const maxLength = field === "logo_data_url" ? 500_000 : 2000;
    assignments.push(`${field} = ?`);
    binds.push(requireString(body, field, { optional: true, maxLength }));
  }

  if ("default_vat_rate_bp" in body) {
    // This single number is the VAT switch for the whole catalogue.
    assignments.push("default_vat_rate_bp = ?");
    binds.push(requireInteger(body, "default_vat_rate_bp", { min: 0, max: 10000 }));
  }
  if ("default_document_language" in body) {
    assignments.push("default_document_language = ?");
    binds.push(requireEnum(body, "default_document_language", LANGUAGES));
  }

  if (assignments.length === 0) throw badRequest("Nothing to change");

  assignments.push("updated_at = ?");
  binds.push(nowIso());

  await env.DB.prepare(
    `UPDATE company_settings SET ${assignments.join(", ")} WHERE id = 1`,
  ).bind(...binds).run();

  return await getSettings(env);
}

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

export async function listItems(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim();
  const includeInactive = url.searchParams.get("all") === "1";

  const where: string[] = [];
  const binds: unknown[] = [];
  if (!includeInactive) where.push("is_active = 1");
  if (query) {
    // Searching one box finds a product by either of its names.
    where.push("(name_ar LIKE ? OR name_en LIKE ? OR category_ar LIKE ? OR category_en LIKE ?)");
    const pattern = `%${query}%`;
    binds.push(pattern, pattern, pattern, pattern);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT * FROM items ${clause} ORDER BY sort_order, COALESCE(name_ar, name_en)`,
  ).bind(...binds).all<Record<string, unknown>>();

  return json({ items: rows.results });
}

function itemFields(body: Record<string, unknown>) {
  const nameAr = requireString(body, "name_ar", { optional: true, maxLength: 300 });
  const nameEn = requireString(body, "name_en", { optional: true, maxLength: 300 });
  if (!nameAr && !nameEn) throw badRequest("A product needs a name in at least one language");

  return {
    name_ar: nameAr,
    name_en: nameEn,
    category_ar: requireString(body, "category_ar", { optional: true, maxLength: 200 }),
    category_en: requireString(body, "category_en", { optional: true, maxLength: 200 }),
    unit_price_piastres: requireInteger(body, "unit_price_piastres", { min: 0, fallback: 0 }),
    wholesale_price_piastres: body.wholesale_price_piastres === null ||
        body.wholesale_price_piastres === undefined
      ? null
      : requireInteger(body, "wholesale_price_piastres", { min: 0 }),
    unit_ar: requireString(body, "unit_ar", { optional: true, maxLength: 50 }),
    unit_en: requireString(body, "unit_en", { optional: true, maxLength: 50 }),
    // null means "follow the company default", which is the normal case.
    vat_rate_bp: body.vat_rate_bp === null || body.vat_rate_bp === undefined
      ? null
      : requireInteger(body, "vat_rate_bp", { min: 0, max: 10000 }),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
    sort_order: requireInteger(body, "sort_order", { min: 0, fallback: 0 }),
  };
}

export async function upsertItem(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const fields = itemFields(body);
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO items (id, name_ar, name_en, category_ar, category_en,
       unit_price_piastres, wholesale_price_piastres, unit_ar, unit_en,
       vat_rate_bp, is_active, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       name_ar = excluded.name_ar, name_en = excluded.name_en,
       category_ar = excluded.category_ar, category_en = excluded.category_en,
       unit_price_piastres = excluded.unit_price_piastres,
       wholesale_price_piastres = excluded.wholesale_price_piastres,
       unit_ar = excluded.unit_ar, unit_en = excluded.unit_en,
       vat_rate_bp = excluded.vat_rate_bp, is_active = excluded.is_active,
       sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
  ).bind(
    id, fields.name_ar, fields.name_en, fields.category_ar, fields.category_en,
    fields.unit_price_piastres, fields.wholesale_price_piastres,
    fields.unit_ar, fields.unit_en, fields.vat_rate_bp, fields.is_active,
    fields.sort_order, now, now,
  ).run();

  const row = await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id)
    .first<Record<string, unknown>>();
  return json({ item: row });
}

/**
 * Products are never deleted, only deactivated: an issued invoice may still
 * point at one, and its history has to stay readable.
 */
export async function deactivateItem(env: Env, id: string): Promise<Response> {
  const result = await env.DB.prepare(
    "UPDATE items SET is_active = 0, updated_at = ? WHERE id = ?",
  ).bind(nowIso(), id).run();
  if (result.meta.changes === 0) throw notFound("That product does not exist");
  return json({ ok: true, id, is_active: 0 });
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

export async function listCustomers(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim();
  const includeInactive = url.searchParams.get("all") === "1";

  const where: string[] = [];
  const binds: unknown[] = [];
  if (!includeInactive) where.push("is_active = 1");
  if (query) {
    where.push("(name_ar LIKE ? OR name_en LIKE ? OR phone LIKE ?)");
    const pattern = `%${query}%`;
    binds.push(pattern, pattern, pattern);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT * FROM customers ${clause} ORDER BY COALESCE(name_ar, name_en)`,
  ).bind(...binds).all<Record<string, unknown>>();

  return json({ customers: rows.results });
}

export async function upsertCustomer(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const nameAr = requireString(body, "name_ar", { optional: true, maxLength: 300 });
  const nameEn = requireString(body, "name_en", { optional: true, maxLength: 300 });
  if (!nameAr && !nameEn) throw badRequest("A customer needs a name in at least one language");

  const customerType = requireEnum(body, "customer_type", CUSTOMER_TYPES, "individual");
  const taxNumber = requireString(body, "tax_registration_number", {
    optional: true,
    maxLength: 50,
  });
  // The database enforces this too; catching it here gives a readable message.
  if (customerType === "business" && !taxNumber) {
    throw badRequest("A business customer must have a tax registration number");
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO customers (id, name_ar, name_en, phone, address, governorate,
       customer_type, tax_registration_number, preferred_document_language,
       is_active, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       name_ar = excluded.name_ar, name_en = excluded.name_en,
       phone = excluded.phone, address = excluded.address,
       governorate = excluded.governorate, customer_type = excluded.customer_type,
       tax_registration_number = excluded.tax_registration_number,
       preferred_document_language = excluded.preferred_document_language,
       is_active = excluded.is_active, notes = excluded.notes,
       updated_at = excluded.updated_at`,
  ).bind(
    id, nameAr, nameEn,
    requireString(body, "phone", { optional: true, maxLength: 50 }),
    requireString(body, "address", { optional: true, maxLength: 1000 }),
    requireString(body, "governorate", { optional: true, maxLength: 10 }),
    customerType, taxNumber,
    requireEnum(body, "preferred_document_language", LANGUAGES, "ar"),
    body.is_active === false || body.is_active === 0 ? 0 : 1,
    requireString(body, "notes", { optional: true, maxLength: 2000 }),
    now, now,
  ).run();

  const row = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id)
    .first<Record<string, unknown>>();
  return json({ customer: row });
}

export async function deactivateCustomer(env: Env, id: string): Promise<Response> {
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM invoices WHERE customer_id = ?",
  ).bind(id).first<{ c: number }>();

  if (used && used.c > 0) {
    const result = await env.DB.prepare(
      "UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), id).run();
    if (result.meta.changes === 0) throw notFound("That customer does not exist");
    return json({ ok: true, id, is_active: 0, kept: "has documents" });
  }

  const result = await env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) throw notFound("That customer does not exist");
  return json({ ok: true, id, deleted: true });
}
