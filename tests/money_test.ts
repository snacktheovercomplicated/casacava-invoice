import assert from "node:assert/strict";
import {
  computeDocument,
  computeLine,
  formatPiastres,
  formatQuantity,
  type LineTotals,
  MoneyError,
  normalizeDigits,
  parseAmountToPiastres,
  parseQuantityToMilli,
  resolveVatRateBp,
  roundHalfUp,
} from "../src/lib/money.ts";

/* -------------------------------------------------------------------------- */
/* Rounding                                                                   */
/* -------------------------------------------------------------------------- */

Deno.test("roundHalfUp rounds an exact half away from zero", () => {
  assert.equal(roundHalfUp(5n, 10n), 1n); // 0.5 -> 1
  assert.equal(roundHalfUp(15n, 10n), 2n); // 1.5 -> 2
  assert.equal(roundHalfUp(25n, 10n), 3n); // 2.5 -> 3, not 2 (no banker's rounding)
  assert.equal(roundHalfUp(4n, 10n), 0n); // 0.4 -> 0
  assert.equal(roundHalfUp(6n, 10n), 1n); // 0.6 -> 1
  assert.equal(roundHalfUp(-5n, 10n), -1n); // -0.5 -> -1
  assert.equal(roundHalfUp(-4n, 10n), 0n);
});

Deno.test("roundHalfUp refuses a zero or negative denominator", () => {
  assert.throws(() => roundHalfUp(1n, 0n), MoneyError);
  assert.throws(() => roundHalfUp(1n, -10n), MoneyError);
});

/* -------------------------------------------------------------------------- */
/* A single line                                                              */
/* -------------------------------------------------------------------------- */

Deno.test("a whole-number line with no VAT and no discount", () => {
  // 3 kg of something at 10.00 EGP
  const line = computeLine({
    unitPricePiastres: 1000,
    quantityMilli: 3000,
    vatRateBp: 0,
    discountType: "none",
    discountValue: 0,
  });
  assert.deepEqual(line, {
    grossPiastres: 3000,
    discountPiastres: 0,
    netPiastres: 3000,
    vatPiastres: 0,
    totalPiastres: 3000,
  });
});

Deno.test("quantity carries three decimals exactly", () => {
  // 1.125 kg at 10.80 EGP = 12.15 EGP exactly
  const line = computeLine({
    unitPricePiastres: 1080,
    quantityMilli: 1125,
    vatRateBp: 0,
    discountType: "none",
    discountValue: 0,
  });
  assert.equal(line.grossPiastres, 1215);
});

Deno.test("a fractional gross rounds half-up to the piastre", () => {
  // 0.001 of a unit at 5.00 EGP = 0.5 piastres -> 1
  assert.equal(
    computeLine({
      unitPricePiastres: 500,
      quantityMilli: 1,
      vatRateBp: 0,
      discountType: "none",
      discountValue: 0,
    }).grossPiastres,
    1,
  );
  // 0.001 of a unit at 4.99 EGP = 0.499 piastres -> 0
  assert.equal(
    computeLine({
      unitPricePiastres: 499,
      quantityMilli: 1,
      vatRateBp: 0,
      discountType: "none",
      discountValue: 0,
    }).grossPiastres,
    0,
  );
});

Deno.test("VAT at 14% on a round amount", () => {
  const line = computeLine({
    unitPricePiastres: 10000, // 100.00 EGP
    quantityMilli: 1000,
    vatRateBp: 1400,
    discountType: "none",
    discountValue: 0,
  });
  assert.equal(line.netPiastres, 10000);
  assert.equal(line.vatPiastres, 1400);
  assert.equal(line.totalPiastres, 11400);
});

Deno.test("VAT rounds half-up when it lands on exactly half a piastre", () => {
  // net 25 piastres x 14% = 3.5 piastres -> 4
  const line = computeLine({
    unitPricePiastres: 25,
    quantityMilli: 1000,
    vatRateBp: 1400,
    discountType: "none",
    discountValue: 0,
  });
  assert.equal(line.netPiastres, 25);
  assert.equal(line.vatPiastres, 4);
  assert.equal(line.totalPiastres, 29);
});

Deno.test("a percentage discount is taken off the gross, then VAT on what's left", () => {
  // 100.00 EGP, 10% off = 90.00, VAT 14% on 90.00 = 12.60
  const line = computeLine({
    unitPricePiastres: 10000,
    quantityMilli: 1000,
    vatRateBp: 1400,
    discountType: "percent",
    discountValue: 1000, // 10.00%
  });
  assert.deepEqual(line, {
    grossPiastres: 10000,
    discountPiastres: 1000,
    netPiastres: 9000,
    vatPiastres: 1260,
    totalPiastres: 10260,
  });
});

