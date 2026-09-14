/**
 * Documents: drafts, issuing, cancelling, corrections, listing.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE:
 *
 * 1. The server recalculates every amount. The app may send a price and a
 *    quantity; it may not send a total. Whatever it claims the line adds up
 *    to is discarded and recomputed by src/lib/money.ts.
 *
 * 2. The customer, the company and each product are COPIED onto the document.
 *    Nothing here ever joins an issued invoice back to a live record. Prices
 *    change; issued documents do not.
 */
import {
  computeDocument,
  computeLine,
  type DiscountType,
  type LineTotals,
  MoneyError,
  resolveVatRateBp,
} from "../lib/money.ts";
import type {
  D1PreparedStatement,
  DocStatus,
  DocumentLanguage,
  DocumentType,
  Env,
  PriceTier,
  SessionUser,
} from "./types.ts";
import {
  badRequest,
  cairoToday,
  conflict,
  json,
  notFound,
  nowIso,
  readJson,
  requireEnum,
  requireInteger,
  requireString,
} from "./http.ts";

const DOCUMENT_TYPES = ["invoice", "credit_note", "debit_note"] as const;
const LANGUAGES = ["ar", "en"] as const;
const TIERS = ["retail", "wholesale"] as const;
const DISCOUNTS = ["none", "percent", "amount"] as const;

/**
 * Taking the next number, as one statement.
 *
 * It creates the year's counter if this is the first document of the year, and
 * otherwise increments it, returning the number in both cases — so two devices
 * issuing at the same instant cannot receive the same number.
 *
 * MAX(pad_width, length(...)) pads a short number to three digits without ever
 * truncating a long one: padding alone would turn invoice 1000 into "000", and
 * 1001 would then collide with 001 and refuse to issue.
 *
 * Exported so the tests exercise this exact statement rather than a copy of it.
 */
export const ALLOCATE_NUMBER_SQL = `
  INSERT INTO document_counters (document_type, year, prefix, next_number, pad_width)
  VALUES (?, ?, ?, 2, 3)
  ON CONFLICT (document_type, year) DO UPDATE SET next_number = next_number + 1
  RETURNING (next_number - 1) AS serial,
            prefix || '-' || year || '-' ||
            substr('0000000000' || (next_number - 1),
                   -MAX(pad_width, length(next_number - 1))) AS invoice_number`;

const PREFIX: Record<DocumentType, string> = {
  invoice: "INV",
  credit_note: "CN",
  debit_note: "DN",
};

interface LineInputBody {
  item_id?: string | null;
  name_ar?: string | null;
  name_en?: string | null;
  unit_ar?: string | null;
  unit_en?: string | null;
  unit_price_piastres?: number;
  vat_rate_bp?: number | null;
  quantity_milli?: number;
  discount_type?: DiscountType;
  discount_value?: number;
}

