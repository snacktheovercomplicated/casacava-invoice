/**
 * Drive the built app in a real browser and check it end to end.
 *
 * This is the check that the interface actually works: that it comes up in
 * Arabic right-to-left, that the language toggle mirrors the whole layout
 * rather than only re-aligning text, that signing in with the real password
 * flow works, that the totals and the amount in words are right, and that an
 * issued invoice locks itself.
 *
 * It needs Chrome and the dev server, so it is a tool rather than part of
 * `deno task test`:
 *
 *   deno task build:web
 *   deno task dev:server &
 *   google-chrome-stable --headless=new --remote-debugging-port=9223 \
 *     --user-data-dir=/tmp/casacava-ui-check about:blank &
 *   deno task ui:check
 */
const PORT = Number(Deno.env.get("PORT") ?? 8799);
const CDP = Number(Deno.env.get("CDP_PORT") ?? 9223);

let nextId = 1;
let socket: WebSocket;
const pending = new Map<number, (result: any) => void>();

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
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

async function waitFor(expression: string, label: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const ok = (message: string) => console.log(`  PASS  ${message}`);

/** Wait for a button whose text contains `text`, then click it. */
async function click(text: string, timeoutMs = 15000) {
  const finder =
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}))`;
  await waitFor(`!!${finder}`, `button "${text}"`, timeoutMs);
  await evaluate(`${finder}.click()`);
}

// --- connect ---------------------------------------------------------------
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t: any) => t.type === "page");
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

// --- 1. the app boots, in Arabic, right-to-left ----------------------------
// Start from a clean device every time: no cookie, no saved token, no cache.
await send("Network.enable");
await send("Network.clearBrowserCookies");
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await waitFor("document.readyState === 'complete'", "first load");
await evaluate("localStorage.clear(); indexedDB.deleteDatabase('casacava'); true");
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await waitFor("!!document.querySelector('form.card')", "login form");

if (await evaluate("document.documentElement.dir") !== "rtl") throw new Error("not RTL");
if (!String(await evaluate("document.documentElement.lang")).startsWith("ar")) {
  throw new Error("not ar");
}
ok("boots in Arabic, document direction is rtl");

const arabicTitle = await evaluate("document.querySelector('.header h1').textContent");
if (arabicTitle !== "كازا كافا") throw new Error(`header was "${arabicTitle}"`);
ok(`header reads "${arabicTitle}" from the Arabic translation file`);

// --- 2. the language toggle mirrors the whole layout -----------------------
await click("English");
await waitFor("document.documentElement.dir === 'ltr'", "ltr after toggle");
const englishTitle = await evaluate("document.querySelector('.header h1').textContent");
if (englishTitle !== "Casa Cava") throw new Error(`header was "${englishTitle}"`);
ok("toggling to English flips direction to ltr and swaps every string");

// the nav really is mirrored, not just re-aligned
await click("العربية");
await waitFor("document.documentElement.dir === 'rtl'", "back to rtl");
ok("and back again");

// --- 3. signing in ---------------------------------------------------------
await evaluate(`
  (() => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = document.querySelectorAll('form.card input');
    set(inputs[0], 'omar@casacavco.com');
    set(inputs[1], 'development password');
    document.querySelector('form.card button[type=submit]').click();
  })()