Deno.test("a fixed-amount discount is in piastres, not percent", () => {
  const line = computeLine({
    unitPricePiastres: 10000,
    quantityMilli: 1000,
    vatRateBp: 1400,
    discountType: "amount",
    discountValue: 1550, // 15.50 EGP off
  });
  assert.equal(line.discountPiastres, 1550);
  assert.equal(line.netPiastres, 8450);
  assert.equal(line.vatPiastres, 1183);
  assert.equal(line.totalPiastres, 9633);
});

Deno.test("a percentage discount rounds half-up too", () => {
  // gross 105, 50% = 52.5 -> 53
  const line = computeLine({
    unitPricePiastres: 105,
    quantityMilli: 1000,
    vatRateBp: 0,
    discountType: "percent",
    discountValue: 5000,
  });
  assert.equal(line.discountPiastres, 53);
  assert.equal(line.netPiastres, 52);
});

Deno.test("100% discount is allowed, more than 100% is not", () => {
  const free = computeLine({
    unitPricePiastres: 10000,
    quantityMilli: 1000,
    vatRateBp: 1400,
    discountType: "percent",
    discountValue: 10000,
  });
  assert.equal(free.netPiastres, 0);
  assert.equal(free.vatPiastres, 0);
  assert.equal(free.totalPiastres, 0);

  assert.throws(
    () =>
      computeLine({
        unitPricePiastres: 10000,
        quantityMilli: 1000,
        vatRateBp: 0,
        discountType: "percent",
        discountValue: 10001,
      }),
    MoneyError,
  );
});

Deno.test("a fixed discount larger than the line is refused, not silently clamped", () => {
  assert.throws(
    () =>
      computeLine({
        unitPricePiastres: 1000,
        quantityMilli: 1000,
        vatRateBp: 0,
        discountType: "amount",
        discountValue: 1001,
      }),
    MoneyError,
  );
});

Deno.test("bad inputs are refused", () => {
  const base = {
    unitPricePiastres: 1000,
    quantityMilli: 1000,
    vatRateBp: 0,
    discountType: "none" as const,
    discountValue: 0,
  };
  assert.throws(() => computeLine({ ...base, quantityMilli: 0 }), MoneyError);
  assert.throws(() => computeLine({ ...base, quantityMilli: -1000 }), MoneyError);
  assert.throws(() => computeLine({ ...base, unitPricePiastres: -1 }), MoneyError);
  assert.throws(() => computeLine({ ...base, vatRateBp: 10001 }), MoneyError);
  assert.throws(() => computeLine({ ...base, vatRateBp: -1 }), MoneyError);
  // a price with a fraction of a piastre is not a number we accept
  assert.throws(() => computeLine({ ...base, unitPricePiastres: 10.5 }), MoneyError);
  assert.throws(() => computeLine({ ...base, quantityMilli: 1.5 }), MoneyError);
  // a discount value on a 'none' discount is a sign something is confused
  assert.throws(
    () => computeLine({ ...base, discountType: "none", discountValue: 100 }),
    MoneyError,
  );
});

Deno.test("very large amounts stay exact (no float drift)", () => {
  // 9,999,999.99 EGP per unit, 999.999 units
  const line = computeLine({
    unitPricePiastres: 999_999_999,
    quantityMilli: 999_999,
    vatRateBp: 1400,
    discountType: "none",
    discountValue: 0,
  });
  // 999999999 * 999999 / 1000 = 999998999000.001 -> 999998999000
  assert.equal(line.grossPiastres, 999_998_999_000);
  assert.equal(Number.isSafeInteger(line.totalPiastres), true);
});

/* -------------------------------------------------------------------------- */
/* The whole document                                                         */
/* -------------------------------------------------------------------------- */

Deno.test("document totals are plain sums of already-rounded lines", () => {
  const lines = [
    computeLine({
      unitPricePiastres: 1080,
      quantityMilli: 1500,
      vatRateBp: 1400,
      discountType: "none",
      discountValue: 0,
    }),
    computeLine({
      unitPricePiastres: 340,
      quantityMilli: 2250,
      vatRateBp: 1400,
      discountType: "percent",
      discountValue: 500,
    }),
    computeLine({
      unitPricePiastres: 25,
      quantityMilli: 1000,
      vatRateBp: 1400,
      discountType: "none",
      discountValue: 0,
    }),
  ];
  const doc = computeDocument(lines);

  assert.equal(doc.subtotalPiastres, lines.reduce((s, l) => s + l.netPiastres, 0));
  assert.equal(doc.vatTotalPiastres, lines.reduce((s, l) => s + l.vatPiastres, 0));
  assert.equal(doc.totalPiastres, doc.subtotalPiastres + doc.vatTotalPiastres);
});

