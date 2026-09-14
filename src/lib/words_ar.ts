/**
 * Arabic amount in words, for the total line of an Arabic invoice.
 *
 *   32550 -> "فقط ثلاثمائة وخمسة وعشرون جنيهاً وخمسون قرشاً لا غير"
 *
 * THE GRAMMAR, because this is the part that goes quietly wrong:
 *
 * 1. Both جنيه and قرش are masculine nouns.
 *
 * 2. Arabic numbers 3-10 take REVERSE gender agreement: with a masculine
 *    noun the number carries the ة ending (ثلاثة جنيهات, not ثلاث جنيهات).
 *    But مائة is feminine, so the hundreds compounds drop it again
 *    (ثلاثمائة, not ثلاثةمائة). Both forms are needed.
 *
 * 3. The form of the counted noun is decided by the LAST TWO DIGITS of the
 *    count, not by its size:
 *       count = 1            -> singular, with واحد after it   (جنيه واحد)
 *       count = 2            -> dual                            (جنيهان)
 *       last two digits 3-10 -> plural                          (خمسة جنيهات)
 *       last two digits 11-99-> singular accusative (tamyeez)   (عشرون جنيهاً)
 *       last two digits 0,1,2-> singular                        (مائة جنيه)
 *    So 325 ends in 25, which lands in the 11-99 band: ثلاثمائة وخمسة وعشرون جنيهاً.
 *
 * 4. The same rule governs the scale words themselves, which is why
 *    500,000 is خمسمائة ألف (ends in 00) but 11,000 is أحد عشر ألفاً.
 *
 * The input is always a whole number of piastres, never a float.
 */

import { WordsError } from "./words_en.ts";

/** 1-19 as used before a MASCULINE noun (the ة forms for 3-10). */
const ONES_M = [
  "", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية",
  "تسعة", "عشرة",
];

/** 3-9 as used before مائة, which is feminine (no ة). */
const ONES_F_FOR_HUNDREDS = [
  "", "", "", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثمان", "تسع",
];

const TENS = [
  "", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون",
  "تسعون",
];

const HUNDREDS = [
  "", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة",
  "سبعمائة", "ثمانمائة", "تسعمائة",
];

interface NounForms {
  /** one of them, and the form used after مائة / ألف */
  singular: string;
  /** exactly two */
  dual: string;
  /** three to ten of them */
  plural: string;
  /** eleven to ninety-nine of them (tamyeez, accusative) */
  accusative: string;
}

const POUND: NounForms = {
  singular: "جنيه",
  dual: "جنيهان",
  plural: "جنيهات",
  accusative: "جنيهاً",
};

const PIASTRE: NounForms = {
  singular: "قرش",
  dual: "قرشان",
  plural: "قروش",
  accusative: "قرشاً",
};

const THOUSAND: NounForms = {
  singular: "ألف",
  dual: "ألفان",
  plural: "آلاف",
  accusative: "ألفاً",
};

const MILLION: NounForms = {
  singular: "مليون",
  dual: "مليونان",
  plural: "ملايين",
  accusative: "مليوناً",
};

const BILLION: NounForms = {
  singular: "مليار",
  dual: "ملياران",
  plural: "مليارات",
  accusative: "ملياراً",
};

/** Rule 3: which form of the counted noun goes with this count. */
function nounFormFor(count: number, forms: NounForms): string {
  const lastTwo = count % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return forms.plural;
  if (lastTwo >= 11 && lastTwo <= 99) return forms.accusative;
  return forms.singular; // ends in 00, 01 or 02
}

/** 1-99 before a masculine noun. */
function underHundred(n: number): string {
  if (n <= 0) return "";
  if (n <= 10) return ONES_M[n];
  if (n === 11) return "أحد عشر";
  if (n === 12) return "اثنا عشر";
  if (n <= 19) return `${ONES_M[n - 10]} عشر`;

  const tens = Math.floor(n / 10);
  const unit = n % 10;
  // Arabic says the unit first: خمسة وعشرون, literally "five and twenty".
  return unit === 0 ? TENS[tens] : `${ONES_M[unit]} و${TENS[tens]}`;
}

/** 1-999 before a masculine noun. */
function underThousand(n: number): string {
  if (n <= 0) return "";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  if (rest > 0) parts.push(underHundred(rest));
  return parts.join(" و");
}

/** Whole number to words, before a masculine noun. 0 returns صفر. */
export function numberToArabicWords(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new WordsError(`expected a whole number, got ${String(value)}`);
  }
  if (value < 0) return "سالب " + numberToArabicWords(-value);
  if (value === 0) return "صفر";

  const groups: Array<{ divisor: number; forms: NounForms }> = [
    { divisor: 1_000_000_000, forms: BILLION },
    { divisor: 1_000_000, forms: MILLION },
    { divisor: 1_000, forms: THOUSAND },
  ];

  const parts: string[] = [];
  let remaining = value;

  for (const { divisor, forms } of groups) {
    const count = Math.floor(remaining / divisor);
    if (count === 0) continue;
    remaining -= count * divisor;

    if (count === 1) {
      parts.push(forms.singular); // ألف, not واحد ألف
    } else if (count === 2) {
      parts.push(forms.dual); // ألفان
    } else {
      parts.push(`${numberToArabicWords(count)} ${nounFormFor(count, forms)}`);
    }
  }

  if (remaining > 0) parts.push(underThousand(remaining));

  return parts.join(" و");
}

/** "<number> <noun>" for a currency amount, with the 1 and 2 special cases. */
function currencyPhrase(count: number, forms: NounForms): string {
  if (count === 1) return `${forms.singular} واحد`; // جنيه واحد
  if (count === 2) return forms.dual; // جنيهان
  return `${numberToArabicWords(count)} ${nounFormFor(count, forms)}`;
}

/**
 * The full sentence that prints under the total on an Arabic invoice.
 */
export function amountInArabicWords(totalPiastres: number): string {
  if (!Number.isSafeInteger(totalPiastres)) {
    throw new WordsError(`expected whole piastres, got ${String(totalPiastres)}`);
  }
  if (totalPiastres < 0) {
    return "سالب " + amountInArabicWords(-totalPiastres);
  }

  const pounds = Math.floor(totalPiastres / 100);
  const piastres = totalPiastres % 100;

  if (pounds === 0 && piastres === 0) return "فقط صفر جنيه لا غير";

  const parts: string[] = [];
  if (pounds > 0) parts.push(currencyPhrase(pounds, POUND));
  if (piastres > 0) parts.push(currencyPhrase(piastres, PIASTRE));

  return `فقط ${parts.join(" و")} لا غير`;
}
