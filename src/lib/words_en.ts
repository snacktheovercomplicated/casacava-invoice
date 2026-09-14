/**
 * English amount in words, for the total line of an English invoice.
 *
 *   32550  ->  "Three Hundred Twenty Five Egyptian Pounds and Fifty Piastres only"
 *   32500  ->  "Three Hundred Twenty Five Egyptian Pounds only"
 *      50  ->  "Fifty Piastres only"
 *       0  ->  "Zero Egyptian Pounds only"
 *
 * The input is always a whole number of piastres, never a float.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

/** Largest first. Nothing beyond Trillion: an invoice will never need it. */
const SCALES: ReadonlyArray<{ value: number; name: string }> = [
  { value: 1_000_000_000_000, name: "Trillion" },
  { value: 1_000_000_000, name: "Billion" },
  { value: 1_000_000, name: "Million" },
  { value: 1_000, name: "Thousand" },
];

export class WordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordsError";
  }
}

/** 0..999 -> "Three Hundred Twenty Five". Empty string for 0. */
function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds > 0) parts.push(ONES[hundreds], "Hundred");

  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const tens = Math.floor(rest / 10);
      const unit = rest % 10;
      parts.push(TENS[tens]);
      if (unit > 0) parts.push(ONES[unit]);
    }
  }
  return parts.join(" ");
}

/** Whole number to words. 0 returns "Zero". */
export function numberToEnglishWords(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new WordsError(`expected a whole number, got ${String(value)}`);
  }
  if (value < 0) return "Minus " + numberToEnglishWords(-value);
  if (value === 0) return "Zero";

  const parts: string[] = [];
  let remaining = value;

  for (const { value: scaleValue, name } of SCALES) {
    const count = Math.floor(remaining / scaleValue);
    if (count > 0) {
      parts.push(numberToEnglishWords(count), name);
      remaining -= count * scaleValue;
    }
  }

  if (remaining > 0) parts.push(underThousand(remaining));

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The full sentence that prints under the total on an English invoice.
 */
export function amountInEnglishWords(totalPiastres: number): string {
  if (!Number.isSafeInteger(totalPiastres)) {
    throw new WordsError(`expected whole piastres, got ${String(totalPiastres)}`);
  }
  if (totalPiastres < 0) {
    return "Minus " + amountInEnglishWords(-totalPiastres);
  }

  const pounds = Math.floor(totalPiastres / 100);
  const piastres = totalPiastres % 100;

  const poundWord = pounds === 1 ? "Egyptian Pound" : "Egyptian Pounds";
  const piastreWord = piastres === 1 ? "Piastre" : "Piastres";

  if (pounds === 0 && piastres === 0) return "Zero Egyptian Pounds only";

  if (pounds === 0) {
    return `${numberToEnglishWords(piastres)} ${piastreWord} only`;
  }

  if (piastres === 0) {
    return `${numberToEnglishWords(pounds)} ${poundWord} only`;
  }

  return `${numberToEnglishWords(pounds)} ${poundWord} and ` +
    `${numberToEnglishWords(piastres)} ${piastreWord} only`;
}
