/**
 * Money and quantity arithmetic for Casa Cava invoices.
 *
 * THE RULES, in one place:
 *
 *  - Money is always an INTEGER number of piastres. 1 EGP = 100 piastres.
 *    12.34 EGP is the number 1234. There are no floating-point amounts.
 *  - Quantity is always an INTEGER scaled by 1000. 1.5 kg is the number 1500.
 *    That gives exactly 3 decimal places, which is the maximum allowed.
 *  - Rates (VAT, percentage discount) are in basis points. 14% is 1400,
 *    100% is 10000, 0% is 0.
 *
 * ROUNDING happens only inside a line, never at the document level:
 *
 *    1. gross    = round(unit_price x quantity / 1000)
 *    2. discount = percent -> round(gross x rate / 10000)
 *                  amount  -> the amount as entered
 *    3. net      = gross - discount
 *    4. vat      = round(net x vat_rate / 10000)
 *    5. total    = net + vat
 *
 *    Rounding is HALF-UP: exactly half a piastre rounds away from zero.
 *
 *    Document subtotal / VAT / total are then plain integer sums of values
 *    that are already whole piastres. No rounding is applied a second time,
 *    so the printed VAT column always adds up to the printed VAT total.
 *
 * Multiplication is done in BigInt, so an amount can never silently lose
 * precision the way a large float would.
 */

export type DiscountType = "none" | "percent" | "amount";

export interface LineInput {
  /** Whole piastres. 10.00 EGP = 1000. */
  unitPricePiastres: number;
  /** Thousandths of a unit. 1.5 kg = 1500. Must be greater than zero. */
  quantityMilli: number;
  /** Basis points. 14% = 1400. Must be 0..10000. */
  vatRateBp: number;
  discountType: DiscountType;
  /** Basis points when percent, piastres when amount, 0 when none. */
  discountValue: number;
}

export interface LineTotals {
  grossPiastres: number;
  discountPiastres: number;
  netPiastres: number;
  vatPiastres: number;
  totalPiastres: number;
}

export interface DocumentTotals {
  /**
   * The sum of the lines BEFORE any line discount — the figure the Amount
   * column on the printed invoice adds up to. Always equals
   * subtotalPiastres + discountTotalPiastres.
   */
  grossTotalPiastres: number;
  /** After line discounts, before VAT. */
  subtotalPiastres: number;
  discountTotalPiastres: number;
  vatTotalPiastres: number;
  totalPiastres: number;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const MILLI_PER_UNIT = 1000n;
const BP_PER_WHOLE = 10000n;

/**
 * Divide and round half-up (away from zero on an exact half).
 * BigInt division truncates toward zero, so the sign is handled explicitly.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new MoneyError("denominator must be positive");
  }
  const half = denominator / 2n;
  return numerator >= 0n
    ? (numerator + half) / denominator
    : -((-numerator + half) / denominator);
}

function requireInteger(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${name} must be a whole number, got ${String(value)}`);
  }
}

function toSafeNumber(value: bigint, name: string): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new MoneyError(`${name} is too large to represent exactly`);
  }
  return Number(value);
}

/**
 * An item's VAT rate may be NULL, meaning "follow the company default".
 * This is what lets the whole catalogue move from 0% to 14% by changing one
 * settings row. The resolved number is what gets frozen onto an invoice line.
 */
export function resolveVatRateBp(
  itemVatRateBp: number | null | undefined,
  companyDefaultVatRateBp: number,
): number {
  requireInteger(companyDefaultVatRateBp, "companyDefaultVatRateBp");
  if (companyDefaultVatRateBp < 0 || companyDefaultVatRateBp > 10000) {
    throw new MoneyError("companyDefaultVatRateBp must be between 0 and 10000");
  }
  if (itemVatRateBp === null || itemVatRateBp === undefined) {
    return companyDefaultVatRateBp;
  }
  requireInteger(itemVatRateBp, "itemVatRateBp");
  if (itemVatRateBp < 0 || itemVatRateBp > 10000) {
    throw new MoneyError("itemVatRateBp must be between 0 and 10000");
  }
  return itemVatRateBp;
}

export function computeLine(input: LineInput): LineTotals {
  const { unitPricePiastres, quantityMilli, vatRateBp, discountType } = input;
  const discountValue = input.discountValue ?? 0;

  requireInteger(unitPricePiastres, "unitPricePiastres");
  requireInteger(quantityMilli, "quantityMilli");
  requireInteger(vatRateBp, "vatRateBp");
  requireInteger(discountValue, "discountValue");

  if (unitPricePiastres < 0) throw new MoneyError("unitPricePiastres cannot be negative");
  if (quantityMilli <= 0) throw new MoneyError("quantityMilli must be greater than zero");
  if (vatRateBp < 0 || vatRateBp > 10000) {
    throw new MoneyError("vatRateBp must be between 0 and 10000");
  }
  if (discountValue < 0) throw new MoneyError("discountValue cannot be negative");

  // 1. gross
  const gross = roundHalfUp(
    BigInt(unitPricePiastres) * BigInt(quantityMilli),
    MILLI_PER_UNIT,
  );

  // 2. discount
  let discount: bigint;
  switch (discountType) {
    case "none":
      if (discountValue !== 0) {
        throw new MoneyError("discountValue must be 0 when discountType is 'none'");
      }
      discount = 0n;
      break;
    case "percent":
      if (discountValue > 10000) {
        throw new MoneyError("a percentage discount cannot exceed 100% (10000 bp)");
      }
      discount = roundHalfUp(gross * BigInt(discountValue), BP_PER_WHOLE);
      break;
    case "amount":
      discount = BigInt(discountValue);
      break;
    default:
      throw new MoneyError(`unknown discountType: ${String(discountType)}`);
  }

  if (discount > gross) {
    throw new MoneyError(
      "the discount is larger than the line itself " +
        `(discount ${discount} > gross ${gross} piastres)`,
    );
  }

  // 3. net
  const net = gross - discount;

  // 4. vat
  const vat = roundHalfUp(net * BigInt(vatRateBp), BP_PER_WHOLE);

  // 5. total
  const total = net + vat;

  return {
    grossPiastres: toSafeNumber(gross, "grossPiastres"),
    discountPiastres: toSafeNumber(discount, "discountPiastres"),
    netPiastres: toSafeNumber(net, "netPiastres"),
    vatPiastres: toSafeNumber(vat, "vatPiastres"),
    totalPiastres: toSafeNumber(total, "totalPiastres"),
  };
}

/** Plain integer sums. Deliberately no rounding here. */
export function computeDocument(lines: readonly LineTotals[]): DocumentTotals {
  let gross = 0n;
  let subtotal = 0n;
  let discountTotal = 0n;
  let vatTotal = 0n;

  for (const line of lines) {
    gross += BigInt(line.grossPiastres);
    subtotal += BigInt(line.netPiastres);
    discountTotal += BigInt(line.discountPiastres);
    vatTotal += BigInt(line.vatPiastres);
  }

  const total = subtotal + vatTotal;

  return {
    grossTotalPiastres: toSafeNumber(gross, "grossTotalPiastres"),
    subtotalPiastres: toSafeNumber(subtotal, "subtotalPiastres"),
    discountTotalPiastres: toSafeNumber(discountTotal, "discountTotalPiastres"),
    vatTotalPiastres: toSafeNumber(vatTotal, "vatTotalPiastres"),
    totalPiastres: toSafeNumber(total, "totalPiastres"),
  };
}

/* -------------------------------------------------------------------------- */
/* Reading what a person typed                                                */
/* -------------------------------------------------------------------------- */

/**
 * Turn Arabic-Indic digits into Western ones and strip grouping marks, so
 * "١٢٣٤٫٥٦" and "1,234.56" both read as 1234.56. Mum types Arabic digits on
 * an Arabic keyboard; the app must not care.
 */
export function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of String(text)) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0660 && code <= 0x0669) {
      out += String.fromCharCode(48 + (code - 0x0660)); // Arabic-Indic
    } else if (code >= 0x06f0 && code <= 0x06f9) {
      out += String.fromCharCode(48 + (code - 0x06f0)); // Extended Arabic-Indic
    } else if (ch === "٫") {
      out += "."; // Arabic decimal separator
    } else if (ch === "٬" || ch === "," || ch === " " || ch === " ") {
      // thousands separators and spaces: drop
    } else if (ch === "٠") {
      out += "0";
    } else {
      out += ch;
    }
  }
  return out.trim();
}

