/**
 * The printed invoice.
 *
 * The layout is carried over from the old Casa Cava app: the mark on the left,
 * the document title and number on the right, the company block, a three-part
 * meta row, the item table, a totals block, then notes and terms. The brand
 * colour is the same #a06e4e.
 *
 * What is new is that it renders in EITHER direction. The sheet gets dir="rtl"
 * or dir="ltr" from the invoice's own language and every rule below uses
 * logical properties, so the table columns, the totals block and the label
 * alignment all mirror — it is not the same layout with the words swapped.
 *
 * Every number is wrapped so it cannot flip inside Arabic text. Without that,
 * "1,080.00" next to Arabic words can render reversed, and "14%" comes out as
 * "%14".
 */
import type { Invoice, InvoiceLine, Lang, Settings } from "../api/types.ts";
import { formatPiastres, formatQuantity } from "../../../src/lib/money.ts";
import { amountInArabicWords } from "../../../src/lib/words_ar.ts";
import { amountInEnglishWords } from "../../../src/lib/words_en.ts";
import { DOCUMENT_LABELS } from "./labels.ts";
import { ARABIC_FONT_CSS, LOGO_SVG } from "./assets.ts";

const BRAND = "#a06e4e";

export const PAPER_CSS = `
${ARABIC_FONT_CSS}

.paper {
  --ink: #1c1815; --muted: #6f655d; --line: #e4dfd9;
  --band: #f4f1ee; --brand: ${BRAND};
  background: #fff; color: var(--ink);
  font-family: "CasaCava Arabic", system-ui, sans-serif;
  font-size: 13px; line-height: 1.55;
  font-variant-numeric: tabular-nums;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  padding: 0; margin: 0;
}

/* Numbers never flip, in either direction. */
.paper .n { unicode-bidi: isolate; direction: ltr; white-space: nowrap; }

/* The masthead keeps the mark on the left in both languages, as it does on
   the invoices Casa Cava already sends. */
.p-head { display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; direction: ltr; }
.p-logo svg { width: auto; height: 74px; display: block; }
.p-logo img { max-height: 74px; max-width: 180px; display: block; }
.p-title { text-align: right; }
.p-title h1 { margin: 0; font-size: 30px; font-weight: 700; line-height: 1.1; color: var(--ink); }
.p-num { color: var(--muted); font-size: 14px; margin-top: 6px; font-weight: 600; }

.p-biz { margin-top: 22px; font-weight: 600; }
.p-biz .reg { font-weight: 400; color: var(--muted); font-size: 11.5px; margin-top: 3px; }

.p-meta { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px;
          margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--line); }
.p-label { color: var(--muted); font-size: 11.5px; margin-bottom: 3px; }
.p-val { font-weight: 600; white-space: pre-line; }
.p-dates { display: grid; gap: 5px; align-content: start; }
.p-dates .r { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.p-dates .l { color: var(--muted); font-size: 11.5px; white-space: nowrap; }
.p-dates .v { font-weight: 600; text-align: end; }

.p-items { width: 100%; border-collapse: collapse; margin-top: 26px; }
.p-items th { background: var(--band); font-size: 11.5px; font-weight: 600;
              padding: 10px 8px; text-align: end; border-bottom: 1px solid var(--line); }
.p-items td { padding: 11px 8px; border-bottom: 1px solid var(--line);
              text-align: end; vertical-align: top; }
.p-items th.desc, .p-items td.desc { text-align: start; }
.p-items td.desc { font-weight: 600; overflow-wrap: anywhere; }
.p-items td.desc .unit { display: block; font-weight: 400; color: var(--muted); font-size: 11px; }
.p-empty td { color: var(--muted); text-align: center; padding: 20px; }

.p-totals { width: min(100%, 340px); margin-inline-start: auto; margin-top: 18px; }
.p-totals .r { display: flex; justify-content: space-between; gap: 12px;
               padding: 10px 8px; border-bottom: 1px solid var(--line); }
.p-totals .grand { font-weight: 700; font-size: 15px; background: var(--band); border-bottom: 0; }

.p-words { margin-top: 14px; padding: 11px 12px; background: var(--band);
           border-inline-start: 3px solid var(--brand); }
.p-words .p-label { margin-bottom: 2px; }
.p-words .t { font-weight: 600; }

.p-notes, .p-terms { margin-top: 22px; }
.p-notes p, .p-terms p { margin: 0; white-space: pre-line; font-size: 12.5px; }

.p-stamp { margin-top: 18px; display: inline-block; padding: 4px 12px;
           border: 2px solid #b4423a; color: #b4423a; font-weight: 700;
           letter-spacing: .5px; border-radius: 4px; }
.p-stamp.draft { border-color: var(--muted); color: var(--muted); }
`;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wrap a number so it cannot reverse inside an Arabic paragraph. */
function num(text: string): string {
  return `<span class="n">${esc(text)}</span>`;
}

function money(piastres: number, currency: string): string {
  return num(`${formatPiastres(piastres)} ${currency}`);
}

