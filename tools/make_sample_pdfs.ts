/**
 * Produce real PDFs, the same way pressing the button in the app does.
 *
 * It creates four documents through the API, then drives a real browser to
 * open each one and press PDF, letting the browser download the file. Nothing
 * here is a special code path: it is the ordinary route a person takes.
 *
 * Needs the dev server and a headless Chrome with remote debugging:
 *
 *   deno task build:web
 *   deno task dev:server &
 *   google-chrome-stable --headless=new --remote-debugging-port=9223 \
 *     --user-data-dir=/tmp/casacava-pdf about:blank &
 *   deno task samples
 */
import { deriveClientSecret } from "../src/lib/password.ts";

const APP = `http://127.0.0.1:${Deno.env.get("PORT") ?? 8799}`;
const CDP = `http://127.0.0.1:${Deno.env.get("CDP_PORT") ?? 9223}`;
const OUT = new URL("../samples/", import.meta.url).pathname;

const EMAIL = "omar@casacavco.com";
const PASSWORD = "development password";

/* ---- the API, straight over fetch ---------------------------------------- */

let token = "";
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${APP}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/* ---- CDP ----------------------------------------------------------------- */

let nextId = 1;
let socket: WebSocket;
const pending = new Map<number, (result: unknown) => void>();

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve as (result: unknown) => void);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.exceptionDetails) {
    throw new Error("page error: " + JSON.stringify(result.exceptionDetails.exception));
  }
  return result?.result?.value;
}