Deno.test("THE INVARIANT: the printed VAT column always adds up to the printed VAT total", () => {
  // This is the whole reason rounding happens per line and not at the end.
  // A customer adding up the VAT column by hand must reach the same number.
  const lines: LineTotals[] = [];
  for (let price = 1; price <= 400; price += 7) {
    for (const qty of [1, 333, 1000, 1500, 2750]) {
      lines.push(
        computeLine({
          unitPricePiastres: price,
          quantityMilli: qty,
          vatRateBp: 1400,
          discountType: "none",
          discountValue: 0,
        }),
      );
    }
  }
  const doc = computeDocument(lines);

  let vatByHand = 0;
  let netByHand = 0;
  let totalByHand = 0;
  for (const l of lines) {
    vatByHand += l.vatPiastres;
    netByHand += l.netPiastres;
    totalByHand += l.totalPiastres;
  }

  assert.equal(doc.vatTotalPiastres, vatByHand);
  assert.equal(doc.subtotalPiastres, netByHand);
  assert.equal(doc.totalPiastres, totalByHand);
  assert.equal(doc.totalPiastres, doc.subtotalPiastres + doc.vatTotalPiastres);
});

Deno.test("rounding is per line, and that is a visible choice", () => {
  // Two lines whose VAT is exactly 3.5 piastres each.
  // Per line:  4 + 4 = 8.   Summing first: round(7.0) = 7.
  // We produce 8. This test exists so the decision cannot drift silently.
  const one = computeLine({
    unitPricePiastres: 25,
    quantityMilli: 1000,
    vatRateBp: 1400,
    discountType: "none",
    discountValue: 0,
  });
  assert.equal(one.vatPiastres, 4);
  const doc = computeDocument([one, one]);
  assert.equal(doc.vatTotalPiastres, 8);
});

Deno.test("an empty document is all zeros", () => {
  assert.deepEqual(computeDocument([]), {
    grossTotalPiastres: 0,
    subtotalPiastres: 0,
    discountTotalPiastres: 0,
    vatTotalPiastres: 0,
    totalPiastres: 0,
  });
});

/* -------------------------------------------------------------------------- */
/* The VAT switch                                                             */
/* -------------------------------------------------------------------------- */

Deno.test("an item with no rate of its own follows the company default", () => {
  assert.equal(resolveVatRateBp(null, 0), 0);
  assert.equal(resolveVatRateBp(null, 1400), 1400);
  assert.equal(resolveVatRateBp(undefined, 1400), 1400);
});

Deno.test("an item with its own rate ignores the company default", () => {
  assert.equal(resolveVatRateBp(0, 1400), 0);
  assert.equal(resolveVatRateBp(500, 1400), 500);
});

Deno.test("flipping the company default moves the whole catalogue at once", () => {
  // Seeded today: every item inherits, company is at 0%.
  const catalogue = [null, null, null, 500];
  assert.deepEqual(catalogue.map((r) => resolveVatRateBp(r, 0)), [0, 0, 0, 500]);
  // The day you register, one settings row changes and everything follows.
  assert.deepEqual(
    catalogue.map((r) => resolveVatRateBp(r, 1400)),
    [1400, 1400, 1400, 500],
  );
});

Deno.test("an impossible rate is refused", () => {
  assert.throws(() => resolveVatRateBp(10001, 0), MoneyError);
  assert.throws(() => resolveVatRateBp(-1, 0), MoneyError);
  assert.throws(() => resolveVatRateBp(null, 10001), MoneyError);
});

/* -------------------------------------------------------------------------- */
/* Reading and showing numbers                                                */
/* -------------------------------------------------------------------------- */

Deno.test("Arabic-Indic digits are read as numbers", () => {
  assert.equal(normalizeDigits("١٢٣٤"), "1234");
  assert.equal(normalizeDigits("١٢٣٤٫٥٦"), "1234.56");
  assert.equal(parseAmountToPiastres("١٢٣٤٫٥٦"), 123456);
  assert.equal(parseQuantityToMilli("١٫٥"), 1500);
});

Deno.test("grouped and spaced input is read as numbers", () => {
  assert.equal(parseAmountToPiastres("1,234.56"), 123456);
  assert.equal(parseAmountToPiastres(" 1 234.56 "), 123456);
  assert.equal(parseAmountToPiastres("0.05"), 5);
  assert.equal(parseAmountToPiastres(".5"), 50);
  assert.equal(parseAmountToPiastres("7"), 700);
});