function parseScaled(text: string, decimals: number, label: string): number {
  const cleaned = normalizeDigits(text);
  if (cleaned === "") throw new MoneyError(`${label} is empty`);
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) {
    throw new MoneyError(`${label} is not a number: "${text}"`);
  }

  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  const [whole = "", fraction = ""] = body.split(".");
  if (whole === "" && fraction === "") throw new MoneyError(`${label} is empty`);
  if (fraction.length > decimals) {
    throw new MoneyError(
      `${label} has more than ${decimals} decimal places: "${text}"`,
    );
  }

  const padded = (whole || "0") + fraction.padEnd(decimals, "0");
  const value = BigInt(padded);
  return toSafeNumber(negative ? -value : value, label);
}

/** "12.34" -> 1234 piastres. Rejects a third decimal place. */
export function parseAmountToPiastres(text: string): number {
  return parseScaled(text, 2, "amount");
}

/** "1.5" -> 1500 milli. Rejects a fourth decimal place. */
export function parseQuantityToMilli(text: string): number {
  const value = parseScaled(text, 3, "quantity");
  if (value <= 0) throw new MoneyError("quantity must be greater than zero");
  return value;
}

/* -------------------------------------------------------------------------- */
/* Showing it back                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 1234567 -> "12,345.67". Western digits in both languages: that is what
 * Egyptian tax invoices use, and it keeps the numbers legible either way.
 */
export function formatPiastres(
  piastres: number,
  options: { grouping?: boolean } = {},
): string {
  requireInteger(piastres, "piastres");
  const grouping = options.grouping !== false;
  const negative = piastres < 0;
  const abs = Math.abs(piastres);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const wholeText = grouping
    ? whole.toLocaleString("en-US", { useGrouping: true })
    : String(whole);
  return `${negative ? "-" : ""}${wholeText}.${String(cents).padStart(2, "0")}`;
}

/** 1500 -> "1.5", 1000 -> "1", 1250 -> "1.25". Trailing zeros are dropped. */
export function formatQuantity(quantityMilli: number): string {
  requireInteger(quantityMilli, "quantityMilli");
  const negative = quantityMilli < 0;
  const abs = Math.abs(quantityMilli);
  const whole = Math.floor(abs / 1000);
  const fraction = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}
