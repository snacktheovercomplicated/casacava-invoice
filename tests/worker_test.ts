import assert from "node:assert/strict";
import worker from "../src/worker/index.ts";
import { createTestEnv, seedItems, seedUser, type TestEnv } from "./support/fake_d1.ts";
import { deriveClientSecret } from "../src/lib/password.ts";
import { cairoToday } from "../src/worker/http.ts";

const EMAIL = "omar@casacavco.com";
const PASSWORD = "a long enough passphrase";

interface CallResult {
  status: number;
  headers: Headers;
  body: any;
}

async function call(
  env: TestEnv,
  method: string,
  path: string,
  options: {
    body?: unknown;
    token?: string;
    cookie?: string;
    origin?: string;
  } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.cookie) headers["cookie"] = options.cookie;
  if (options.origin) headers["origin"] = options.origin;

  const response = await worker.fetch(
    new Request(`https://casacava-invoice.workers.dev${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
  );
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

async function signedIn(env: TestEnv): Promise<string> {
  await seedUser(env, EMAIL, PASSWORD, "Omar");
  const result = await call(env, "POST", "/api/auth/login", {
    body: { email: EMAIL, clientSecret: await deriveClientSecret(PASSWORD, EMAIL) },
  });
  assert.equal(result.status, 200);
  return result.body.token;
}

async function ready(): Promise<{ env: TestEnv; token: string }> {
  const env = createTestEnv();
  seedItems(env);
  return { env, token: await signedIn(env) };
}

function itemId(env: TestEnv, like: string): string {
  return (env.raw.prepare("SELECT id FROM items WHERE name_en LIKE ?").get(like) as
    { id: string }).id;
}

/* ========================================================================== */
/* Signing in                                                                 */
/* ========================================================================== */

Deno.test("health needs no login", async () => {
  const env = createTestEnv();
  assert.equal((await call(env, "GET", "/api/health")).status, 200);
});

Deno.test("everything else refuses an anonymous caller", async () => {
  const env = createTestEnv();
  for (const path of ["/api/items", "/api/customers", "/api/invoices", "/api/settings"]) {
    assert.equal((await call(env, "GET", path)).status, 401, path);
  }
});

Deno.test("a wrong password and an unknown address give the same answer", async () => {
  const env = createTestEnv();
  await seedUser(env, EMAIL, PASSWORD);

  const wrongPassword = await call(env, "POST", "/api/auth/login", {
    body: { email: EMAIL, clientSecret: await deriveClientSecret("not it", EMAIL) },
  });
  const unknownEmail = await call(env, "POST", "/api/auth/login", {
    body: { email: "nobody@x.com", clientSecret: await deriveClientSecret(PASSWORD, "nobody@x.com") },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(
    wrongPassword.body.error.message,
    unknownEmail.body.error.message,
    "the reply must not reveal which addresses exist",
  );
});

Deno.test("a cookie and a bearer token both work, which is what the packaged apps need", async () => {
  const env = createTestEnv();
  await seedUser(env, EMAIL, PASSWORD, "Omar");
  const login = await call(env, "POST", "/api/auth/login", {
    body: { email: EMAIL, clientSecret: await deriveClientSecret(PASSWORD, EMAIL) },
  });

  const setCookie = login.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /cc_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);

  // the browser way
  const viaCookie = await call(env, "GET", "/api/auth/me", {
    cookie: setCookie.split(";")[0],
  });
  assert.equal(viaCookie.status, 200);
  assert.equal(viaCookie.body.user.email, EMAIL);

  // the Tauri way
  const viaBearer = await call(env, "GET", "/api/auth/me", { token: login.body.token });
  assert.equal(viaBearer.status, 200);
  assert.equal(viaBearer.body.user.display_name, "Omar");
});

Deno.test("logging out kills the session", async () => {
  const env = createTestEnv();
  const token = await signedIn(env);
  assert.equal((await call(env, "POST", "/api/auth/logout", { token })).status, 200);
  assert.equal((await call(env, "GET", "/api/auth/me", { token })).status, 401);
});

Deno.test("the session token is not stored in a replayable form", async () => {
  const env = createTestEnv();
  const token = await signedIn(env);
  const stored = env.raw.prepare("SELECT token_hash FROM sessions").get() as
    { token_hash: string };
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.token_hash.length, 64);
});

/* ========================================================================== */
/* Drafts                                                                     */
/* ========================================================================== */

Deno.test("the server calculates the money; the app does not get a vote", async () => {
  const { env, token } = await ready();

  const saved = await call(env, "PUT", "/api/invoices/draft-1", {
    token,
    body: {
      document_language: "ar",
      customer_name_ar: "محل الأمل",
      lines: [
        {
          name_ar: "بن", name_en: "Coffee",
          unit_price_piastres: 10000, quantity_milli: 1500,
          vat_rate_bp: 1400, discount_type: "none", discount_value: 0,
          // Nonsense the app might send. It is ignored entirely.
          total_piastres: 1, net_piastres: 1, vat_piastres: 1,
        },
      ],
    },
  });

  assert.equal(saved.status, 200);
  const line = saved.body.lines[0];
  assert.equal(line.gross_piastres, 15000); // 100.00 x 1.5
  assert.equal(line.net_piastres, 15000);
  assert.equal(line.vat_piastres, 2100); // 14%
  assert.equal(line.total_piastres, 17100);
  assert.equal(saved.body.invoice.subtotal_piastres, 15000);
  assert.equal(saved.body.invoice.vat_total_piastres, 2100);
  assert.equal(saved.body.invoice.total_piastres, 17100);
});

Deno.test("picking a product copies its details onto the line", async () => {
  const { env, token } = await ready();
  const id = itemId(env, "Nescafe Gold Coarse%");

  const saved = await call(env, "PUT", "/api/invoices/draft-2", {
    token,
    body: { customer_name_ar: "عميل", lines: [{ item_id: id, quantity_milli: 2000 }] },
  });

  const line = saved.body.lines[0];
  assert.equal(line.name_ar, "نسكافيه جولد خشن إسباني");
  assert.equal(line.name_en, "Nescafe Gold Coarse (Spanish)");
  assert.equal(line.unit_ar, "كجم");
  assert.equal(line.unit_price_piastres, 108000, "retail by default");
  assert.equal(line.vat_rate_bp, 0, "the item inherits the company's 0%");
  assert.equal(line.gross_piastres, 216000);
});

Deno.test("the wholesale toggle sets every line, and a line can still be overridden", async () => {
  const { env, token } = await ready();
  const id = itemId(env, "Nescafe Gold Coarse%");

  const wholesale = await call(env, "PUT", "/api/invoices/draft-3", {
    token,
    body: {
      price_tier: "wholesale",
      customer_name_ar: "تاجر",
      lines: [
        { item_id: id, quantity_milli: 1000 },
        { item_id: id, quantity_milli: 1000, unit_price_piastres: 85000 },
      ],
    },
  });

  assert.equal(wholesale.body.lines[0].unit_price_piastres, 90000, "wholesale price");
  assert.equal(wholesale.body.lines[1].unit_price_piastres, 85000, "hand-typed override");
  assert.equal(wholesale.body.invoice.price_tier, "wholesale");
});

Deno.test("a draft made on a device keeps its own id when it syncs", async () => {
  // This is the offline path: the phone invents the id, writes the draft
  // locally, and sends the same id when the signal comes back.
  const { env, token } = await ready();
  const deviceId = "01J8Z9QK7M2N4P6R8T0V2X4Y6A";

  const first = await call(env, "PUT", `/api/invoices/${deviceId}`, {
    token,
    body: { customer_name_ar: "عميل", lines: [{ name_ar: "بن", unit_price_piastres: 100, quantity_milli: 1000 }] },
  });
  assert.equal(first.status, 200);

  // Same id again: it updates, it does not make a second document.
  const second = await call(env, "PUT", `/api/invoices/${deviceId}`, {
    token,
    body: { customer_name_ar: "عميل", lines: [{ name_ar: "بن", unit_price_piastres: 200, quantity_milli: 1000 }] },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.invoice.total_piastres, 200);

  const list = await call(env, "GET", "/api/invoices", { token });
  assert.equal(list.body.total, 1);
});

Deno.test("a draft can be deleted freely", async () => {
  const { env, token } = await ready();
  await call(env, "PUT", "/api/invoices/d9", {
    token,
    body: { customer_name_ar: "x", lines: [{ name_ar: "y", unit_price_piastres: 100, quantity_milli: 1000 }] },
  });
  assert.equal((await call(env, "DELETE", "/api/invoices/d9", { token })).status, 200);
  assert.equal((await call(env, "GET", "/api/invoices/d9", { token })).status, 404);
});

/* ========================================================================== */
/* Issuing                                                                    */
/* ========================================================================== */

async function draftAndIssue(env: TestEnv, token: string, id = "inv-a") {
  await call(env, "PUT", `/api/invoices/${id}`, {
    token,
    body: {
      customer_name_ar: "محل الأمل للبقالة",
      customer_name_en: "Al Amal Grocery",
      lines: [{ name_ar: "بن", name_en: "Coffee", unit_price_piastres: 10000, quantity_milli: 1000 }],
    },
  });
  return await call(env, "POST", `/api/invoices/${id}/issue`, { token });
}

Deno.test("issuing takes the next number and records who did it", async () => {
  const { env, token } = await ready();
  const issued = await draftAndIssue(env, token);

  assert.equal(issued.status, 200);
  const invoice = issued.body.invoice;
  assert.equal(invoice.doc_status, "issued");
  assert.equal(invoice.invoice_number, `INV-${cairoToday().year}-001`);
  assert.equal(invoice.invoice_serial, 1);
  assert.equal(invoice.issue_date, cairoToday().date);
  assert.ok(invoice.issued_by, "the document records which user issued it");
  assert.equal(invoice.eta_status, null, "phase 2 stays empty");
});

Deno.test("numbers run in order and never repeat", async () => {
  const { env, token } = await ready();
  const numbers: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const issued = await draftAndIssue(env, token, `inv-${i}`);
    numbers.push(issued.body.invoice.invoice_number);
  }
  const year = cairoToday().year;
  assert.deepEqual(numbers, [
    `INV-${year}-001`, `INV-${year}-002`, `INV-${year}-003`,
    `INV-${year}-004`, `INV-${year}-005`,
  ]);
  assert.equal(new Set(numbers).size, 5);
});

Deno.test("a document with no lines cannot be issued", async () => {
  const { env, token } = await ready();
  await call(env, "PUT", "/api/invoices/empty", {
    token,
    body: { customer_name_ar: "عميل", lines: [] },
  });
  const issued = await call(env, "POST", "/api/invoices/empty/issue", { token });
  assert.equal(issued.status, 400);
});

Deno.test("issuing twice is refused and does not burn a second number", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "once");
  const again = await call(env, "POST", "/api/invoices/once/issue", { token });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, "already_issued");

  const counter = env.raw.prepare(
    "SELECT next_number FROM document_counters WHERE document_type='invoice'",
  ).get() as { next_number: number };
  assert.equal(counter.next_number, 2, "the refused attempt must not consume a number");
});

/* ========================================================================== */
/* Immutability, through the API                                              */
/* ========================================================================== */

Deno.test("an issued document cannot be edited through the API", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "frozen");

  const edit = await call(env, "PUT", "/api/invoices/frozen", {
    token,
    body: {
      customer_name_ar: "someone else",
      lines: [{ name_ar: "بن", unit_price_piastres: 1, quantity_milli: 1000 }],
    },
  });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.error.code, "not_a_draft");

  const after = await call(env, "GET", "/api/invoices/frozen", { token });
  assert.equal(after.body.invoice.customer_name_ar, "محل الأمل للبقالة");
  assert.equal(after.body.lines[0].unit_price_piastres, 10000);
});

Deno.test("an issued document cannot be deleted", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "keep");
  const deleted = await call(env, "DELETE", "/api/invoices/keep", { token });
  assert.equal(deleted.status, 409);
  assert.equal((await call(env, "GET", "/api/invoices/keep", { token })).status, 200);
});

Deno.test("a later price change does not reach back into an issued invoice", async () => {
  const { env, token } = await ready();
  const id = itemId(env, "Tamarind%");

  await call(env, "PUT", "/api/invoices/hist", {
    token,
    body: { customer_name_ar: "عميل", lines: [{ item_id: id, quantity_milli: 1000 }] },
  });
  await call(env, "POST", "/api/invoices/hist/issue", { token });

  // The price goes up tomorrow.
  const raised = await call(env, "PUT", `/api/items/${id}`, {
    token,
    body: { name_ar: "تمر هندي", name_en: "Tamarind", unit_price_piastres: 20000 },
  });
  assert.equal(raised.status, 200);
  assert.equal(raised.body.item.unit_price_piastres, 20000);

  const invoice = await call(env, "GET", "/api/invoices/hist", { token });
  assert.equal(invoice.body.lines[0].unit_price_piastres, 10000, "yesterday's price stands");
  assert.equal(invoice.body.invoice.total_piastres, 10000);
});

Deno.test("cancelling is allowed once, with a reason, and keeps the number", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "oops");

  const cancelled = await call(env, "POST", "/api/invoices/oops/cancel", {
    token,
    body: { reason: "wrong customer" },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.invoice.doc_status, "cancelled");
  assert.equal(cancelled.body.invoice.cancel_reason, "wrong customer");
  assert.equal(cancelled.body.invoice.invoice_number, `INV-${cairoToday().year}-001`);
  assert.ok(cancelled.body.invoice.cancelled_by);

  const again = await call(env, "POST", "/api/invoices/oops/cancel", {
    token,
    body: { reason: "again" },
  });
  assert.equal(again.status, 409);
});

Deno.test("a credit note is a new draft pointing at the original", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "orig");

  const note = await call(env, "POST", "/api/invoices/orig/credit-note", {
    token,
    body: { id: "cn-1", notes: "returned one bag" },
  });

  assert.equal(note.status, 200);
  assert.equal(note.body.invoice.document_type, "credit_note");
  assert.equal(note.body.invoice.references_invoice_id, "orig");
  assert.equal(note.body.invoice.doc_status, "draft", "editable until issued");
  assert.equal(note.body.lines.length, 1, "starts as a copy of the original");

  // The original is untouched.
  const original = await call(env, "GET", "/api/invoices/orig", { token });
  assert.equal(original.body.invoice.doc_status, "issued");

  // And it gets its own series.
  const issued = await call(env, "POST", "/api/invoices/cn-1/issue", { token });
  assert.equal(issued.body.invoice.invoice_number, `CN-${cairoToday().year}-001`);
});

/* ========================================================================== */
/* The list view                                                              */
/* ========================================================================== */

Deno.test("the list filters by status and date, and searches both languages", async () => {
  const { env, token } = await ready();

  await call(env, "PUT", "/api/invoices/one", {
    token,
    body: {
      customer_name_ar: "محل الأمل للبقالة", customer_name_en: "Al Amal Grocery",
      lines: [{ name_ar: "بن", unit_price_piastres: 10000, quantity_milli: 1000 }],
    },
  });
  await call(env, "POST", "/api/invoices/one/issue", { token });

  await call(env, "PUT", "/api/invoices/two", {
    token,
    body: {
      customer_name_ar: "سوبر ماركت النور", customer_name_en: "Al Nour Supermarket",
      lines: [{ name_ar: "لبن", unit_price_piastres: 5000, quantity_milli: 1000 }],
    },
  });

  const all = await call(env, "GET", "/api/invoices", { token });
  assert.equal(all.body.total, 2);

  const drafts = await call(env, "GET", "/api/invoices?status=draft", { token });
  assert.equal(drafts.body.total, 1);
  assert.equal(drafts.body.invoices[0].id, "two");

  const issued = await call(env, "GET", "/api/invoices?status=issued", { token });
  assert.equal(issued.body.total, 1);
  assert.equal(issued.body.invoices[0].id, "one");

  // Arabic search
  const arabic = await call(env, "GET", "/api/invoices?q=" + encodeURIComponent("النور"), { token });
  assert.equal(arabic.body.total, 1);
  assert.equal(arabic.body.invoices[0].id, "two");

  // English search, different case
  const english = await call(env, "GET", "/api/invoices?q=al%20amal", { token });
  assert.equal(english.body.total, 1);
  assert.equal(english.body.invoices[0].id, "one");

  // By invoice number
  const byNumber = await call(env, "GET", `/api/invoices?q=${cairoToday().year}-001`, { token });
  assert.equal(byNumber.body.total, 1);

  // Date range covering today
  const today = cairoToday().date;
  const inRange = await call(env, "GET", `/api/invoices?from=${today}&to=${today}`, { token });
  assert.equal(inRange.body.total, 1, "only the issued one has an issue date");
  const noRange = await call(env, "GET", "/api/invoices?from=2000-01-01&to=2000-01-02", { token });
  assert.equal(noRange.body.total, 0);
});

/* ========================================================================== */
/* Catalogue                                                                  */
/* ========================================================================== */

Deno.test("products are deactivated, never deleted", async () => {
  const { env, token } = await ready();
  const id = itemId(env, "Tamarind%");

  assert.equal((await call(env, "DELETE", `/api/items/${id}`, { token })).status, 200);

  const active = await call(env, "GET", "/api/items", { token });
  assert.equal(active.body.items.some((i: any) => i.id === id), false);

  const all = await call(env, "GET", "/api/items?all=1", { token });
  assert.equal(all.body.items.some((i: any) => i.id === id), true, "the row is still there");
});

Deno.test("searching products matches either language", async () => {
  const { env, token } = await ready();
  const arabic = await call(env, "GET", "/api/items?q=" + encodeURIComponent("سحلب"), { token });
  assert.equal(arabic.body.items.length, 2);
  const english = await call(env, "GET", "/api/items?q=sahlab", { token });
  assert.equal(english.body.items.length, 2);
});

Deno.test("a business customer must carry a tax registration number", async () => {
  const { env, token } = await ready();

  const rejected = await call(env, "PUT", "/api/customers/c1", {
    token,
    body: { name_ar: "شركة النور", customer_type: "business" },
  });
  assert.equal(rejected.status, 400);

  const accepted = await call(env, "PUT", "/api/customers/c1", {
    token,
    body: { name_ar: "شركة النور", customer_type: "business", tax_registration_number: "123-456-789" },
  });
  assert.equal(accepted.status, 200);
});

Deno.test("the VAT switch is a settings change and moves the whole catalogue", async () => {
  const { env, token } = await ready();
  const id = itemId(env, "Tamarind%");

  const before = await call(env, "PUT", "/api/invoices/v1", {
    token,
    body: { customer_name_ar: "عميل", lines: [{ item_id: id, quantity_milli: 1000 }] },
  });
  assert.equal(before.body.invoice.vat_total_piastres, 0);

  const switched = await call(env, "PUT", "/api/settings", {
    token,
    body: { default_vat_rate_bp: 1400 },
  });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.settings.default_vat_rate_bp, 1400);

  const after = await call(env, "PUT", "/api/invoices/v2", {
    token,
    body: { customer_name_ar: "عميل", lines: [{ item_id: id, quantity_milli: 1000 }] },
  });
  assert.equal(after.body.lines[0].vat_rate_bp, 1400);
  assert.equal(after.body.invoice.vat_total_piastres, 1400);

  // and no item row had to change
  const untouched = env.raw.prepare(
    "SELECT COUNT(*) c FROM items WHERE vat_rate_bp IS NOT NULL",
  ).get() as { c: number };
  assert.equal(untouched.c, 0);
});

/* ========================================================================== */
/* Cross-origin                                                               */
/* ========================================================================== */

Deno.test("the Tauri origins may call the API; a stranger may not", async () => {
  const { env, token } = await ready();

  const tauri = await call(env, "GET", "/api/items", {
    token,
    origin: "http://tauri.localhost",
  });
  assert.equal(tauri.status, 200);
  assert.equal(tauri.headers.get("access-control-allow-origin"), "http://tauri.localhost");

  const stranger = await call(env, "GET", "/api/items", {
    token,
    origin: "https://evil.example.com",
  });
  assert.equal(stranger.headers.get("access-control-allow-origin"), null);
});

Deno.test("a preflight is answered without touching the database", async () => {
  const env = createTestEnv();
  const preflight = await call(env, "OPTIONS", "/api/invoices", {
    origin: "tauri://localhost",
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "tauri://localhost");
});

/* ========================================================================== */
/* Numbers that were taken but never used                                     */
/* ========================================================================== */

/**
 * Break one specific statement, to force the failure that leaves a gap.
 * `mode` is either a thrown error (a connection dropping) or a silent
 * zero-row update (the draft moving under us).
 */
function withBrokenStatement(
  env: TestEnv,
  pattern: RegExp,
  mode: "throw" | "no-rows",
): TestEnv {
  const real = env.DB;
  const breakIt = (statement: any) => ({
    bind: (...values: unknown[]) => breakIt(statement.bind(...values)),
    first: () => statement.first(),
    all: () => statement.all(),
    run: () =>
      mode === "throw"
        ? Promise.reject(new Error("connection lost while writing"))
        : Promise.resolve({
          results: [],
          success: true,
          meta: { changes: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
        }),
  });

  return {
    ...env,
    DB: {
      prepare: (sql: string) => {
        const statement = real.prepare(sql);
        return pattern.test(sql) ? breakIt(statement) as any : statement;
      },
      batch: (statements: any) => real.batch(statements),
    },
  };
}

const STAMP = /SET doc_status = 'issued'/;

Deno.test("with nothing wrong, there are no gaps to report", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "fine-1");
  await draftAndIssue(env, token, "fine-2");

  const report = await call(env, "GET", "/api/unused-numbers", { token });
  assert.equal(report.status, 200);
  assert.deepEqual(report.body.recorded, []);
  assert.deepEqual(report.body.unexplained, []);
  assert.equal(report.body.total, 0);
});

Deno.test("a number that cannot be stamped is written down, with the time and the reason", async () => {
  const { env, token } = await ready();
  const year = cairoToday().year;

  await call(env, "PUT", "/api/invoices/unlucky", {
    token,
    body: {
      customer_name_ar: "محل الأمل",
      lines: [{ name_ar: "بن", unit_price_piastres: 10000, quantity_milli: 1000 }],
    },
  });

  const broken = withBrokenStatement(env, STAMP, "throw");
  const failed = await call(broken, "POST", "/api/invoices/unlucky/issue", { token });

  assert.equal(failed.status, 409);
  assert.equal(failed.body.error.code, "issue_failed");
  assert.match(failed.body.error.message, new RegExp(`INV-${year}-001`));

  const report = await call(env, "GET", "/api/unused-numbers", { token });
  assert.equal(report.body.recorded.length, 1);

  const row = report.body.recorded[0];
  assert.equal(row.invoice_number, `INV-${year}-001`);
  assert.equal(row.document_type, "invoice");
  assert.equal(row.year, year);
  assert.equal(row.serial, 1);
  assert.equal(row.invoice_id, "unlucky", "which document it was meant for");
  assert.equal(row.allocated_by_name, "Omar", "who was issuing at the time");
  assert.match(row.allocated_at, /^\d{4}-\d{2}-\d{2}T/, "a timestamp to point at");
  assert.match(row.failure_reason, /connection lost/);

  // Nothing is left unexplained: the recorded row accounts for the gap.
  assert.deepEqual(report.body.unexplained, []);
});

Deno.test("the draft survives, and issuing again takes the NEXT number", async () => {
  const { env, token } = await ready();
  const year = cairoToday().year;

  await call(env, "PUT", "/api/invoices/retry", {
    token,
    body: {
      customer_name_ar: "عميل",
      lines: [{ name_ar: "بن", unit_price_piastres: 10000, quantity_milli: 1000 }],
    },
  });

  await call(withBrokenStatement(env, STAMP, "throw"), "POST", "/api/invoices/retry/issue", {
    token,
  });

  // Still a draft, still editable, money untouched.
  const draft = await call(env, "GET", "/api/invoices/retry", { token });
  assert.equal(draft.body.invoice.doc_status, "draft");
  assert.equal(draft.body.invoice.invoice_number, null);
  assert.equal(draft.body.invoice.total_piastres, 10000);

  // Second attempt succeeds and gets 00002 — 00001 is never reused.
  const issued = await call(env, "POST", "/api/invoices/retry/issue", { token });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.invoice.invoice_number, `INV-${year}-002`);

  const report = await call(env, "GET", "/api/unused-numbers", { token });
  assert.equal(report.body.recorded.length, 1);
  assert.equal(report.body.recorded[0].invoice_number, `INV-${year}-001`);
});

Deno.test("a draft that vanishes mid-issue is recorded too", async () => {
  // The other way this fails: the update runs but matches nothing, because
  // the other user issued or deleted the draft a moment earlier.
  const { env, token } = await ready();
  const year = cairoToday().year;

  await call(env, "PUT", "/api/invoices/ghost", {
    token,
    body: {
      customer_name_ar: "عميل",
      lines: [{ name_ar: "بن", unit_price_piastres: 100, quantity_milli: 1000 }],
    },
  });

  const failed = await call(
    withBrokenStatement(env, STAMP, "no-rows"),
    "POST",
    "/api/invoices/ghost/issue",
    { token },
  );
  assert.equal(failed.status, 409);

  const report = await call(env, "GET", "/api/unused-numbers", { token });
  assert.equal(report.body.recorded.length, 1);
  assert.equal(report.body.recorded[0].invoice_number, `INV-${year}-001`);
  assert.match(report.body.recorded[0].failure_reason, /someone else/);
});

Deno.test("the record of a spent number cannot be edited or deleted", async () => {
  // A gap record that could be tidied away afterwards would be worth nothing
  // in an audit, so the database refuses both.
  const { env, token } = await ready();
  await call(env, "PUT", "/api/invoices/x", {
    token,
    body: { customer_name_ar: "ع", lines: [{ name_ar: "ب", unit_price_piastres: 100, quantity_milli: 1000 }] },
  });
  await call(withBrokenStatement(env, STAMP, "throw"), "POST", "/api/invoices/x/issue", { token });

  assert.throws(
    () => env.raw.exec("UPDATE unused_invoice_numbers SET failure_reason = 'nothing to see'"),
    /immutable/,
  );
  assert.throws(
    () => env.raw.exec("DELETE FROM unused_invoice_numbers"),
    /immutable/,
  );
  const still = env.raw.prepare("SELECT COUNT(*) c FROM unused_invoice_numbers").get() as
    { c: number };
  assert.equal(still.c, 1);
});

Deno.test("a gap with no record at all still shows up as unexplained", async () => {
  // The recorded list is what the software wrote down. This second list is
  // computed by walking the series, so a number that went missing without
  // being recorded is still visible rather than silently absent.
  const { env, token } = await ready();
  const year = cairoToday().year;

  await draftAndIssue(env, token, "a"); // takes 00001

  // Something takes 00002 and leaves no trace of it.
  env.raw.exec(
    `UPDATE document_counters SET next_number = next_number + 1
     WHERE document_type = 'invoice' AND year = ${year}`,
  );

  await draftAndIssue(env, token, "b"); // takes 00003

  const report = await call(env, "GET", "/api/unused-numbers", { token });
  assert.deepEqual(report.body.recorded, [], "nothing was written down");
  assert.equal(report.body.unexplained.length, 1);
  assert.equal(report.body.unexplained[0].invoice_number, `INV-${year}-002`);
  assert.equal(report.body.unexplained[0].serial, 2);
  assert.equal(report.body.total, 1);
});

Deno.test("credit notes are checked for gaps on their own series", async () => {
  const { env, token } = await ready();
  const year = cairoToday().year;
  await draftAndIssue(env, token, "orig-2");

  const note = await call(env, "POST", "/api/invoices/orig-2/credit-note", {
    token,
    body: { id: "cn-fail" },
  });
  assert.equal(note.status, 200);

  await call(withBrokenStatement(env, STAMP, "throw"), "POST", "/api/invoices/cn-fail/issue", {
    token,
  });

  const report = await call(env, "GET", "/api/unused-numbers", { token });
  assert.equal(report.body.recorded.length, 1);
  assert.equal(report.body.recorded[0].invoice_number, `CN-${year}-001`);
  assert.equal(report.body.recorded[0].document_type, "credit_note");
  assert.deepEqual(report.body.unexplained, [], "the invoice series is untouched");
});

Deno.test("the gap report needs a login like everything else", async () => {
  const env = createTestEnv();
  assert.equal((await call(env, "GET", "/api/unused-numbers")).status, 401);
});

Deno.test("a credit note reports the number of the invoice it corrects", async () => {
  const { env, token } = await ready();
  await draftAndIssue(env, token, "original");
  const originalNumber =
    (await call(env, "GET", "/api/invoices/original", { token })).body.invoice.invoice_number;

  await call(env, "POST", "/api/invoices/original/credit-note", { token, body: { id: "note" } });
  const note = await call(env, "GET", "/api/invoices/note", { token });

  // The printed document has to name the invoice the way the customer knows
  // it, not by our internal id.
  assert.equal(note.body.invoice.references_invoice_number, originalNumber);
  assert.equal(note.body.invoice.references_invoice_id, "original");
});