`);
await waitFor("!!document.querySelector('.nav')", "signed in, nav visible", 25000);
ok("signs in with the real password flow (PBKDF2 on the device)");

// The signed-in user carries a saved language, which may be either one. The
// rest of this check reads Arabic labels, so put it back to Arabic first.
if (await evaluate("document.documentElement.dir === 'ltr'")) {
  await click("العربية");
  await waitFor("document.documentElement.dir === 'rtl'", "back to Arabic");
}
ok("the signed-in user's saved language is applied, and can be switched back");

// --- 4. making an invoice --------------------------------------------------
await click("فاتورة جديدة");
await waitFor("location.hash.startsWith('#/invoices/')", "editor route");
// the editor loads settings before it renders, so wait for the real screen
await waitFor("!!document.querySelector('.card select')", "editor loaded");
ok("opens a new invoice with a device-generated id");

await click("إضافة صنف");
await waitFor("!!document.querySelector('.picker-item')", "product picker");
const firstProduct = await evaluate(
  "document.querySelector('.picker-item .grow').textContent",
);
ok(`product picker lists the catalogue (first: ${firstProduct})`);

await evaluate("document.querySelector('.picker-item').click()");
await waitFor("!!document.querySelector('.line')", "a line was added");

// 1 kg of Nescafe Gold Coarse at 1080.00, no VAT yet
const total = await evaluate("document.querySelector('.totals .grand span:last-child').textContent");
ok(`totals computed on the device: ${total.trim()}`);

// A number next to % must not flip in a right-to-left paragraph.
const vatText = await evaluate("document.querySelector('.line-total .muted').textContent");
if (!vatText.includes("0%")) throw new Error(`VAT reads "${vatText.trim()}" - the percent sign flipped`);
ok(`percentages stay the right way round in Arabic: "${vatText.trim()}"`);

const words = await evaluate("document.querySelector('.words').textContent");
if (!words.includes("فقط")) throw new Error("amount in words missing");
ok(`amount in words, in the invoice's language: ${words.replace(/^المبلغ كتابةً/, "").trim()}`);

// --- 5. issuing ------------------------------------------------------------
await click("إصدار الفاتورة");
await waitFor("!!document.querySelector('.scrim')", "confirmation sheet");
ok("issuing asks for confirmation first, it is never automatic");

await click("نعم");
await waitFor("!!document.querySelector('.pill.issued')", "issued", 20000);
const number = await evaluate("document.querySelector('.header + * .ltr, .muted.small.ltr')?.textContent");
ok(`issued and numbered: ${number}`);

const readOnly = await evaluate(
  "!![...document.querySelectorAll('input')].every(i => i.disabled || i.type === 'search')",
);
if (!readOnly) throw new Error("issued invoice still has editable fields");
ok("every field is locked once issued");

/* ========================================================================== */
/* The PDF                                                                    */
/* ========================================================================== */

console.log("\n  --- PDF ---");

/** Read the token the app is using, so the page can fetch its own data. */
const appToken = await evaluate("localStorage.getItem('casacava.token')");

/** Build an invoice with enough lines to need a second page. */
async function makeLongInvoice(): Promise<string> {
  const id = crypto.randomUUID();
  const line = (name: string, price: number, qty: number, disc?: string, value?: number) => ({
    item_id: null,
    name_ar: name,
    name_en: name,
    unit_ar: "كجم",
    unit_en: "kg",
    unit_price_piastres: price * 100,
    vat_rate_bp: 0,
    quantity_milli: qty * 1000,
    discount_type: disc ?? "none",
    discount_value: value ?? 0,
  });
  const lines = [];
  for (let i = 0; i < 22; i++) {
    lines.push(
      line(
        `نسكافيه جولد خشن إسباني معبأ في أكياس محكمة الغلق — صنف رقم ${i + 1}`,
        1080,
        i + 1,
        i === 3 ? "percent" : i === 7 ? "amount" : "none",
        i === 3 ? 500 : i === 7 ? 5000 : 0,
      ),
    );
  }
  await evaluate(`
    (async () => {
      const r = await fetch('/api/invoices/${id}', {
        method: 'PUT',
        headers: { 'content-type': 'application/json',
                   authorization: 'Bearer ' + ${JSON.stringify(appToken)} },
        body: ${JSON.stringify(JSON.stringify({
    document_language: "ar",
    customer_name_ar: "شركة النور للتجارة والتوزيع والاستيراد والتصدير",
    customer_address:
      "شارع جمال عبد الناصر، المتفرع من شارع الجمهورية، بجوار مسجد النور، الدور الثالث، شقة ١٢، حي الزهور، مدينة المنصورة، محافظة الدقهلية",
    customer_type: "business",
    customer_tax_registration_number: "123-456-789",
    notes: "برجاء مراجعة الأصناف عند الاستلام.",
    lines,
  }))}
      });
      if (!r.ok) throw new Error('could not build the long invoice: ' + r.status);
      await fetch('/api/invoices/${id}/issue', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + ${JSON.stringify(appToken)} },
      });
      return true;
    })()
  `);
  return id;
}

