import { describe, expect, it } from "vitest";
import { cumulativeThreshold, quantityAboveAgreed, unitPriceAboveAgreed } from "../../src/rules/rules/pricing.js";
import { agreement, ctx, invoice, ledgerEntry, line } from "../factories.js";

describe("UNIT_PRICE_ABOVE_AGREED (agreed 30.00, tolerance 2%)", () => {
  it.each([
    { price: "30.00", flagged: false },
    { price: "30.60", flagged: false }, // exactly +2%
    { price: "30.61", flagged: true },
    { price: "28.00", flagged: false }, // cheaper is fine
    { price: "34.50", flagged: true },
  ])("$price → flagged=$flagged", ({ price, flagged }) => {
    const c = ctx({ invoice: invoice({ lines: [line({ unitPrice: price, net: (Number(price) * 100).toFixed(2) })] }) });
    expect(unitPriceAboveAgreed.evaluate(c, {}).length > 0).toBe(flagged);
  });

  it("reports over-percentage and money impact", () => {
    const c = ctx({ invoice: invoice({ lines: [line({ unitPrice: "34.50", net: "3450.00" })] }) });
    expect(unitPriceAboveAgreed.evaluate(c, {})[0]).toMatchObject({
      expected: "30.00",
      actual: "34.50",
      params: { overPct: "15.0%", impact: "450.00" },
    });
  });

  it("ignores unmatched lines", () => {
    const c = ctx({
      invoice: invoice({ lines: [line({ unitPrice: "99", net: "9900.00" })] }),
      lineMatches: [{ lineNo: 1, termId: null, method: "none", confidence: 0 }],
    });
    expect(unitPriceAboveAgreed.evaluate(c, {})).toEqual([]);
  });
});

describe("QUANTITY_ABOVE_AGREED (max 1000 sac)", () => {
  it("sums lines of the same term", () => {
    const c = ctx({
      invoice: invoice({
        lines: [
          line({ quantity: "600", net: "18000.00" }),
          line({ lineNo: 2, quantity: "500", net: "15000.00" }),
        ],
      }),
    });
    expect(quantityAboveAgreed.evaluate(c, {})[0]).toMatchObject({ actual: "1100", expected: "1000", delta: "100" });
  });

  it("within max → nothing", () => {
    expect(quantityAboveAgreed.evaluate(ctx(), {})).toEqual([]);
  });
});

describe("CUMULATIVE_THRESHOLD (levels 80% / 100%)", () => {
  const thisInvoice = (qty: string) => invoice({ lines: [line({ quantity: qty, net: (Number(qty) * 30).toFixed(2) })] });

  it.each([
    { prior: "500", now: "200", expect: null },
    { prior: "600", now: "250", expect: { level: "80.0%", status: "alert", maxSeverity: "info" } },
    { prior: "800", now: "200", expect: { level: "100.0%", status: "alert", maxSeverity: "info" } },
    { prior: "800", now: "300", expect: { level: "100.0%", status: "over_cap", maxSeverity: undefined } },
  ])("prior $prior + $now of 1000", ({ prior, now, expect: e }) => {
    const c = ctx({ invoice: thisInvoice(now), ledger: [ledgerEntry({ quantity: prior, net: String(Number(prior) * 30) })] });
    const issues = cumulativeThreshold.evaluate(c, {});
    if (e === null) return expect(issues).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ maxSeverity: e.maxSeverity, params: { level: e.level, status: e.status, scope: "term_quantity" } });
  });

  it("rejected ledger entries do not count", () => {
    const c = ctx({ invoice: thisInvoice("300"), ledger: [ledgerEntry({ quantity: "800", status: "rejected" })] });
    expect(cumulativeThreshold.evaluate(c, {})).toEqual([]);
  });

  it("checks the agreement totalCap across all lines", () => {
    const c = ctx({
      agreement: agreement({ totalCap: "10000", terms: [{ ...agreement().terms[0]!, maxQuantity: undefined } as never] }),
      invoice: thisInvoice("100"),
      ledger: [ledgerEntry({ quantity: "250", net: "7500" })],
    });
    const issue = cumulativeThreshold.evaluate(c, {})[0];
    expect(issue).toMatchObject({ params: { scope: "agreement_total", usedAfter: "105.0%", status: "over_cap" } });
  });

  it("params.levels override the profile alert levels", () => {
    const c = ctx({ invoice: thisInvoice("100"), ledger: [ledgerEntry({ quantity: "400" })] });
    expect(cumulativeThreshold.evaluate(c, { levels: [0.5] })[0]?.params.level).toBe("50.0%");
  });
});