Deno.test("too many decimal places is an error, not a silent truncation", () => {
  assert.throws(() => parseAmountToPiastres("1.234"), MoneyError);
  assert.throws(() => parseQuantityToMilli("1.2345"), MoneyError);
  assert.throws(() => parseAmountToPiastres("abc"), MoneyError);
  assert.throws(() => parseAmountToPiastres(""), MoneyError);
  assert.throws(() => parseQuantityToMilli("0"), MoneyError);
  assert.throws(() => parseQuantityToMilli("-1"), MoneyError);
});

Deno.test("amounts are shown with two decimals and thousands grouping", () => {
  assert.equal(formatPiastres(0), "0.00");
  assert.equal(formatPiastres(5), "0.05");
  assert.equal(formatPiastres(1234567), "12,345.67");
  assert.equal(formatPiastres(1234567, { grouping: false }), "12345.67");
  assert.equal(formatPiastres(-1234567), "-12,345.67");
});

Deno.test("quantities drop trailing zeros", () => {
  assert.equal(formatQuantity(1000), "1");
  assert.equal(formatQuantity(1500), "1.5");
  assert.equal(formatQuantity(1250), "1.25");
  assert.equal(formatQuantity(1125), "1.125");
  assert.equal(formatQuantity(125), "0.125");
});

Deno.test("a typed amount survives a round trip", () => {
  for (const text of ["0.00", "0.05", "12.34", "1000.00", "99999.99"]) {
    assert.equal(formatPiastres(parseAmountToPiastres(text), { grouping: false }), text);
  }
});

/* -------------------------------------------------------------------------- */
/* What a customer adds up with a pen                                         */
/* -------------------------------------------------------------------------- */

Deno.test("THE COLUMN INVARIANT: gross total is exactly subtotal plus discount", () => {
  // The printed Amount column shows each line BEFORE its discount, so that
  // adding the column up lands exactly on the printed subtotal. The discount
  // is then taken off once, in its own row. If these two ever drift apart, a
  // customer adding the column with a pen reaches a different number from the
  // one on the invoice and thinks they have been overcharged.
  const lines = [
    computeLine({
      unitPricePiastres: 108000, quantityMilli: 5000, vatRateBp: 0,
      discountType: "none", discountValue: 0,
    }),
    computeLine({
      unitPricePiastres: 34000, quantityMilli: 2500, vatRateBp: 0,
      discountType: "percent", discountValue: 500,
    }),
    computeLine({
      unitPricePiastres: 48000, quantityMilli: 1250, vatRateBp: 0,
      discountType: "amount", discountValue: 5000,
    }),
    computeLine({
      unitPricePiastres: 19000, quantityMilli: 750, vatRateBp: 1400,
      discountType: "percent", discountValue: 1234,
    }),
  ];
  const doc = computeDocument(lines);

  const columnByHand = lines.reduce((sum, line) => sum + line.grossPiastres, 0);
  assert.equal(doc.grossTotalPiastres, columnByHand);
  assert.equal(
    doc.grossTotalPiastres,
    doc.subtotalPiastres + doc.discountTotalPiastres,
    "the printed column must add up to the printed subtotal",
  );
  assert.equal(
    doc.totalPiastres,
    doc.grossTotalPiastres - doc.discountTotalPiastres + doc.vatTotalPiastres,
    "subtotal - discount + VAT must equal the total",
  );
});

Deno.test("the column invariant holds across many mixed invoices", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const lines: LineTotals[] = [];
    const count = 1 + (seed % 9);
    for (let i = 0; i < count; i++) {
      const kind = (seed + i) % 3;
      lines.push(computeLine({
        unitPricePiastres: 37 * (seed + i) + 1,
        quantityMilli: 1 + ((seed * 7 + i * 13) % 9000),
        vatRateBp: (seed + i) % 2 === 0 ? 1400 : 0,
        discountType: kind === 0 ? "none" : kind === 1 ? "percent" : "amount",
        discountValue: kind === 0 ? 0 : kind === 1 ? ((seed * 3 + i) % 5000) : 1,
      }));
    }
    const doc = computeDocument(lines);
    const columnByHand = lines.reduce((sum, line) => sum + line.grossPiastres, 0);
    assert.equal(doc.grossTotalPiastres, columnByHand, `seed ${seed}`);
    assert.equal(
      doc.grossTotalPiastres,
      doc.subtotalPiastres + doc.discountTotalPiastres,
      `seed ${seed}`,
    );
    assert.equal(
      doc.totalPiastres,
      doc.grossTotalPiastres - doc.discountTotalPiastres + doc.vatTotalPiastres,
      `seed ${seed}`,
    );
  }
});