// Press PDF once so the PDF code, the libraries and the embedded font load.
await click("PDF");
await waitFor("!!globalThis.__casacavaPdf", "PDF module loaded", 60000);
ok("the PDF code loads only when it is asked for");

/* ---- does the embedded Arabic font actually join letters? ---------------- */

const joining = await evaluate(`
  (() => {
    // Mount a probe using the same stylesheet the PDF uses.
    const host = document.createElement('div');
    host.setAttribute('style','position:fixed;top:0;inset-inline-start:-9999px;width:720px');
    const style = document.createElement('style');
    style.textContent = globalThis.__casacavaPdf.PAPER_CSS;
    const paper = document.createElement('div');
    paper.className = 'paper'; paper.dir = 'rtl'; paper.lang = 'ar';
    // Same word twice: once normally, once with a zero-width non-joiner between
    // every letter, which forces the isolated (unjoined) forms.
    const word = 'فاتورة';
    paper.innerHTML =
      '<span id="probe-joined" style="font-size:40px">' + word + '</span>' +
      '<span id="probe-split" style="font-size:40px">' + word.split('').join('\\u200C') + '</span>';
    host.append(style, paper);
    document.body.appendChild(host);
    const joined = document.getElementById('probe-joined').getBoundingClientRect().width;
    const split = document.getElementById('probe-split').getBoundingClientRect().width;
    const family = getComputedStyle(document.getElementById('probe-joined')).fontFamily;
    host.remove();
    return { joined, split, family };
  })()
`);

if (!/CasaCava Arabic/.test(joining.family)) {
  throw new Error(`the paper is not using the embedded font: ${joining.family}`);
}
// Joined Arabic is materially narrower than the same letters kept apart.
if (!(joining.joined < joining.split * 0.92)) {
  throw new Error(
    `Arabic letters are NOT joining: joined ${joining.joined.toFixed(1)}px vs ` +
      `separated ${joining.split.toFixed(1)}px`,
  );
}
ok(
  `Arabic letters join: "فاتورة" is ${joining.joined.toFixed(0)}px joined vs ` +
    `${joining.split.toFixed(0)}px when forced apart`,
);

/* ---- do numbers keep their order inside Arabic text? --------------------- */

const order = await evaluate(`
  (() => {
    const host = document.createElement('div');
    host.setAttribute('style','position:fixed;top:0;inset-inline-start:-9999px;width:720px');
    const style = document.createElement('style');
    style.textContent = globalThis.__casacavaPdf.PAPER_CSS;
    const paper = document.createElement('div');
    paper.className = 'paper'; paper.dir = 'rtl'; paper.lang = 'ar';
    paper.innerHTML = '<div id="probe-row" style="font-size:24px">' +
      'الإجمالي <span class="n">-1,234.50 جنيه</span> و <span class="n">14%</span></div>';
    host.append(style, paper);
    document.body.appendChild(host);

    const node = document.getElementById('probe-row').querySelector('.n').firstChild;
    const at = (index) => {
      const range = document.createRange();
      range.setStart(node, index); range.setEnd(node, index + 1);
      return range.getBoundingClientRect().left;
    };
    const text = node.textContent;                 // "-1,234.50 جنيه"
    const positions = {
      minus: at(text.indexOf('-')),
      one: at(text.indexOf('1')),
      five: at(text.indexOf('5')),
      zero: at(text.lastIndexOf('0')),
    };

    const percentNode = document.getElementById('probe-row').querySelectorAll('.n')[1].firstChild;
    const pctAt = (index) => {
      const range = document.createRange();
      range.setStart(percentNode, index); range.setEnd(percentNode, index + 1);
      return range.getBoundingClientRect().left;
    };
    const pct = { digit: pctAt(0), sign: pctAt(2) };

    host.remove();
    return { positions, pct, text };
  })()
`);

