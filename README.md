# Casa Cava Invoicing

Internal invoicing for Casa Cava. Separate system and separate database from
the casacavco.com storefront.

One server (Cloudflare Workers + D1), one database, four ways to reach it:
a web app, a Windows installer, a Linux AppImage and an Android APK. The
packaged apps are thin clients — they hold no database of their own, so both
users always see the same invoices.

---

## What is built right now

This is the foundation layer: the parts where a mistake is expensive and
invisible. All of it is tested, and the tests run in about three seconds.

| Piece | Where | Tests |
|---|---|---|
| Database schema | `db/migrations/0001_init.sql` | — |
| Immutability triggers | `db/migrations/0002_immutability.sql` | 21 |
| Spent-number audit record | `db/migrations/0003_unused_numbers.sql` | (in the API tests) |
| Money and rounding | `src/lib/money.ts` | 28 |
| Amount in words (Arabic + English) | `src/lib/words_ar.ts`, `src/lib/words_en.ts` | 18 |
| Passwords and session tokens | `src/lib/password.ts` | 14 |
| Product CSV importer | `tools/import_items.ts` | 8 |
| **Worker API** | `src/worker/` | **35** |
| End-to-end: catalogue → issued invoice | `tests/end_to_end_test.ts` | 2 |

```sh
deno task test     # run all 126
deno task check    # type-check everything
```

There is no `node_modules` and nothing to install. Deno runs the TypeScript
directly and brings its own SQLite and crypto.

**The web app** is in `web/` — React 19 + Vite 6, run by Deno, no npm needed.

```sh
deno task build:web     # build it into web/dist
deno task dev:server    # run the whole thing locally, no Cloudflare needed
deno task ui:check      # drive it in headless Chrome (needs Chrome)
deno task samples       # write four real PDFs into samples/
```

`deno task dev:server` runs the real Worker code against an in-memory SQLite
with the real migrations and triggers, and serves the built app. It prints a
login on startup. Nothing is saved: it is for looking at the app and for the
automated checks.

## The PDF

`deno task samples` writes four real PDFs into `samples/` — an Arabic invoice,
the same invoice in English, one with deliberately long text, and a credit
note. They are produced by driving the actual button in the actual app, not by
a special code path.

The page is laid out as ordinary HTML, the browser draws it, and the drawing
goes into the PDF. That is deliberate: **the browser is the one thing that
reliably shapes and joins Arabic**, including inside the Android WebView.
Drawing the text glyph by glyph would mean carrying an Arabic shaping engine
and owning every ligature — the part most likely to be quietly wrong.

The cost is that the text is a picture rather than selectable text. For a
customer copy that costs nothing; the tax authority receives structured data in
phase 2, not this file.

**The Arabic font is embedded in the app**, not taken from the device. There is
no promise about which fonts an Android WebView has, and a missing Arabic font
is exactly how letters end up sitting apart instead of joining.

**The Amount column adds up.** Each line's Amount is shown BEFORE that line's
discount, so adding the column with a pen lands exactly on the printed
subtotal. The discount is then taken off once, in its own row, and VAT added:
subtotal − discount + VAT = total. A check reads those numbers back off the
rendered sheet and refuses to pass unless the column sums to the subtotal
exactly.

**Long invoices.** A page may end after a table row, or before the totals — but
never inside the totals block or the amount in words. Every page after the
first carries the company name, the document number and "صفحة ٢ من ٣ /
Page 2 of 3", drawn by the browser so the Arabic joins.

**No wasted last page.** If the spill onto a final page would leave it less
than a quarter full, the document is shrunk very slightly (up to 8%) to fit on
one page fewer. Checked across invoices from 1 to 45 lines.

**Very long invoices.** The drawing is held in memory at four bytes a pixel. Past
24 megapixels the magnification steps down (3x → 2x → 1.5x), because a slightly
softer PDF is better than a phone that fails. A 132-line invoice drops to 1.5x
and still produces all 11 pages.

## What is not built yet

The three packaged builds — the GitHub Actions workflow that produces the
Windows installer, the Linux AppImage and the Android APK.

---

## The API

One Worker serves both the app and `/api/*`. That is deliberate: it makes the
browser build same-origin, so it needs no CORS and can use an ordinary session
cookie. Only the packaged Tauri builds call in from another origin, and they
send a bearer token instead — the same login returns both, and the server
accepts either.