interface PreparedLine {
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
  totals: LineTotals;
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                  */
/* -------------------------------------------------------------------------- */

async function companySnapshot(env: Env): Promise<{ json: string; vatBp: number }> {
  const row = await env.DB.prepare("SELECT * FROM company_settings WHERE id = 1")
    .first<Record<string, unknown>>();
  if (!row) throw new Error("company_settings has no row; run db/seed_company.sql");
  const { updated_at: _ignored, ...rest } = row;
  return {
    json: JSON.stringify(rest),
    vatBp: Number(row.default_vat_rate_bp ?? 0),
  };
}

interface CustomerSnapshot {
  customer_id: string | null;
  customer_name_ar: string | null;
  customer_name_en: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_governorate: string | null;
  customer_type: string | null;
  customer_tax_registration_number: string | null;
}

async function customerSnapshot(
  env: Env,
  body: Record<string, unknown>,
): Promise<CustomerSnapshot> {
  const customerId = requireString(body, "customer_id", { optional: true });

  if (customerId) {
    const row = await env.DB.prepare("SELECT * FROM customers WHERE id = ?")
      .bind(customerId).first<Record<string, string | null>>();
    if (!row) throw notFound("That customer no longer exists");
    return {
      customer_id: customerId,
      customer_name_ar: row.name_ar,
      customer_name_en: row.name_en,
      customer_phone: row.phone,
      customer_address: row.address,
      customer_governorate: row.governorate,
      customer_type: row.customer_type,
      customer_tax_registration_number: row.tax_registration_number,
    };
  }

  // A walk-in with no saved record: the details are typed straight onto the
  // document and live only there.
  return {
    customer_id: null,
    customer_name_ar: requireString(body, "customer_name_ar", { optional: true }),
    customer_name_en: requireString(body, "customer_name_en", { optional: true }),
    customer_phone: requireString(body, "customer_phone", { optional: true }),
    customer_address: requireString(body, "customer_address", { optional: true }),
    customer_governorate: requireString(body, "customer_governorate", { optional: true }),
    customer_type: requireString(body, "customer_type", { optional: true }),
    customer_tax_registration_number: requireString(
      body,
      "customer_tax_registration_number",
      { optional: true },
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Lines                                                                      */
/* -------------------------------------------------------------------------- */

async function prepareLines(
  env: Env,
  rawLines: unknown,
  tier: PriceTier,
  companyVatBp: number,
): Promise<PreparedLine[]> {
  if (!Array.isArray(rawLines)) throw badRequest("lines must be a list");
  if (rawLines.length > 200) throw badRequest("a document cannot hold more than 200 lines");

  const prepared: PreparedLine[] = [];

  for (const [index, raw] of rawLines.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw badRequest(`line ${index + 1} is not an object`);
    }
    const line = raw as LineInputBody & Record<string, unknown>;
    const where = `line ${index + 1}`;

    const itemId = requireString(line, "item_id", { optional: true });
    let nameAr = requireString(line, "name_ar", { optional: true });
    let nameEn = requireString(line, "name_en", { optional: true });
    let unitAr = requireString(line, "unit_ar", { optional: true });
    let unitEn = requireString(line, "unit_en", { optional: true });
    let unitPrice = line.unit_price_piastres;
    let vatRateBp = line.vat_rate_bp;

    if (itemId) {
      const item = await env.DB.prepare("SELECT * FROM items WHERE id = ?")
        .bind(itemId).first<Record<string, string | number | null>>();
      if (!item) throw notFound(`${where}: that product no longer exists`);

      // Anything the app did not send is taken from the catalogue and frozen.
      nameAr ??= (item.name_ar as string | null) ?? null;
      nameEn ??= (item.name_en as string | null) ?? null;
      unitAr ??= (item.unit_ar as string | null) ?? null;
      unitEn ??= (item.unit_en as string | null) ?? null;
      if (unitPrice === undefined || unitPrice === null) {
        const wholesale = item.wholesale_price_piastres as number | null;
        // The wholesale toggle sets the default for every line; a line may
        // still be overridden by hand, which is why this is only a fallback.
        unitPrice = tier === "wholesale" && wholesale !== null
          ? wholesale
          : (item.unit_price_piastres as number);
      }
      if (vatRateBp === undefined || vatRateBp === null) {
        vatRateBp = resolveVatRateBp(item.vat_rate_bp as number | null, companyVatBp);
      }
    }

    if (!nameAr && !nameEn) throw badRequest(`${where} needs a description`);
    if (unitPrice === undefined || unitPrice === null) {
      throw badRequest(`${where} needs a price`);
    }
    if (vatRateBp === undefined || vatRateBp === null) vatRateBp = companyVatBp;

    const resolved = {
      unitPricePiastres: requireInteger({ v: unitPrice }, "v", { min: 0 }),
      quantityMilli: requireInteger(line, "quantity_milli", { min: 1 }),
      vatRateBp: requireInteger({ v: vatRateBp }, "v", { min: 0, max: 10000 }),
      discountType: requireEnum(line, "discount_type", DISCOUNTS, "none"),
      discountValue: requireInteger(line, "discount_value", { min: 0, fallback: 0 }),
    };

    let totals: LineTotals;
    try {
      // Whatever the app thinks this line comes to, THIS is the answer.
      totals = computeLine(resolved);
    } catch (error) {
      if (error instanceof MoneyError) throw badRequest(`${where}: ${error.message}`);
      throw error;
    }

    prepared.push({
      item_id: itemId,
      name_ar: nameAr,
      name_en: nameEn,
      unit_ar: unitAr,
      unit_en: unitEn,
      unit_price_piastres: resolved.unitPricePiastres,
      vat_rate_bp: resolved.vatRateBp,
      quantity_milli: resolved.quantityMilli,
      discount_type: resolved.discountType,
      discount_value: resolved.discountValue,
      totals,
    });
  }

  return prepared;
}

/* -------------------------------------------------------------------------- */
/* Saving a draft                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create or replace a draft. The id comes from the device, so a draft written
 * on a phone with no signal keeps the same identity when it syncs later.
 */
export async function saveDraft(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const existing = await env.DB.prepare(
    "SELECT doc_status, created_by, created_at FROM invoices WHERE id = ?",
  ).bind(id).first<{ doc_status: DocStatus; created_by: string; created_at: string }>();

  if (existing && existing.doc_status !== "draft") {
    throw conflict(
      "This document has already been issued and can no longer be edited. " +
        "Corrections are made with a credit note.",
      "not_a_draft",
    );
  }

  const documentType = requireEnum(body, "document_type", DOCUMENT_TYPES, "invoice");
  const referencesId = requireString(body, "references_invoice_id", { optional: true });
  if (documentType !== "invoice" && !referencesId) {
    throw badRequest("A credit or debit note must say which invoice it corrects");
  }
  if (referencesId === id) throw badRequest("A document cannot reference itself");

  const company = await companySnapshot(env);
  const language = requireEnum(body, "document_language", LANGUAGES, "ar");
  const tier = requireEnum(body, "price_tier", TIERS, "retail");
  const customer = await customerSnapshot(env, body);
  const lines = await prepareLines(env, body.lines ?? [], tier, company.vatBp);
  const totals = computeDocument(lines.map((line) => line.totals));

  const now = nowIso();
  const statements: D1PreparedStatement[] = [];

  statements.push(
    env.DB.prepare(
      `INSERT INTO invoices (
         id, document_type, references_invoice_id, doc_status, document_language,
         price_tier, customer_id, customer_name_ar, customer_name_en,
         customer_phone, customer_address, customer_governorate, customer_type,
         customer_tax_registration_number, company_snapshot_json,
         subtotal_piastres, discount_total_piastres, vat_total_piastres,
         total_piastres, notes, payment_terms, created_by, created_at, updated_at)
       VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET
         document_type = excluded.document_type,
         references_invoice_id = excluded.references_invoice_id,
         document_language = excluded.document_language,
         price_tier = excluded.price_tier,
         customer_id = excluded.customer_id,
         customer_name_ar = excluded.customer_name_ar,
         customer_name_en = excluded.customer_name_en,
         customer_phone = excluded.customer_phone,
         customer_address = excluded.customer_address,
         customer_governorate = excluded.customer_governorate,
         customer_type = excluded.customer_type,
         customer_tax_registration_number = excluded.customer_tax_registration_number,
         company_snapshot_json = excluded.company_snapshot_json,
         subtotal_piastres = excluded.subtotal_piastres,
         discount_total_piastres = excluded.discount_total_piastres,
         vat_total_piastres = excluded.vat_total_piastres,
         total_piastres = excluded.total_piastres,
         notes = excluded.notes,
         payment_terms = excluded.payment_terms,
         updated_at = excluded.updated_at`,
    ).bind(
      id, documentType, referencesId, language, tier,
      customer.customer_id, customer.customer_name_ar, customer.customer_name_en,
      customer.customer_phone, customer.customer_address, customer.customer_governorate,
      customer.customer_type, customer.customer_tax_registration_number, company.json,
      totals.subtotalPiastres, totals.discountTotalPiastres, totals.vatTotalPiastres,
      totals.totalPiastres,
      requireString(body, "notes", { optional: true, maxLength: 5000 }),
      requireString(body, "payment_terms", { optional: true, maxLength: 1000 }),
      existing?.created_by ?? user.id,
      existing?.created_at ?? now,
      now,
    ),
  );

  statements.push(
    env.DB.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(id),
  );

  lines.forEach((line, index) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO invoice_lines (
           id, invoice_id, line_no, item_id, name_ar, name_en, unit_ar, unit_en,
           unit_price_piastres, vat_rate_bp, quantity_milli,
           discount_type, discount_value,
           gross_piastres, discount_piastres, net_piastres, vat_piastres,
           total_piastres)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        `${id}-${index + 1}`, id, index + 1, line.item_id,
        line.name_ar, line.name_en, line.unit_ar, line.unit_en,
        line.unit_price_piastres, line.vat_rate_bp, line.quantity_milli,
        line.discount_type, line.discount_value,
        line.totals.grossPiastres, line.totals.discountPiastres,
        line.totals.netPiastres, line.totals.vatPiastres, line.totals.totalPiastres,
      ),
    );
  });

