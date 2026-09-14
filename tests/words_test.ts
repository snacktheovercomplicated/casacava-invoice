import assert from "node:assert/strict";
import { amountInEnglishWords, numberToEnglishWords, WordsError } from "../src/lib/words_en.ts";
import { amountInArabicWords, numberToArabicWords } from "../src/lib/words_ar.ts";

/* ========================================================================== */
/* The two examples that were approved                                        */
/* ========================================================================== */

Deno.test("APPROVED WORDING: 325.50 EGP in both languages", () => {
  assert.equal(
    amountInArabicWords(32550),
    "فقط ثلاثمائة وخمسة وعشرون جنيهاً وخمسون قرشاً لا غير",
  );
  assert.equal(
    amountInEnglishWords(32550),
    "Three Hundred Twenty Five Egyptian Pounds and Fifty Piastres only",
  );
});

/* ========================================================================== */
/* Arabic                                                                     */
/* ========================================================================== */

Deno.test("Arabic numbers 1-20", () => {
  const expected: Record<number, string> = {
    1: "واحد", 2: "اثنان", 3: "ثلاثة", 4: "أربعة", 5: "خمسة",
    6: "ستة", 7: "سبعة", 8: "ثمانية", 9: "تسعة", 10: "عشرة",
    11: "أحد عشر", 12: "اثنا عشر", 13: "ثلاثة عشر", 14: "أربعة عشر",
    15: "خمسة عشر", 16: "ستة عشر", 17: "سبعة عشر", 18: "ثمانية عشر",
    19: "تسعة عشر", 20: "عشرون",
  };
  for (const [n, words] of Object.entries(expected)) {
    assert.equal(numberToArabicWords(Number(n)), words, `${n}`);
  }
});

Deno.test("Arabic tens say the unit first: 25 is 'five and twenty'", () => {
  assert.equal(numberToArabicWords(21), "واحد وعشرون");
  assert.equal(numberToArabicWords(25), "خمسة وعشرون");
  assert.equal(numberToArabicWords(30), "ثلاثون");
  assert.equal(numberToArabicWords(47), "سبعة وأربعون");
  assert.equal(numberToArabicWords(99), "تسعة وتسعون");
});

Deno.test("Arabic hundreds are single words, and 3-9 drop the ة before مائة", () => {
  assert.equal(numberToArabicWords(100), "مائة");
  assert.equal(numberToArabicWords(200), "مائتان");
  assert.equal(numberToArabicWords(300), "ثلاثمائة");
  assert.equal(numberToArabicWords(400), "أربعمائة");
  assert.equal(numberToArabicWords(500), "خمسمائة");
  assert.equal(numberToArabicWords(600), "ستمائة");
  assert.equal(numberToArabicWords(700), "سبعمائة");
  assert.equal(numberToArabicWords(800), "ثمانمائة");
  assert.equal(numberToArabicWords(900), "تسعمائة");
  assert.equal(numberToArabicWords(325), "ثلاثمائة وخمسة وعشرون");
  assert.equal(numberToArabicWords(999), "تسعمائة وتسعة وتسعون");
});

Deno.test("Arabic thousands, millions and billions take the right form", () => {
  assert.equal(numberToArabicWords(1_000), "ألف"); // not واحد ألف
  assert.equal(numberToArabicWords(2_000), "ألفان"); // dual
  assert.equal(numberToArabicWords(3_000), "ثلاثة آلاف"); // 3-10 -> plural
  assert.equal(numberToArabicWords(10_000), "عشرة آلاف");
  assert.equal(numberToArabicWords(11_000), "أحد عشر ألفاً"); // 11-99 -> accusative
  assert.equal(numberToArabicWords(100_000), "مائة ألف"); // ends 00 -> singular
  assert.equal(numberToArabicWords(500_000), "خمسمائة ألف");
  assert.equal(numberToArabicWords(1_000_000), "مليون");
  assert.equal(numberToArabicWords(2_000_000), "مليونان");
  assert.equal(numberToArabicWords(3_000_000), "ثلاثة ملايين");
  assert.equal(numberToArabicWords(1_000_000_000), "مليار");
  assert.equal(numberToArabicWords(2_000_000_000), "ملياران");
});

Deno.test("Arabic composite numbers join with و", () => {
  assert.equal(numberToArabicWords(1_234), "ألف ومائتان وأربعة وثلاثون");
  assert.equal(
    numberToArabicWords(1_234_567),
    "مليون ومائتان وأربعة وثلاثون ألفاً وخمسمائة وسبعة وستون",
  );
  assert.equal(numberToArabicWords(0), "صفر");
});