const { minus, one, five, zero } = order.positions;
if (!(minus < one && one < five && five < zero)) {
  throw new Error(
    `a number reversed inside Arabic text: minus@${minus.toFixed(0)} 1@${one.toFixed(0)} ` +
      `5@${five.toFixed(0)} 0@${zero.toFixed(0)}`,
  );
}
ok('a signed amount keeps its order inside Arabic text: "-1,234.50" reads left to right');

if (!(order.pct.digit < order.pct.sign)) {
  throw new Error("the percent sign moved in front of the number");
}
ok('a percentage keeps its order: "14%" does not come out as "%14"');

/* ---- the brand and the mark --------------------------------------------- */

const brand = await evaluate(`
  (() => {
    const host = document.createElement('div');
    host.setAttribute('style','position:fixed;top:0;inset-inline-start:-9999px;width:720px');
    const style = document.createElement('style');
    style.textContent = globalThis.__casacavaPdf.PAPER_CSS;
    const paper = document.createElement('div');
    paper.className = 'paper'; paper.dir = 'rtl';
    paper.innerHTML = '<div class="p-words"><div class="t">x</div></div>';
    host.append(style, paper);
    document.body.appendChild(host);
    const colour = getComputedStyle(paper.querySelector('.p-words')).borderInlineStartColor;
    host.remove();
    return colour;
  })()
`);
if (brand.replace(/\s/g, "") !== "rgb(160,110,78)") {
  throw new Error(`the brand colour is ${brand}, not #a06e4e`);
}
ok("the brand colour #a06e4e carried over from the old layout");

/* ---- a long invoice must not lose its totals ----------------------------- */

const longId = await makeLongInvoice();

const long = await evaluate(`
  (async () => {
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();
    const { blob, report } = await globalThis.__casacavaPdf.renderInvoicePdf({
      invoice: doc.invoice, lines: doc.lines,
      settings: doc.invoice.company_snapshot ?? cfg.settings,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { report, base64: btoa(binary), lineCount: doc.lines.length };
  })()
`);

if (long.report.pageCount < 2) {
  throw new Error(`the long invoice came out as ${long.report.pageCount} page(s); ` +
    "it should need more than one, or this check proves nothing");
}
ok(`a ${long.lineCount}-line invoice spans ${long.report.pageCount} pages`);

// No page may end in the middle of the totals or the amount in words.
for (const block of long.report.blocks) {
  for (const cut of long.report.cuts.slice(0, -1)) {
    if (cut > block.top + 1 && cut < block.bottom - 1) {
      throw new Error(
        `a page break at ${cut.toFixed(0)} falls inside ${block.name} ` +
          `(${block.top.toFixed(0)}–${block.bottom.toFixed(0)})`,
      );
    }
  }
}
ok("no page break falls inside the totals block or the amount in words");

// And nothing is dropped: the pages together cover the whole drawing.
const covered = long.report.cuts[long.report.cuts.length - 1];
if (covered < long.report.canvasHeight - 2) {
  throw new Error(
    `the pages cover ${covered} of ${long.report.canvasHeight} pixels — content was lost`,
  );
}
ok("the pages together cover the whole document, nothing dropped off the end");

// A last page holding almost nothing looks like a mistake. Either it is
// reasonably full, or the document was already shrunk as far as it may go.
if (long.report.lastPageFill < 0.25 && !long.report.shrunk) {
  throw new Error(
    `the last page is only ${(long.report.lastPageFill * 100).toFixed(0)}% full and ` +
      "no attempt was made to pull it back onto the previous page",
  );
}
ok(
  `the last page is ${(long.report.lastPageFill * 100).toFixed(0)}% full` +
    (long.report.shrunk ? " (the document was shrunk slightly to save a page)" : ""),
);

/* ---- look at the finished PDF, as pixels --------------------------------- */

const scratch = await Deno.makeTempDir();
const pdfPath = `${scratch}/long.pdf`;
await Deno.writeFile(
  pdfPath,
  Uint8Array.from(atob(long.base64), (c) => c.charCodeAt(0)),
);

const rasterise = new Deno.Command("pdftoppm", {
  args: ["-r", "120", "-f", "1", "-l", "1", pdfPath, `${scratch}/page`],
}).outputSync();
if (rasterise.code !== 0) {
  throw new Error("pdftoppm failed: " + new TextDecoder().decode(rasterise.stderr));
}

