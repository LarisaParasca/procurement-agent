import { describe, expect, it } from "vitest";
import { arithmeticLine, arithmeticTotals, duplicateInvoice, vatRateInvalid } from "../../src/rules/rules/document.js";
import { ctx, invoice, line } from "../factories.js";

describe("ARITHMETIC_LINE", () => {
  it.each([
    { name: "exact", quantity: "100", unitPrice: "30.00", net: "3000.00", flagged: false },
    { name: "rounding within tolerance", quantity: "3", unitPrice: "33.333", net: "100.00", flagged: false },
    { name: "wrong net", quantity: "100", unitPrice: "30.00", net: "3300.00", flagged: true },
    { name: "decimal quantity", quantity: "12.5", unitPrice: "412.80", net: "5160.00", flagged: false },
  ])("$name", ({ quantity, unitPrice, net, flagged }) => {
    const c = ctx({ invoice: invoice({ lines: [line({ quantity, unitPrice, net })] }) });
    expect(arithmeticLine.evaluate(c, {}).length > 0).toBe(flagged);
  });

  it("reports expected, actual and delta", () => {
    const c = ctx({ invoice: invoice({ lines: [line({ net: "3300.00" })] }) });
    expect(arithmeticLine.evaluate(c, {})[0]).toMatchObject({ lineNo: 1, expected: "3000.00", actual: "3300.00", delta: "300.00" });
  });
});

describe("ARITHMETIC_TOTALS", () => {
  it("passes a consistent invoice", () => {
    expect(arithmeticTotals.evaluate(ctx(), {})).toEqual([]);
  });

  it("flags a wrong VAT amount and the gross that inherits it", () => {
    const inv = invoice();
    inv.vatLines[0]!.amount = "640.00"; // should be 630.00
    inv.totals = { net: "3000.00", vat: "640.00", gross: "3640.00" };
    const checks = arithmeticTotals.evaluate(ctx({ invoice: inv }), {}).map((i) => i.params.check);
    expect(checks).toEqual(["vat_line"]);
  });

  it("flags net + VAT ≠ gross", () => {
    const inv = invoice();
    inv.totals.gross = "3700.00";
    const issues = arithmeticTotals.evaluate(ctx({ invoice: inv }), {});
    expect(issues.map((i) => i.params.check)).toEqual(["net_plus_vat_vs_gross"]);
    expect(issues[0]).toMatchObject({ expected: "3630.00", actual: "3700.00" });
  });

  it("flags lines that don't add up to the net total", () => {
    const inv = invoice({ lines: [line(), line({ lineNo: 2, net: "500.00", quantity: "1", unitPrice: "500.00" })] });
    inv.totals.net = "3000.00";
    const checks = arithmeticTotals.evaluate(ctx({ invoice: inv }), {}).map((i) => i.params.check);
    expect(checks).toContain("lines_vs_net");
  });
});

describe("VAT_RATE_INVALID", () => {
  it.each([
    { rate: "21", date: "2026-03-15", flagged: false },
    { rate: "19", date: "2026-03-15", flagged: true },
    { rate: "19", date: "2025-07-15", flagged: false },
    { rate: "21", date: "2025-07-15", flagged: true },
    { rate: "11", date: "2026-03-15", flagged: false },
    { rate: "9", date: "2026-03-15", flagged: true },
  ])("rate $rate on $date → flagged=$flagged", ({ rate, date, flagged }) => {
    const c = ctx({ invoice: invoice({ issueDate: date, lines: [line({ vatRate: rate })] }) });
    expect(vatRateInvalid.evaluate(c, {}).length > 0).toBe(flagged);
  });
});

describe("DUPLICATE_INVOICE", () => {
  const hit = { invoiceId: "old", series: "FT", number: "1001", issueDate: "2026-03-15", gross: "3630.00" };

  it("no duplicates → nothing", () => {
    expect(duplicateInvoice.evaluate(ctx(), {})).toEqual([]);
  });

  it("exact duplicate keeps profile severity", () => {
    const issues = duplicateInvoice.evaluate(ctx({ duplicates: { exact: [hit], suspected: [] } }), {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.maxSeverity).toBeUndefined();
    expect(issues[0]!.params.kind).toBe("exact");
  });

  it("suspected duplicate is capped at review", () => {
    const issues = duplicateInvoice.evaluate(ctx({ duplicates: { exact: [], suspected: [{ ...hit, number: "1002" }] } }), {});
    expect(issues[0]).toMatchObject({ maxSeverity: "review", params: { kind: "suspected" } });
  });
});