Deno.test("THE POUND NOUN changes with the last two digits of the amount", () => {
  const cases: Array<[number, string]> = [
    [100, "فقط جنيه واحد لا غير"], // 1 -> singular + واحد
    [200, "فقط جنيهان لا غير"], // 2 -> dual
    [300, "فقط ثلاثة جنيهات لا غير"], // 3 -> plural
    [1000, "فقط عشرة جنيهات لا غير"], // 10 -> plural
    [1100, "فقط أحد عشر جنيهاً لا غير"], // 11 -> accusative
    [2500, "فقط خمسة وعشرون جنيهاً لا غير"], // 25 -> accusative
    [9900, "فقط تسعة وتسعون جنيهاً لا غير"], // 99 -> accusative
    [10000, "فقط مائة جنيه لا غير"], // ends 00 -> singular
    [10100, "فقط مائة وواحد جنيه لا غير"], // ends 01 -> singular
    [10200, "فقط مائة واثنان جنيه لا غير"], // ends 02 -> singular
    [10300, "فقط مائة وثلاثة جنيهات لا غير"], // ends 03 -> plural
    [100000, "فقط ألف جنيه لا غير"],
    [30000, "فقط ثلاثمائة جنيه لا غير"],
  ];
  for (const [piastres, words] of cases) {
    assert.equal(amountInArabicWords(piastres), words, String(piastres));
  }
});

Deno.test("THE PIASTRE NOUN follows the same bands", () => {
  const cases: Array<[number, string]> = [
    [1, "فقط قرش واحد لا غير"],
    [2, "فقط قرشان لا غير"],
    [3, "فقط ثلاثة قروش لا غير"],
    [10, "فقط عشرة قروش لا غير"],
    [11, "فقط أحد عشر قرشاً لا غير"],
    [50, "فقط خمسون قرشاً لا غير"],
    [99, "فقط تسعة وتسعون قرشاً لا غير"],
  ];
  for (const [piastres, words] of cases) {
    assert.equal(amountInArabicWords(piastres), words, String(piastres));
  }
});

Deno.test("Arabic joins pounds and piastres with و", () => {
  assert.equal(amountInArabicWords(10050), "فقط مائة جنيه وخمسون قرشاً لا غير");
  assert.equal(amountInArabicWords(101), "فقط جنيه واحد وقرش واحد لا غير");
  assert.equal(amountInArabicWords(202), "فقط جنيهان وقرشان لا غير");
});

Deno.test("Arabic zero", () => {
  assert.equal(amountInArabicWords(0), "فقط صفر جنيه لا غير");
});

/* ========================================================================== */
/* English                                                                    */
/* ========================================================================== */

Deno.test("English numbers", () => {
  assert.equal(numberToEnglishWords(0), "Zero");
  assert.equal(numberToEnglishWords(1), "One");
  assert.equal(numberToEnglishWords(13), "Thirteen");
  assert.equal(numberToEnglishWords(20), "Twenty");
  assert.equal(numberToEnglishWords(25), "Twenty Five");
  assert.equal(numberToEnglishWords(100), "One Hundred");
  assert.equal(numberToEnglishWords(325), "Three Hundred Twenty Five");
  assert.equal(numberToEnglishWords(1_000), "One Thousand");
  assert.equal(numberToEnglishWords(1_234), "One Thousand Two Hundred Thirty Four");
  assert.equal(
    numberToEnglishWords(1_234_567),
    "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven",
  );
  assert.equal(numberToEnglishWords(1_000_000_000), "One Billion");
});

Deno.test("English singular and plural", () => {
  assert.equal(amountInEnglishWords(100), "One Egyptian Pound only");
  assert.equal(amountInEnglishWords(200), "Two Egyptian Pounds only");
  assert.equal(amountInEnglishWords(1), "One Piastre only");
  assert.equal(amountInEnglishWords(2), "Two Piastres only");
  assert.equal(amountInEnglishWords(101), "One Egyptian Pound and One Piastre only");
});

Deno.test("English zero", () => {
  assert.equal(amountInEnglishWords(0), "Zero Egyptian Pounds only");
});

Deno.test("English drops the piastres clause when there are none", () => {
  assert.equal(
    amountInEnglishWords(32500),
    "Three Hundred Twenty Five Egyptian Pounds only",
  );
});

/* ========================================================================== */
/* Both                                                                       */
/* ========================================================================== */

Deno.test("neither language ever produces a doubled or trailing space", () => {
  for (let piastres = 0; piastres <= 3000; piastres++) {
    for (const words of [amountInArabicWords(piastres), amountInEnglishWords(piastres)]) {
      assert.ok(!words.includes("  "), `double space at ${piastres}: "${words}"`);
      assert.equal(words, words.trim(), `untrimmed at ${piastres}`);
      assert.ok(words.length > 0);
    }
  }
});

Deno.test("both languages handle a large invoice total", () => {
  // 1,234,567.89 EGP
  assert.equal(
    amountInEnglishWords(123_456_789),
    "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven " +
      "Egyptian Pounds and Eighty Nine Piastres only",
  );
  assert.equal(
    amountInArabicWords(123_456_789),
    "فقط مليون ومائتان وأربعة وثلاثون ألفاً وخمسمائة وسبعة وستون جنيهاً " +
      "وتسعة وثمانون قرشاً لا غير",
  );
});

Deno.test("a fractional input is refused rather than guessed at", () => {
  assert.throws(() => amountInEnglishWords(1.5), WordsError);
  assert.throws(() => amountInArabicWords(1.5), WordsError);
});

Deno.test("every whole piastre from 0 to 20000 produces words in both languages", () => {
  // A crude but effective net: any unhandled band would throw or come back empty.
  for (let piastres = 0; piastres <= 20_000; piastres++) {
    assert.ok(amountInArabicWords(piastres).startsWith("فقط"));
    assert.ok(amountInEnglishWords(piastres).endsWith("only"));
  }
});