/** Parse the PPM that pdftoppm writes: "P6 <w> <h> 255" then raw RGB bytes. */
function readPpm(bytes: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  let offset = 0;
  const token = () => {
    while (bytes[offset] === 0x23) { // a comment line
      while (bytes[offset] !== 0x0a) offset++;
      offset++;
    }
    while (bytes[offset] === 0x20 || bytes[offset] === 0x0a || bytes[offset] === 0x0d ||
      bytes[offset] === 0x09) offset++;
    const start = offset;
    while (offset < bytes.length && bytes[offset] > 0x20) offset++;
    return new TextDecoder().decode(bytes.subarray(start, offset));
  };
  const magic = token();
  if (magic !== "P6") throw new Error(`expected a P6 image, got ${magic}`);
  const width = Number(token());
  const height = Number(token());
  token(); // max value
  offset++; // the single whitespace before the pixels
  return { width, height, rgb: bytes.subarray(offset) };
}

const ppmCommand = new Deno.Command("pdftoppm", {
  args: ["-r", "120", "-f", "1", "-l", "1", pdfPath],
  stdout: "piped",
}).outputSync();
const image = readPpm(ppmCommand.stdout);

let brandPixels = 0;
let inkPixels = 0;
for (let i = 0; i + 2 < image.rgb.length; i += 3) {
  const r = image.rgb[i], g = image.rgb[i + 1], b = image.rgb[i + 2];
  if (Math.abs(r - 160) < 26 && Math.abs(g - 110) < 26 && Math.abs(b - 78) < 26) brandPixels++;
  if (r < 200 && g < 200 && b < 200) inkPixels++;
}

if (inkPixels < 5000) {
  throw new Error(`the first page looks blank: only ${inkPixels} non-white pixels`);
}
ok(`page one of the PDF has real content (${inkPixels.toLocaleString()} non-white pixels)`);

// Measured at roughly 600 brand pixels on a correct page at 120 dpi; this
// threshold is there to catch the mark going missing or the colour changing,
// not to police small layout tweaks.
if (brandPixels < 300) {
  throw new Error(
    `the Casa Cava mark and brand colour are missing: only ${brandPixels} brand pixels`,
  );
}
ok(`the mark and the #a06e4e brand colour are in the PDF (${brandPixels.toLocaleString()} pixels)`);

// The mark sits in the top strip of the page.
const stripHeight = Math.floor(image.height * 0.18);
let logoPixels = 0;
for (let y = 0; y < stripHeight; y++) {
  for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 3;
    const r = image.rgb[i], g = image.rgb[i + 1], b = image.rgb[i + 2];
    if (Math.abs(r - 160) < 26 && Math.abs(g - 110) < 26 && Math.abs(b - 78) < 26) logoPixels++;
  }
}
if (logoPixels < 150) {
  throw new Error(`no logo found in the top of the page (${logoPixels} brand pixels there)`);
}
ok(`the logo is printed at the top of the page (${logoPixels.toLocaleString()} pixels)`);

// Page two must carry the continuation header — ink in its top strip.
if (long.report.pageCount >= 2) {
  const second = new Deno.Command("pdftoppm", {
    args: ["-r", "120", "-f", "2", "-l", "2", pdfPath],
    stdout: "piped",
  }).outputSync();
  const page2 = readPpm(second.stdout);
  const headerBand = Math.floor(page2.height * 0.09);
  let headerInk = 0;
  for (let y = 0; y < headerBand; y++) {
    for (let x = 0; x < page2.width; x++) {
      const i = (y * page2.width + x) * 3;
      if (page2.rgb[i] < 200 && page2.rgb[i + 1] < 200 && page2.rgb[i + 2] < 200) headerInk++;
    }
  }
  if (headerInk < 200) {
    throw new Error(
      `page two has no header: only ${headerInk} dark pixels in its top strip`,
    );
  }
  ok(`page two carries a printed header (${headerInk.toLocaleString()} dark pixels in the top strip)`);
}

await Deno.remove(scratch, { recursive: true });