| | |
|---|---|
| `POST /api/auth/login` | email + client secret → token and cookie |
| `POST /api/auth/logout` · `GET/PUT /api/auth/me` | session, and the language preference |
| `GET/PUT /api/settings` | company details, and the VAT switch |
| `GET /api/items` · `PUT /api/items/:id` · `DELETE /api/items/:id` | delete deactivates |
| `GET /api/customers` · `PUT /api/customers/:id` · `DELETE /api/customers/:id` | |
| `GET /api/invoices` | `?status=&type=&from=&to=&q=&limit=&offset=` |
| `GET/PUT/DELETE /api/invoices/:id` | PUT saves a draft; DELETE only works on drafts |
| `POST /api/invoices/:id/issue` | takes the number and freezes the document |
| `POST /api/invoices/:id/cancel` | needs a reason |
| `POST /api/invoices/:id/credit-note` | makes a new draft pointing at the original |

**Two rules the API enforces:**

1. **The server does the arithmetic.** The app may send a price and a quantity.
   It may not send a total — anything it claims a line adds up to is discarded
   and recomputed by `src/lib/money.ts`.
2. **Details are copied onto the document.** Customer, company and each product
   are snapshotted at save time. Nothing joins an issued invoice back to a live
   record, so a price rise next month cannot rewrite last month's invoice. There
   is a test that raises a price and checks the issued invoice did not move.

**Draft ids come from the device.** A draft written on a phone with no signal
invents its own id, and sends that same id when the signal returns, so syncing
updates the draft rather than creating a second copy.

**A failed issue leaves a gap in the numbering, and the gap is recorded.**
The number is allocated, then the document is stamped. If the second step
fails the number is spent and the series skips one — a gap is a harmless
irregularity, a repeated invoice number is a serious one.

Because a missing invoice number gets asked about in a tax audit, every spent
number is written into `unused_invoice_numbers` at the moment it happens, with
the timestamp, the user, the draft it was meant for, and the reason it failed.
That table is append-only: the database refuses to update or delete a row in
it, because a record of a gap that could be tidied away afterwards would be
worth nothing to an inspector.

The draft itself is untouched by a failed issue. Issuing it again gives it the
**next** number; the spent one is never reused.

`GET /api/unused-numbers` returns two lists:

- **recorded** — what the software wrote down as it happened. This is the list
  to show an inspector.
- **unexplained** — computed fresh by walking the series looking for numbers
  that are on no document and in no record. It exists so a gap still surfaces
  even if the recording itself failed. It should normally be empty.

**The app must show this** on the invoice list screen, so the gaps are visible
without having to go asking. Not built yet — the UI does not exist.

## Deploying

```sh
npx wrangler d1 create casacava-invoice     # put the id into wrangler.jsonc
deno task build:web                         # produces web/dist (once the UI exists)
npx wrangler deploy
```

The Worker serves `web/dist` as static assets. Requests for those files are
free and do not run the Worker at all, so the free plan's request budget is
spent only on real API calls.

---

## The rounding rule

Money is stored as a whole number of **piastres** (1 EGP = 100). Quantities
are stored as whole numbers **scaled by 1000** (1.5 kg is 1500), which gives
exactly three decimal places. VAT and percentage discounts are stored in
**basis points** (14% is 1400). No amount is ever a decimal number, so
nothing can drift.

Each line is calculated in this order, and **each step is rounded half-up to
the whole piastre** — an exact half piastre rounds up:

| Step | Calculation |
|---|---|
| 1. Gross | `unit price × quantity ÷ 1000` |
| 2. Discount | percent: `gross × rate ÷ 10000` · fixed: the amount as entered |
| 3. Net | `gross − discount` |
| 4. VAT | `net × VAT rate ÷ 10000` |
| 5. Line total | `net + VAT` |

The invoice subtotal, VAT total and total are then **plain sums of numbers
that are already whole piastres**. No rounding happens a second time.

Rounding per line rather than at the end is deliberate: it is what makes the
printed VAT column add up to the printed VAT total. A customer checking the
arithmetic by hand reaches the same figure. `tests/money_test.ts` proves this
over 300 generated lines, and a separate test pins the choice so it cannot
drift later.

## The VAT switch

Casa Cava is not VAT-registered today, so the seeded rate is **0%**.

An item's `vat_rate_bp` is normally **empty**, which means "follow the company
default". Only items that need a different rate carry their own.

**On the day you register**, change one number — `default_vat_rate_bp` in
`company_settings` from `0` to `1400` — and every item that has no rate of
its own moves to 14% at once. No migration, no bulk edit, and invoices
already issued do not change, because each line carries a frozen copy of the
rate that applied when it was issued.

## Immutability

A document can be edited only while it is a **draft**. This is enforced by the
database itself, not just by the app hiding a button. Confirmed against a live
Cloudflare D1 instance, not only local SQLite.