async function waitFor(expression: string, label: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function fileAppears(name: string, timeoutMs = 60000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await Deno.stat(`${OUT}${name}`);
      if (info.size > 1000) return info.size;
    } catch { /* not there yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the browser never produced ${name}`);
}

/* ---- the four documents -------------------------------------------------- */

const LONG_NAME_AR =
  "نسكافيه جولد خشن إسباني معبأ في أكياس محكمة الغلق بوزن خمسة كيلوجرامات " +
  "للاستخدام في المحلات والكافيهات والمطاعم";
const LONG_ADDRESS =
  "شارع جمال عبد الناصر، المتفرع من شارع الجمهورية، بجوار مسجد النور، " +
  "الدور الثالث، شقة ١٢، حي الزهور، مدينة المنصورة، محافظة الدقهلية، جمهورية مصر العربية";

function lines(items: Array<[string, string, number, number, string?, number?]>) {
  return items.map(([nameAr, nameEn, priceEgp, qty, discountType, discountValue]) => ({
    item_id: null,
    name_ar: nameAr,
    name_en: nameEn,
    unit_ar: "كجم",
    unit_en: "kg",
    unit_price_piastres: Math.round(priceEgp * 100),
    vat_rate_bp: 0,
    quantity_milli: Math.round(qty * 1000),
    discount_type: discountType ?? "none",
    discount_value: discountValue ?? 0,
  }));
}

const MIXED = lines([
  ["نسكافيه جولد خشن إسباني", "Nescafe Gold Coarse (Spanish)", 1080, 5],
  ["لبن كامل الدسم نيوزيلندي", "Full Cream Milk Powder (New Zealand)", 340, 2.5, "percent", 500],
  ["كاكاو خام إسباني سايب", "Unsweetened Cocoa Powder (Spanish)", 480, 1.25, "amount", 5000],
  ["سحلب مكسرات", "Sahlab Mix with Nuts", 190, 0.75],
  ["تمر هندي", "Tamarind", 100, 10],
]);

async function main() {
  await Deno.mkdir(OUT, { recursive: true });
  for await (const entry of Deno.readDir(OUT)) {
    if (entry.name.endsWith(".pdf")) await Deno.remove(`${OUT}${entry.name}`);
  }

  token = (await call("/auth/login", "POST", {
    email: EMAIL,
    clientSecret: await deriveClientSecret(PASSWORD, EMAIL),
  })).token;

  const made: Array<{ id: string; label: string }> = [];

  // 1 — Arabic, several lines, mixed quantities, both kinds of discount
  const arabicId = crypto.randomUUID();
  await call(`/invoices/${arabicId}`, "PUT", {
    document_language: "ar",
    price_tier: "wholesale",
    customer_name_ar: "محل الأمل للبقالة",
    customer_name_en: "Al Amal Grocery",
    customer_phone: "01094715831",
    customer_address: "٣٥ شارع الجمهورية، وسط البلد، القاهرة",
    customer_type: "individual",
    notes: "التسليم خلال ثلاثة أيام عمل من تاريخ الفاتورة.",
    payment_terms: "دفع عند الاستلام أو تحويل",
    lines: MIXED,
  });
  await call(`/invoices/${arabicId}/issue`, "POST");
  made.push({ id: arabicId, label: "1-arabic-invoice" });

  // 2 — the same invoice, in English
  const englishId = crypto.randomUUID();
  await call(`/invoices/${englishId}`, "PUT", {
    document_language: "en",
    price_tier: "wholesale",
    customer_name_ar: "محل الأمل للبقالة",
    customer_name_en: "Al Amal Grocery",
    customer_phone: "01094715831",
    customer_address: "35 El Gomhoreya Street, Downtown, Cairo",
    customer_type: "individual",
    notes: "Delivery within three working days of the invoice date.",
    payment_terms: "Cash on delivery or bank transfer",
    lines: MIXED,
  });
  await call(`/invoices/${englishId}/issue`, "POST");
  made.push({ id: englishId, label: "2-english-invoice" });

  // 3 — a long product name and a long address, to see what overflows
  const longId = crypto.randomUUID();
  await call(`/invoices/${longId}`, "PUT", {
    document_language: "ar",
    customer_name_ar: "شركة النور للتجارة والتوزيع والاستيراد والتصدير",
    customer_phone: "01001234567",
    customer_address: LONG_ADDRESS,
    customer_type: "business",
    customer_tax_registration_number: "123-456-789",
    notes: "برجاء مراجعة الأصناف عند الاستلام والتوقيع على إذن الاستلام.",
    // Long enough to genuinely need a second page, so the continuation header
    // is visible — and long enough that the spill is not trivial.
    lines: [
      ...lines([[LONG_NAME_AR, "Long product name", 1080, 5]]),
      ...MIXED,
      ...MIXED,
      ...lines([
        ["كابتشينو 5 طعم", "Cappuccino 5 Flavours", 240, 3],
        ["مبيض قهوة إسباني", "Coffee Creamer (Spanish)", 220, 6, "percent", 250],
        ["فوم رغوة إسباني", "Milk Foam Powder (Spanish)", 240, 4],
        ["حلبة محوجة", "Fenugreek Drink Mix", 200, 2.5],
        ["مغات محوج", "Moghat Drink Mix", 300, 1.5, "amount", 2000],
      ]),
    ],
  });
  await call(`/invoices/${longId}/issue`, "POST");
  made.push({ id: longId, label: "3-arabic-long-text" });

  // 4 — a credit note against the first one
  const creditId = crypto.randomUUID();
  await call(`/invoices/${arabicId}/credit-note`, "POST", { id: creditId });
  await call(`/invoices/${creditId}`, "PUT", {
    document_type: "credit_note",
    references_invoice_id: arabicId,
    document_language: "ar",
    customer_name_ar: "محل الأمل للبقالة",
    customer_phone: "01094715831",
    customer_address: "٣٥ شارع الجمهورية، وسط البلد، القاهرة",
    customer_type: "individual",
    notes: "رد كيلوجرام واحد من الكاكاو لعيب في التغليف.",
    lines: lines([["كاكاو خام إسباني سايب", "Unsweetened Cocoa Powder (Spanish)", 480, 1]]),
  });
  await call(`/invoices/${creditId}/issue`, "POST");
  made.push({ id: creditId, label: "4-credit-note" });

  // ---- drive the browser ---------------------------------------------------
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  const page = targets.find((t: { type: string }) => t.type === "page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.onopen = resolve);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message.result);
      pending.delete(message.id);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT });

  await send("Network.clearBrowserCookies");
  await send("Page.navigate", { url: `${APP}/` });
  await waitFor("document.readyState === 'complete'", "first load");
  await evaluate(`localStorage.setItem('casacava.token', ${JSON.stringify(token)}); true`);

  for (const { id, label } of made) {
    await send("Page.navigate", { url: `${APP}/#/invoices/${id}` });
    await evaluate("location.reload(); true");
    await waitFor("!!document.querySelector('#btn-pdf')", `PDF button for ${label}`);
    await waitFor("!document.querySelector('#btn-pdf').disabled", "PDF button enabled");

    const invoice = (await call(`/invoices/${id}`)).invoice;
    const expected = `${invoice.invoice_number.replace(/[^\w.-]+/g, "_")}.pdf`;

    await evaluate("document.querySelector('#btn-pdf').click(); true");
    const size = await fileAppears(expected);
    await Deno.rename(`${OUT}${expected}`, `${OUT}${label}.pdf`);
    console.log(
      `  ${label}.pdf   ${invoice.invoice_number}   ${Math.round(size / 1024)} KB`,
    );
  }

  console.log(`\nFour PDFs in ${OUT}`);
  socket.close();
}

await main();