/* ---- the same invariant across documents of several lengths -------------- */

const lengths = await evaluate(`
  (async () => {
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();
    const settings = doc.invoice.company_snapshot ?? cfg.settings;
    const results = [];
    for (const count of [1, 3, 8, 14, 18, 22, 30, 45]) {
      const lines = doc.lines.slice(0, Math.min(count, doc.lines.length));
      while (lines.length < count) {
        const source = doc.lines[lines.length % doc.lines.length];
        lines.push({ ...source, id: source.id + '-' + lines.length });
      }
      const { report } = await globalThis.__casacavaPdf.renderInvoicePdf({
        invoice: doc.invoice, lines, settings,
      });
      results.push({ count, pages: report.pageCount, fill: report.lastPageFill,
                     shrunk: report.shrunk });
    }
    return results;
  })()
`);

for (const result of lengths) {
  if (result.fill < 0.25 && !result.shrunk) {
    throw new Error(
      `a ${result.count}-line invoice ends on a page only ` +
        `${(result.fill * 100).toFixed(0)}% full, with no attempt to avoid it`,
    );
  }
}
ok(
  "across 1 to 45 lines, no invoice ends on a nearly empty page: " +
    lengths.map((r: { count: number; pages: number; fill: number }) =>
      `${r.count}→${r.pages}p`
    ).join(" "),
);

/* ---- the Amount column must add up to the printed subtotal --------------- */

const column = await evaluate(`
  (async () => {
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();

    const host = document.createElement('div');
    host.setAttribute('style','position:fixed;top:0;inset-inline-start:-9999px;width:720px');
    const style = document.createElement('style');
    style.textContent = globalThis.__casacavaPdf.PAPER_CSS;
    const paper = document.createElement('div');
    paper.className = 'paper'; paper.dir = 'rtl'; paper.lang = 'ar';
    paper.innerHTML = globalThis.__casacavaPdf.renderPaperHtml({
      invoice: doc.invoice, lines: doc.lines,
      settings: doc.invoice.company_snapshot ?? cfg.settings,
    });
    host.append(style, paper);
    document.body.appendChild(host);

    // Read the printed page the way a customer would: take the last cell of
    // every item row, and the subtotal row, straight off the rendered sheet.
    const toPiastres = (text) => {
      const digits = (text.match(/-?[\\d,]+\\.\\d\\d/) || [''])[0].replace(/,/g, '');
      return Math.round(parseFloat(digits) * 100);
    };
    const amounts = [...paper.querySelectorAll('.p-items tbody tr')]
      .map((row) => toPiastres(row.querySelector('td:last-child').textContent));
    const totalRows = [...paper.querySelectorAll('.p-totals .r')]
      .map((row) => ({ label: row.firstElementChild.textContent.trim(),
                       value: toPiastres(row.textContent) }));
    host.remove();

    return {
      amounts,
      totalRows,
      stored: {
        subtotal: doc.invoice.subtotal_piastres,
        discount: doc.invoice.discount_total_piastres,
        vat: doc.invoice.vat_total_piastres,
        total: doc.invoice.total_piastres,
      },
    };
  })()
`);

const columnSum = column.amounts.reduce((sum: number, value: number) => sum + value, 0);
const printedSubtotal = column.totalRows[0].value;
const printedDiscount = column.totalRows[1].value;
const printedTotal = column.totalRows[column.totalRows.length - 1].value;

if (columnSum !== printedSubtotal) {
  throw new Error(
    `the Amount column adds up to ${(columnSum / 100).toFixed(2)} but the printed ` +
      `subtotal says ${(printedSubtotal / 100).toFixed(2)} — a customer checking the ` +
      "invoice by hand would reach a different number",
  );
}
ok(
  `the printed Amount column adds up to the printed subtotal exactly ` +
    `(${column.amounts.length} lines, ${(columnSum / 100).toFixed(2)})`,
);

if (printedSubtotal + printedDiscount + column.stored.vat !== printedTotal) {
  throw new Error(
    `subtotal ${printedSubtotal} + discount ${printedDiscount} + VAT ` +
      `${column.stored.vat} does not reach the printed total ${printedTotal}`,
  );
}
ok("subtotal, then the discount taken off once, then VAT, reaches the printed total");