Once a document is issued:

- no column of it can be changed, and it cannot be deleted;
- none of its lines can be edited, added or removed;
- it cannot be flipped back to draft;
- a column that was empty at issue time cannot be quietly filled in later.

Exactly two things are still allowed, and nothing else:

1. **Cancelling it** — `issued → cancelled`, once, recording who and why.
   Those fields cannot be rewritten afterwards.
2. **The six tax-authority columns** (`eta_*`, `submitted_at`), so the phase-2
   e-invoicing integration can record what the ETA said without touching the
   document.

Corrections are never edits. A credit note is a **new document** that points
at the original through `references_invoice_id`; the original stays exactly
as it was issued.

There is one test you should know about, `MUTATION CHECK` in
`tests/immutability_test.ts`. The triggers compare columns with SQL's `IS`
rather than `=`, because `NULL = NULL` is not true, and a trigger written the
obvious way would silently allow any empty column on an issued invoice to be
filled in later. That test builds the broken version on purpose and proves
the hole is real, so the protection cannot quietly become decorative.

## Invoice numbers

`INV-2026-001`, padded to three digits to match the invoices Casa Cava already
sends. The series restarts each year and the year is part of the number, so
`INV-2026-001` and `INV-2027-001` are different documents.

Padding is cosmetic and never truncates: invoice 1000 is `INV-2026-1000`, not
`INV-2026-000`. To change the width, set `pad_width` in `document_counters`.
Credit notes (`CN-`) and debit notes (`DN-`) run their own series.

A number is taken at the **moment of issuing**, never when a draft is created,
by a single database statement that both increments the counter and returns
the new number. Two devices issuing at the same instant cannot receive the
same number. The counter cannot be wound backwards.

This is also why **issuing needs a live connection**: a number handed out
offline would eventually collide with one handed out on the other device.
Drafts work offline; issuing does not.

## Passwords

The password never leaves the device.

```
password → (device: 210,000 PBKDF2 rounds) → client secret
         → sent over HTTPS →
           (server: salted PBKDF2 again)   → verifier → stored
```

The slow part runs on the phone or the laptop, because Cloudflare's free plan
allows only 10 ms of CPU per request — nowhere near enough for a real password
hash. Measured: the server's share takes **0.53 ms**, about 19× inside budget.

The stored verifier is deliberately **not** the value the app sends. If it
were, a copy of the database would be a working password: anyone holding it
could send the stored value straight to the login endpoint. `tests/password_test.ts`
carries out exactly that attack and proves it fails.

---

## Backing up — Egyptian law requires 5 years

Tax documents must be kept and retrievable for at least five years. D1 is
Cloudflare's copy; it is not your copy. Keep your own.

**One export, by hand:**

```sh
npx wrangler d1 export casacava-invoice --remote --output=casacava-YYYY-MM-DD.sql
```

That file is a complete, plain-text SQL dump — schema and every row. It can be
read with any SQLite tool and restored into a fresh database with
`wrangler d1 execute --file=`. Keep it even if the app or Cloudflare goes away.

**Automatically, every week, at no cost:** a scheduled GitHub Actions workflow
runs the same command and commits the dump to a **private** repository. That
gives you an off-site copy with a date-stamped history, inside the free tier.
(Set up alongside the build workflow — not written yet.)

**Where to keep them.** At least two places, one not on this machine:

1. the private GitHub repository (automatic, off-site, versioned);
2. a folder you control — external drive or cloud storage — copied at least
   at the end of every financial year;
3. before any schema change, take a manual export first.

A yearly export should be treated as the permanent record for that year and
kept for five full years after the end of that year.

## Importing products

`tools/import_items.ts` turns a CSV into SQL.

```sh
deno run --allow-read tools/import_items.ts db/seed_items.csv > items.sql
npx wrangler d1 execute casacava-invoice --remote --file=items.sql
```

**If your storefront export has different column headings**, edit only the
`COLUMN_MAP` block at the top of that file — nothing else. It lists, for each
database field, the headings to look for; put yours first. Matching ignores
case, spaces and underscores, and reads Arabic headings too. If it cannot find
a name or a price column it stops and tells you which headings it did see,
rather than importing an empty catalogue.

Prices are read as EGP and stored as piastres. A blank VAT column means the
item follows the company default. Re-importing the same file updates prices
instead of creating duplicates.

`db/seed_items.csv` currently holds the 23 products from the old app, with
retail and wholesale prices. **The English names in it are translations I
wrote — please read them before sending an English invoice.** Replace this
file with the real storefront export when you have it; the command is the
same.