  await env.DB.batch(statements);
  return await getInvoice(env, id);
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Take the next number and freeze the document.
 *
 * This is deliberately a server call and nothing else: a number handed out on
 * a device with no signal would eventually collide with one handed out on the
 * other device. The app must refuse to offer this button while offline.
 *
 * If the number is allocated and the update that follows fails, the number is
 * spent and the series shows a gap. That is the correct trade: a gap is a
 * harmless irregularity, a repeated invoice number is a serious one.
 */
export async function issueInvoice(
  env: Env,
  user: SessionUser,
  id: string,
): Promise<Response> {
  const invoice = await env.DB.prepare(
    "SELECT doc_status, document_type FROM invoices WHERE id = ?",
  ).bind(id).first<{ doc_status: DocStatus; document_type: DocumentType }>();

  if (!invoice) throw notFound("That document does not exist");
  if (invoice.doc_status === "issued") {
    throw conflict("This document has already been issued", "already_issued");
  }
  if (invoice.doc_status !== "draft") {
    throw conflict("Only a draft can be issued", "not_a_draft");
  }

  const lineCount = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM invoice_lines WHERE invoice_id = ?",
  ).bind(id).first<{ c: number }>();
  if (!lineCount || lineCount.c === 0) {
    throw badRequest("A document with no lines cannot be issued");
  }