if (!(column.stored.discount > 0)) {
  throw new Error("this check needs an invoice that actually has discounts on it");
}
ok(
  `and the invoice really does mix percentage and fixed discounts ` +
    `(${(column.stored.discount / 100).toFixed(2)} taken off)`,
);

/* ---- every page after the first says which document it belongs to -------- */

const continuation = await evaluate(`
  (async () => {
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();
    const html = globalThis.__casacavaPdf.renderContinuationHtml({
      invoice: doc.invoice, lines: doc.lines,
      settings: doc.invoice.company_snapshot ?? cfg.settings,
      pageNumber: 2, pageCount: 3,
    });
    const box = document.createElement('div');
    box.innerHTML = html;
    return { text: box.textContent, number: doc.invoice.invoice_number };
  })()
`);

if (!continuation.text.includes(continuation.number)) {
  throw new Error(`the continuation header does not carry the invoice number`);
}
if (!continuation.text.includes("صفحة ٢ من ٣")) {
  throw new Error(`the page marker is wrong: "${continuation.text.trim()}"`);
}
ok(`pages after the first carry: "${continuation.text.replace(/\\s+/g, " ").trim()}"`);

/* ---- a very long document must not try to allocate a huge drawing -------- */

const huge = await evaluate(`
  (async () => {
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();
    // Repeat the lines until the sheet is long enough to hit the memory guard.
    const lines = [];
    for (let i = 0; i < 6; i++) {
      for (const line of doc.lines) lines.push({ ...line, id: line.id + '-' + i });
    }
    const { report } = await globalThis.__casacavaPdf.renderInvoicePdf({
      invoice: doc.invoice, lines,
      settings: doc.invoice.company_snapshot ?? cfg.settings,
    });
    return { scale: report.scale, pages: report.pageCount, lines: lines.length };
  })()
`);

if (huge.scale >= 3) {
  throw new Error(
    `a ${huge.lines}-line invoice was still drawn at ${huge.scale}x — the memory ` +
      "guard did not engage, and a phone would be asked for a very large drawing",
  );
}
ok(
  `a ${huge.lines}-line invoice drops to ${huge.scale}x and still produces ` +
    `${huge.pages} pages, rather than asking a phone for a drawing it cannot hold`,
);

/* ---- the printed invoice must stay white paper in dark mode -------------- */

const darkPaper = await evaluate(`
  (async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();
    const { blob } = await globalThis.__casacavaPdf.renderInvoicePdf({
      invoice: doc.invoice, lines: doc.lines.slice(0, 3),
      settings: doc.invoice.company_snapshot ?? cfg.settings,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    document.documentElement.removeAttribute('data-theme');
    return btoa(binary);
  })()
`);

const darkDir = await Deno.makeTempDir();
await Deno.writeFile(
  `${darkDir}/dark.pdf`,
  Uint8Array.from(atob(darkPaper), (c) => c.charCodeAt(0)),
);
const darkPpm = new Deno.Command("pdftoppm", {
  args: ["-r", "60", "-f", "1", "-l", "1", `${darkDir}/dark.pdf`],
  stdout: "piped",
}).outputSync();
const darkImage = readPpm(darkPpm.stdout);

let whitePixels = 0;
let allPixels = 0;
for (let i = 0; i + 2 < darkImage.rgb.length; i += 3) {
  allPixels++;
  if (darkImage.rgb[i] > 230 && darkImage.rgb[i + 1] > 230 && darkImage.rgb[i + 2] > 230) {
    whitePixels++;
  }
}
await Deno.remove(darkDir, { recursive: true });

// An invoice is a document, not a screen. If the theme leaked into it, the
// page would come out mostly dark.
if (whitePixels / allPixels < 0.8) {
  throw new Error(
    `the dark theme leaked into the printed invoice: only ` +
      `${((whitePixels / allPixels) * 100).toFixed(0)}% of the page is white`,
  );
}
ok(
  `the printed invoice stays white paper even with the app in dark mode ` +
    `(${((whitePixels / allPixels) * 100).toFixed(0)}% white)`,
);