## Setting up the two logins

```sh
deno run --allow-all tools/seed_user.ts omar@casacavco.com "Omar" ar  > users.sql
deno run --allow-all tools/seed_user.ts mum@casacavco.com  "Mum"  ar >> users.sql
npx wrangler d1 execute casacava-invoice --remote --file=users.sql
```

It asks for the password without showing it and never writes it anywhere.
Minimum ten characters — this is the only lock on five years of tax records.

## Creating the database

```sh
npx wrangler d1 create casacava-invoice
npx wrangler d1 execute casacava-invoice --remote --file=db/migrations/0001_init.sql
npx wrangler d1 execute casacava-invoice --remote --file=db/migrations/0002_immutability.sql
npx wrangler d1 execute casacava-invoice --remote --file=db/seed_company.sql
```

Edit `db/seed_company.sql` first — legal name, tax registration number,
commercial register number and address print on every invoice.

---

## The interface

**Two languages, one toggle.** Every string lives in `web/src/i18n/en.ts` and
`web/src/i18n/ar.ts`. Nothing is written inside a component.

**Settings that print on the invoice are shown as pairs** — Arabic beside
English — and say so plainly when one side is empty: *"No English version. An
English invoice will print the Arabic text here."* The company name, legal
name, address, payment terms, footer note and terms all work this way, because
an empty English box is otherwise invisible while the app itself is in Arabic.

**To add a string:** add the key to `en.ts`, then add the same key to `ar.ts`.
`ar.ts` is typed against `en.ts`, so a key added to one and forgotten in the
other is a build error naming the missing key — not English text appearing in
the Arabic interface later on.

**Arabic mirrors the whole layout**, not just the text. Setting `dir="rtl"` on
the document flips the navigation, the form labels, the totals block and the
line editor, because every rule in `web/src/ui/styles.css` uses logical
properties (`margin-inline-start`, `text-align: start`) rather than left and
right. Amounts, phone numbers and invoice numbers stay left-to-right inside an
Arabic page, since a number is not a sentence.

**The invoice's language is its own.** It is chosen per invoice and is
independent of the app's language — working in Arabic and sending an English
invoice is the normal case. The amount in words follows the invoice, not the
interface.

**Phone first.** Single column, 44px tap targets, safe-area padding, and a
bottom navigation bar that stays reachable with one hand.

## What `deno task ui:check` proves

It drives a real browser and asserts on what is actually rendered, rather than
on what the code intended:

- the app comes up in Arabic, right to left, and the toggle mirrors the whole
  layout;
- signing in works through the real password flow;
- totals and the amount in words are right on screen;
- issuing asks first, and locks every field afterwards;
- **Arabic letters join** — measured by comparing the width of a word against
  the same letters forced apart with zero-width non-joiners;
- **numbers keep their order inside Arabic text** — the character positions of
  "-1,234.50" and "14%" are measured, not assumed;
- the brand colour is still #a06e4e and the mark is still printed at the top of
  the page, counted in the pixels of the finished PDF;
- a long invoice never has its totals split by a page break, and the pages
  together cover the whole document;
- the printed Amount column adds up to the printed subtotal, on an invoice
  mixing percentage and fixed discounts;
- pages after the first carry the invoice number and a page marker;
- no invoice ends on a nearly empty page.

**On Android:** the check re-runs the PDF path with the browser emulating a
phone — 412x915, 3x screen, Android user agent — and confirms the embedded font
still joins and the same invoice produces the same pages. That is Chromium
emulating a phone, **not a real Android WebView**. A genuine device test needs
the Android SDK and an emulator, which is not installed here. Treat Android as
strongly indicated, not proven, until the APK is in your hands.

## Working without a signal

| | |
|---|---|
| Reading products, customers, settings, recent invoices | works offline, from a local copy |
| Creating and editing **drafts** | works offline, queued in IndexedDB and sent on reconnect |
| **Issuing** | needs a connection, and says so plainly |

Issuing is the deliberate exception. A number can only be handed out by the
server; if a device could allocate one offline, two phones would eventually
stamp the same number on two different invoices. The app explains this rather
than failing quietly.

A draft written offline carries the id the device gave it, so when it syncs it
updates that draft instead of creating a second copy of it.

---

## Layout

```
db/migrations/   the schema, applied in order and never edited afterwards
db/seed_*        starting data: your company details, the number series, products
src/lib/         the calculations — money, words, passwords (shared by server and app)
src/worker/      the API
tests/           126 tests
tools/           one-off scripts: importing products, creating a login
```