  const { date, year } = cairoToday();
  const prefix = PREFIX[invoice.document_type];

  const allocated = await env.DB.prepare(ALLOCATE_NUMBER_SQL)
    .bind(invoice.document_type, year, prefix).first<
    { serial: number; invoice_number: string }
  >();

  if (!allocated) throw new Error("the invoice number could not be allocated");

  const now = nowIso();

  try {
    const stamped = await env.DB.prepare(
      `UPDATE invoices
       SET doc_status = 'issued', invoice_number = ?, invoice_serial = ?,
           invoice_year = ?, issue_date = ?, issued_by = ?, issued_at = ?, updated_at = ?
       WHERE id = ? AND doc_status = 'draft'`,
    ).bind(
      allocated.invoice_number, allocated.serial, year, date, user.id, now, now, id,
    ).run();

    // Nothing changed means the draft moved out from under us between the two
    // steps — someone else issued it, or deleted it. The number is gone either way.
    if (stamped.meta.changes === 0) {
      throw new Error(
        "the draft was issued or deleted by someone else while this number was being taken",
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordUnusedNumber(env, {
      documentType: invoice.document_type,
      year,
      serial: allocated.serial,
      invoiceNumber: allocated.invoice_number,
      invoiceId: id,
      userId: user.id,
      allocatedAt: now,
      reason,
    });
    throw conflict(
      `Number ${allocated.invoice_number} could not be put on the document, so it has ` +
        `been written down as unused with the time and the reason. The draft is ` +
        `unchanged and can be issued again — it will take the next number.`,
      "issue_failed",
    );
  }

  return await getInvoice(env, id);
}

/**
 * Write down a number that was handed out but never landed on a document.
 *
 * This must never throw: it runs while another error is already being handled,
 * and losing the original failure would be worse than losing the record. If it
 * cannot write, it says so in the log and the gap still shows up as
 * "unexplained" in the report below, because that half is computed rather than
 * recorded.
 */
async function recordUnusedNumber(env: Env, entry: {
  documentType: DocumentType;
  year: number;
  serial: number;
  invoiceNumber: string;
  invoiceId: string | null;
  userId: string | null;
  allocatedAt: string;
  reason: string;
}): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO unused_invoice_numbers
         (id, document_type, year, serial, invoice_number, invoice_id,
          allocated_by, allocated_at, failure_reason)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (invoice_number) DO NOTHING`,
    ).bind(
      crypto.randomUUID(), entry.documentType, entry.year, entry.serial,
      entry.invoiceNumber, entry.invoiceId, entry.userId, entry.allocatedAt,
      entry.reason.slice(0, 500),
    ).run();
  } catch (error) {
    console.error(
      `could not record unused number ${entry.invoiceNumber}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Every number in the series that is not on a document.
 *
 * Two lists, deliberately:
 *
 *  - `recorded` is what the software wrote down at the moment it happened,
 *    with a timestamp and a reason. This is the list to show an inspector.
 *  - `unexplained` is computed fresh by walking the series and looking for
 *    numbers that are neither on a document nor in the recorded list. It
 *    exists so that a gap still surfaces even if the recording itself failed,
 *    or if a number went missing some other way. It should normally be empty.
 */
export async function listUnusedNumbers(env: Env): Promise<Response> {
  const recorded = await env.DB.prepare(
    `SELECT u.*, users.display_name AS allocated_by_name
     FROM unused_invoice_numbers u
     LEFT JOIN users ON users.id = u.allocated_by
     ORDER BY u.allocated_at DESC`,
  ).all<Record<string, unknown>>();

  const unexplained = await env.DB.prepare(
    `WITH RECURSIVE seq(document_type, year, serial, max_serial) AS (
       SELECT document_type, year, 1, next_number - 1
       FROM document_counters WHERE next_number > 1
       UNION ALL
       SELECT document_type, year, serial + 1, max_serial
       FROM seq WHERE serial < max_serial AND serial < 100000
     )
     SELECT s.document_type, s.year, s.serial,
            c.prefix || '-' || s.year || '-' ||
              substr('0000000000' || s.serial, -c.pad_width) AS invoice_number
     FROM seq s
     JOIN document_counters c
       ON c.document_type = s.document_type AND c.year = s.year
     LEFT JOIN invoices i
       ON i.document_type = s.document_type
      AND i.invoice_year = s.year
      AND i.invoice_serial = s.serial
     LEFT JOIN unused_invoice_numbers u
       ON u.document_type = s.document_type
      AND u.year = s.year
      AND u.serial = s.serial
     WHERE i.id IS NULL AND u.id IS NULL
     ORDER BY s.document_type, s.year, s.serial
     LIMIT 500`,
  ).all<Record<string, unknown>>();

  return json({
    recorded: recorded.results,
    unexplained: unexplained.results,
    total: recorded.results.length + unexplained.results.length,
  });
}

export async function cancelInvoice(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const reason = requireString(body, "reason", { maxLength: 500 });

  const invoice = await env.DB.prepare("SELECT doc_status FROM invoices WHERE id = ?")
    .bind(id).first<{ doc_status: DocStatus }>();
  if (!invoice) throw notFound("That document does not exist");
  if (invoice.doc_status === "cancelled") {
    throw conflict("This document is already cancelled", "already_cancelled");
  }
  if (invoice.doc_status !== "issued") {
    throw conflict("Only an issued document can be cancelled; delete a draft instead");
  }

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE invoices
     SET doc_status = 'cancelled', cancelled_by = ?, cancelled_at = ?,
         cancel_reason = ?, updated_at = ?
     WHERE id = ? AND doc_status = 'issued'`,
  ).bind(user.id, now, reason, now, id).run();

  return await getInvoice(env, id);
}

/** A correction is a new document. The original is never touched. */
export async function createCreditNote(
  request: Request,
  env: Env,
  user: SessionUser,
  originalId: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const newId = requireString(body, "id") ?? crypto.randomUUID();
  const documentType = requireEnum(body, "document_type", ["credit_note", "debit_note"] as const, "credit_note");

  const original = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?")
    .bind(originalId).first<Record<string, unknown>>();
  if (!original) throw notFound("The document being corrected does not exist");
  if (original.doc_status === "draft") {
    throw badRequest("A draft has not been issued yet; edit it instead of correcting it");
  }

  const lines = await env.DB.prepare(
    "SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no",
  ).bind(originalId).all<Record<string, unknown>>();

  const payload = {
    document_type: documentType,
    references_invoice_id: originalId,
    document_language: original.document_language,
    price_tier: original.price_tier,
    customer_id: original.customer_id,
    customer_name_ar: original.customer_name_ar,
    customer_name_en: original.customer_name_en,
    customer_phone: original.customer_phone,
    customer_address: original.customer_address,
    customer_governorate: original.customer_governorate,
    customer_type: original.customer_type,
    customer_tax_registration_number: original.customer_tax_registration_number,
    notes: body.notes ?? null,
    payment_terms: original.payment_terms,
    // The lines start as a copy of the original; the user edits the draft down
    // to whatever is actually being credited before issuing it.
    lines: lines.results.map((line) => ({
      item_id: line.item_id,
      name_ar: line.name_ar,
      name_en: line.name_en,
      unit_ar: line.unit_ar,
      unit_en: line.unit_en,
      unit_price_piastres: line.unit_price_piastres,
      vat_rate_bp: line.vat_rate_bp,
      quantity_milli: line.quantity_milli,
      discount_type: line.discount_type,
      discount_value: line.discount_value,
    })),
  };

  const synthetic = new Request("https://internal/", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await saveDraft(synthetic, env, user, newId);
}

export async function deleteDraft(env: Env, id: string): Promise<Response> {
  const invoice = await env.DB.prepare("SELECT doc_status FROM invoices WHERE id = ?")
    .bind(id).first<{ doc_status: DocStatus }>();
  if (!invoice) throw notFound("That document does not exist");
  if (invoice.doc_status !== "draft") {
    throw conflict("An issued document is never deleted. Cancel it instead.", "not_a_draft");
  }
  await env.DB.prepare("DELETE FROM invoices WHERE id = ?").bind(id).run();
  return json({ ok: true, id });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export async function getInvoice(env: Env, id: string): Promise<Response> {
  const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?")
    .bind(id).first<Record<string, unknown>>();
  if (!invoice) throw notFound("That document does not exist");

  const lines = await env.DB.prepare(
    "SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no",
  ).bind(id).all<Record<string, unknown>>();

  const company = invoice.company_snapshot_json
    ? JSON.parse(invoice.company_snapshot_json as string)
    : null;

  // A credit note has to say which invoice it corrects in a form the customer
  // recognises — the printed number, not our internal id.
  let referencesNumber: string | null = null;
  if (invoice.references_invoice_id) {
    const referenced = await env.DB.prepare(
      "SELECT invoice_number FROM invoices WHERE id = ?",
    ).bind(invoice.references_invoice_id).first<{ invoice_number: string | null }>();
    referencesNumber = referenced?.invoice_number ?? null;
  }

  return json({
    invoice: {
      ...invoice,
      company_snapshot: company,
      references_invoice_number: referencesNumber,
    },
    lines: lines.results,
  });
}

/**
 * The list view: filter by status and date, search by number or customer name
 * in either language.
 */
export async function listInvoices(url: URL, env: Env): Promise<Response> {
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const type = url.searchParams.get("type");
  const query = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const where: string[] = [];
  const binds: unknown[] = [];

  if (status && ["draft", "issued", "cancelled"].includes(status)) {
    where.push("doc_status = ?");
    binds.push(status);
  }
  if (type && DOCUMENT_TYPES.includes(type as DocumentType)) {
    where.push("document_type = ?");
    binds.push(type);
  }
  // Drafts have no issue date, so a date filter is about issued documents.
  if (from) {
    where.push("issue_date >= ?");
    binds.push(from);
  }
  if (to) {
    where.push("issue_date <= ?");
    binds.push(to);
  }
  if (query) {
    // One search box, both languages. Arabic has no letter case; LIKE is
    // already case-insensitive for the English side.
    where.push(
      "(invoice_number LIKE ? OR customer_name_ar LIKE ? OR customer_name_en LIKE ?)",
    );
    const pattern = `%${query}%`;
    binds.push(pattern, pattern, pattern);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT id, document_type, doc_status, eta_status, document_language, price_tier,
            invoice_number, invoice_serial, invoice_year, issue_date,
            customer_name_ar, customer_name_en, customer_phone,
            subtotal_piastres, vat_total_piastres, total_piastres,
            created_at, updated_at, issued_at, cancelled_at, references_invoice_id
     FROM invoices ${clause}
     ORDER BY COALESCE(issue_date, substr(created_at, 1, 10)) DESC,
              invoice_serial DESC, created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all<Record<string, unknown>>();

  const counted = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM invoices ${clause}`,
  ).bind(...binds).first<{ total: number }>();

  return json({
    invoices: rows.results,
    total: counted?.total ?? 0,
    limit,
    offset,
  });
}