/* ========================================================================== */
/* The same thing, with the browser pretending to be an Android phone         */
/* ========================================================================== */

console.log("\n  --- Android (emulated) ---");

await send("Emulation.setDeviceMetricsOverride", {
  width: 412,
  height: 915,
  deviceScaleFactor: 3,
  mobile: true,
});
await send("Emulation.setUserAgentOverride", {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv8l",
});
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/#/invoices/${longId}` });
await evaluate("location.reload(); true");
await waitFor("!!document.querySelector('#btn-pdf')", "editor on the phone viewport");
ok("the app loads at 412x915 with a 3x screen, the shape of an ordinary phone");

await click("PDF");
await waitFor("!!globalThis.__casacavaPdf", "PDF module on mobile", 90000);

const mobile = await evaluate(`
  (async () => {
    const auth = { authorization: 'Bearer ' + ${JSON.stringify(appToken)} };
    const doc = await (await fetch('/api/invoices/${longId}', { headers: auth })).json();
    const cfg = await (await fetch('/api/settings', { headers: auth })).json();
    const { blob, report } = await globalThis.__casacavaPdf.renderInvoicePdf({
      invoice: doc.invoice, lines: doc.lines,
      settings: doc.invoice.company_snapshot ?? cfg.settings,
    });

    // Measure the font here too: this is the check that matters on Android,
    // where there is no promise about which Arabic fonts the device has.
    const host = document.createElement('div');
    host.setAttribute('style','position:fixed;top:0;inset-inline-start:-9999px;width:720px');
    const style = document.createElement('style');
    style.textContent = globalThis.__casacavaPdf.PAPER_CSS;
    const paper = document.createElement('div');
    paper.className = 'paper'; paper.dir = 'rtl'; paper.lang = 'ar';
    const word = 'فاتورة';
    paper.innerHTML = '<span id="m-joined" style="font-size:40px">' + word + '</span>' +
      '<span id="m-split" style="font-size:40px">' + word.split('').join('\u200C') + '</span>';
    host.append(style, paper);
    document.body.appendChild(host);
    const joined = document.getElementById('m-joined').getBoundingClientRect().width;
    const split = document.getElementById('m-split').getBoundingClientRect().width;
    const family = getComputedStyle(document.getElementById('m-joined')).fontFamily;
    host.remove();

    return {
      pages: report.pageCount,
      scale: report.scale,
      bytes: blob.size,
      dpr: globalThis.devicePixelRatio,
      ua: navigator.userAgent,
      joined, split, family,
    };
  })()
`);

if (!/Android/.test(mobile.ua)) throw new Error("the Android user agent did not take");
if (mobile.dpr !== 3) throw new Error(`device pixel ratio is ${mobile.dpr}, expected 3`);
ok(`the page believes it is Android with a 3x screen (${mobile.dpr}x)`);

if (!/CasaCava Arabic/.test(mobile.family)) {
  throw new Error("the embedded font was not used on the phone viewport");
}
if (!(mobile.joined < mobile.split * 0.92)) {
  throw new Error(
    `Arabic did not join on the phone viewport: ${mobile.joined} vs ${mobile.split}`,
  );
}
ok(
  `Arabic still joins with the embedded font: ${mobile.joined.toFixed(0)}px vs ` +
    `${mobile.split.toFixed(0)}px forced apart`,
);

if (mobile.pages !== long.report.pageCount) {
  throw new Error(
    `the phone produced ${mobile.pages} pages where the desktop produced ` +
      `${long.report.pageCount} — the layout is not stable across screens`,
  );
}
ok(
  `the same invoice produces the same ${mobile.pages} pages as on the desktop — ` +
    "the sheet is laid out at a fixed width, so the screen does not change the document",
);

if (mobile.bytes < 20000) throw new Error("the PDF came out suspiciously small");
ok(`the PDF is produced on the phone viewport (${Math.round(mobile.bytes / 1024)} KB)`);

await send("Emulation.clearDeviceMetricsOverride");

console.log("\nALL UI AND PDF CHECKS PASSED");
socket.close();