export interface PaperInput {
  invoice: Invoice;
  lines: InvoiceLine[];
  settings: Partial<Settings>;
  /** Overrides the invoice's own language. Only used by the preview. */
  language?: Lang;
}

export function renderPaperHtml({ invoice, lines, settings, language }: PaperInput): string {
  const lang: Lang = language ?? invoice.document_language;
  const L = DOCUMENT_LABELS[lang];
  const currency = lang === "ar" ? "جنيه" : "EGP";
  const pick = (arValue?: string | null, enValue?: string | null) =>
    ((lang === "ar" ? arValue : enValue) || (lang === "ar" ? enValue : arValue) || "").trim();

  const title = invoice.document_type === "credit_note"
    ? L.creditNote
    : invoice.document_type === "debit_note"
    ? L.debitNote
    : L.invoice;

  const logo = settings.logo_data_url
    ? `<img src="${esc(settings.logo_data_url)}" alt="">`
    : LOGO_SVG;

  const companyName = pick(settings.trade_name_ar, settings.trade_name_en) ||
    pick(settings.legal_name_ar, settings.legal_name_en);
  const legalName = pick(settings.legal_name_ar, settings.legal_name_en);

  const registrations = [
    settings.tax_registration_number
      ? `${esc(L.taxNumber)}: ${num(settings.tax_registration_number)}`
      : "",
    settings.commercial_register_number
      ? `${esc(L.commercialRegister)}: ${num(settings.commercial_register_number)}`
      : "",
    settings.phone ? `${esc(L.phone)}: ${num(settings.phone)}` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  // Extra columns only appear when they are actually used, so an ordinary
  // invoice keeps the clean four-column table it has today.
  // The subtotal is printed BEFORE discount, so the block a customer reads
  // actually adds up: subtotal - discount + VAT = total. The stored
  // subtotal_piastres is the figure after discount, so the discount is added
  // back for display only.
  const anyDiscount = lines.some((line) => line.discount_piastres > 0);
  const anyVat = lines.some((line) => line.vat_piastres > 0);

  const head = [
    `<th class="desc">${esc(L.item)}</th>`,
    `<th>${esc(L.quantity)}</th>`,
    `<th>${esc(L.unitPrice)}</th>`,
    anyDiscount ? `<th>${esc(L.discount)}</th>` : "",
    anyVat ? `<th>${esc(L.vat)}</th>` : "",
    `<th>${esc(L.amount)}</th>`,
  ].filter(Boolean).join("");

  const body = lines.length === 0
    ? `<tr class="p-empty"><td colspan="6">${esc(L.noItems)}</td></tr>`
    : lines.map((line) => {
      const unit = pick(line.unit_ar, line.unit_en);
      return `<tr>` +
        `<td class="desc">${esc(pick(line.name_ar, line.name_en))}` +
        (unit ? `<span class="unit">${esc(unit)}</span>` : "") +
        `</td>` +
        `<td>${num(formatQuantity(line.quantity_milli))}</td>` +
        `<td>${money(line.unit_price_piastres, currency)}</td>` +
        (anyDiscount
          ? `<td>${line.discount_piastres > 0 ? money(line.discount_piastres, currency) : "—"}</td>`
          : "") +
        (anyVat
          ? `<td>${num(`${line.vat_rate_bp / 100}%`)}</td>`
          : "") +
        // The Amount column is BEFORE this line's discount, so adding the
        // column up lands exactly on the subtotal below it. The discount is
        // then taken off once, in its own row.
        `<td>${money(line.gross_piastres, currency)}</td>` +
        `</tr>`;
    }).join("");

  const words = lang === "ar"
    ? amountInArabicWords(invoice.total_piastres)
    : amountInEnglishWords(invoice.total_piastres);

  const customerLines = [
    pick(invoice.customer_name_ar, invoice.customer_name_en),
    invoice.customer_address ?? "",
  ].filter((value) => value.trim()).join("\n");

  const customerExtras = [
    invoice.customer_phone ? `${esc(L.phone)}: ${num(invoice.customer_phone)}` : "",
    invoice.customer_tax_registration_number
      ? `${esc(L.taxNumber)}: ${num(invoice.customer_tax_registration_number)}`
      : "",
  ].filter(Boolean).join("<br>");

  const notes = (invoice.notes ?? "").trim();
  const paymentTerms = (invoice.payment_terms ?? "").trim() ||
    pick(settings.payment_terms_ar, settings.payment_terms_en);
  const footer = pick(settings.footer_note_ar, settings.footer_note_en);
  const terms = pick(settings.terms_ar, settings.terms_en);

  const stamp = invoice.doc_status === "cancelled"
    ? `<div class="p-stamp">${esc(L.cancelled)}</div>`
    : invoice.doc_status === "draft"
    ? `<div class="p-stamp draft">${esc(L.draft)}</div>`
    : "";

  return `
<div class="p-head">
  <div class="p-logo">${logo}</div>
  <div class="p-title">
    <h1>${esc(title)}</h1>
    <div class="p-num">${invoice.invoice_number ? num(invoice.invoice_number) : esc(L.draft)}</div>
  </div>
</div>

<div class="p-biz">
  <div>${esc(companyName)}</div>
  ${legalName && legalName !== companyName ? `<div class="reg">${esc(legalName)}</div>` : ""}
  ${
    pick(settings.address_ar, settings.address_en)
      ? `<div class="reg">${esc(pick(settings.address_ar, settings.address_en))}</div>`
      : ""
  }
  ${registrations ? `<div class="reg">${registrations}</div>` : ""}
</div>

<div class="p-meta">
  <div>
    <div class="p-label">${esc(L.billTo)}</div>
    <div class="p-val">${esc(customerLines)}</div>
    ${customerExtras ? `<div class="reg" style="margin-top:4px">${customerExtras}</div>` : ""}
  </div>
  <div class="p-dates">
    ${
    invoice.issue_date
      ? `<div class="r"><span class="l">${esc(L.issueDate)}</span><span class="v">${
        num(invoice.issue_date)
      }</span></div>`
      : ""
  }
    ${
    invoice.references_invoice_id
      ? `<div class="r"><span class="l">${esc(L.corrects)}</span><span class="v">${
        num(invoice.references_invoice_number ?? invoice.references_invoice_id.slice(0, 18))
      }</span></div>`
      : ""
  }
    ${
    paymentTerms
      ? `<div class="r"><span class="l">${esc(L.paymentTerms)}</span><span class="v">${
        esc(paymentTerms)
      }</span></div>`
      : ""
  }
  </div>
</div>

<table class="p-items">
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>

<div class="p-totals">
  <div class="r"><span>${esc(L.subtotal)}</span>${
    money(invoice.subtotal_piastres + invoice.discount_total_piastres, currency)
  }</div>
  ${
    invoice.discount_total_piastres > 0
      ? `<div class="r"><span>${esc(L.discountTotal)}</span>${
        num(`-${formatPiastres(invoice.discount_total_piastres)} ${currency}`)
      }</div>`
      : ""
  }
  <div class="r"><span>${esc(L.vatTotal)}</span>${
    money(invoice.vat_total_piastres, currency)
  }</div>
  <div class="r grand"><span>${esc(L.total)}</span>${
    money(invoice.total_piastres, currency)
  }</div>
</div>

<div class="p-words">
  <div class="p-label">${esc(L.amountInWords)}</div>
  <div class="t">${esc(words)}</div>
</div>

${
    notes
      ? `<div class="p-notes"><div class="p-label">${esc(L.notes)}</div><p>${esc(notes)}</p></div>`
      : ""
  }
${
    footer
      ? `<div class="p-notes"><p>${esc(footer)}</p></div>`
      : ""
  }
${
    terms
      ? `<div class="p-terms"><div class="p-label">${esc(L.terms)}</div><p>${esc(terms)}</p></div>`
      : ""
  }
${stamp}
`;
}

/* -------------------------------------------------------------------------- */
/* The strip that repeats at the top of every page after the first            */
/* -------------------------------------------------------------------------- */

/** Arabic-Indic digits, for the page marker only. Amounts stay in Western digits. */
function arabicDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

export const CONTINUATION_CSS = `
.p-cont {
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: "CasaCava Arabic", system-ui, sans-serif;
  font-size: 12px; color: #6f655d;
  padding-bottom: 6px; border-bottom: 1px solid #e4dfd9;
  background: #fff;
}
.p-cont .who { font-weight: 700; color: #1c1815; }
.p-cont .n { unicode-bidi: isolate; direction: ltr; white-space: nowrap; }
`;

/**
 * Page two onwards would otherwise be an anonymous sheet of numbers. This puts
 * the document's identity and its place in the set at the top of each one, so
 * a page that gets separated can still be matched back to its invoice.
 */
export function renderContinuationHtml(
  { invoice, settings, language, pageNumber, pageCount }: PaperInput & {
    pageNumber: number;
    pageCount: number;
  },
): string {
  const lang: Lang = language ?? invoice.document_language;
  const L = DOCUMENT_LABELS[lang];
  const pick = (arValue?: string | null, enValue?: string | null) =>
    ((lang === "ar" ? arValue : enValue) || (lang === "ar" ? enValue : arValue) || "").trim();

  const title = invoice.document_type === "credit_note"
    ? L.creditNote
    : invoice.document_type === "debit_note"
    ? L.debitNote
    : L.invoice;

  const company = pick(settings.trade_name_ar, settings.trade_name_en) ||
    pick(settings.legal_name_ar, settings.legal_name_en);

  const marker = lang === "ar"
    ? `${L.page} ${arabicDigits(String(pageNumber))} ${L.pageOf} ${arabicDigits(String(pageCount))}`
    : `${L.page} ${pageNumber} ${L.pageOf} ${pageCount}`;

  return `<div class="p-cont">` +
    `<span class="who">${esc(company)}</span>` +
    `<span>${esc(title)} ${
      invoice.invoice_number ? `<span class="n">${esc(invoice.invoice_number)}</span>` : ""
    }</span>` +
    `<span>${esc(marker)}</span>` +
    `</div>`;
}
