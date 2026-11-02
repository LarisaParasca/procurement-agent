import { describe, expect, it } from "vitest";
import type { Term } from "../../src/domain/index.js";
import { percentageMismatch } from "../../src/rules/rules/percentage.js";
import {
  periodCount,
  recurringAmountMismatch,
  recurringPeriodDuplicate,
  recurringPeriodInvalid,
} from "../../src/rules/rules/recurring.js";
import { agreement, ctx, invoice, ledgerEntry, line } from "../factories.js";

const commission: Term = {
  id: "c1",
  kind: "percentage",
  description: "Comision intermediere vânzare",
  aliases: [],
  rate: "0.03",
  base: { kind: "sale_price", description: "prețul de vânzare" },
};

const rent: Extract<Term, { kind: "recurring" }> = {
  id: "r1",
  kind: "recurring",
  description: "Chirie lunară apartament",
  aliases: [],
  amount: "2500.00",
  period: "monthly",
  start: "2026-01-01",
  end: "2026-12-31",
};

const commissionLine = (net: string, base?: string) =>
  line({ description: "Comision", unit: "buc", quantity: "1", unitPrice: net, net, percentageBase: base });

const rentLine = (net: string, from?: string, to?: string) =>
  line({ description: "Chirie", unit: "luna", quantity: "1", unitPrice: net, net, period: from && to ? { from, to } : undefined });

describe("PERCENTAGE_MISMATCH (3% of sale price)", () => {
  const withLine = (l: ReturnType<typeof line>, terms: Term[] = [commission]) =>
    ctx({ agreement: agreement({ documentType: "brokerage", terms }), invoice: invoice({ lines: [l] }) });

  it("correct commission passes", () => {
    expect(percentageMismatch.evaluate(withLine(commissionLine("3600.00", "120000")), {})).toEqual([]);
  });

  it("wrong rate is flagged with implied rate", () => {
    expect(percentageMismatch.evaluate(withLine(commissionLine("4200.00", "120000")), {})[0]).toMatchObject({
      expected: "3600.00",
      actual: "4200.00",
      params: { reason: "amount_mismatch", impliedRate: "3.50%" },
    });
  });

  it("unknown base asks for review", () => {
    expect(percentageMismatch.evaluate(withLine(commissionLine("3600.00")), {})[0]?.params.reason).toBe("base_unknown");
  });

  it("minimum fee applies when rate × base is lower", () => {
    const withMin = { ...commission, minFee: "1500.00" } as Term;
    expect(percentageMismatch.evaluate(withLine(commissionLine("1500.00", "30000"), [withMin]), {})).toEqual([]);
  });
});

describe("recurring rules (rent 2500/month, 2026)", () => {
  const rentCtx = (l: ReturnType<typeof line>, ledger = [] as ReturnType<typeof ledgerEntry>[]) =>
    ctx({ agreement: agreement({ documentType: "lease", terms: [rent] }), invoice: invoice({ lines: [l] }), ledger });

  it("periodCount handles single and multi-month periods", () => {
    expect(periodCount(rent, { from: "2026-03-01", to: "2026-03-31" })).toBe(1);
    expect(periodCount(rent, { from: "2026-01-01", to: "2026-03-31" })).toBe(3);
    expect(periodCount(rent, { from: "2026-03-05", to: "2026-04-04" })).toBeUndefined();
    expect(periodCount(rent, { from: "2026-03-01", to: "2026-03-15" })).toBeUndefined();
  });

  it("RECURRING_AMOUNT_MISMATCH: correct month passes, wrong amount flagged", () => {
    expect(recurringAmountMismatch.evaluate(rentCtx(rentLine("2500.00", "2026-03-01", "2026-03-31")), {})).toEqual([]);
    expect(recurringAmountMismatch.evaluate(rentCtx(rentLine("2750.00", "2026-03-01", "2026-03-31")), {})[0]).toMatchObject({
      expected: "2500.00",
      actual: "2750.00",
    });
  });

  it("RECURRING_AMOUNT_MISMATCH: two months at once expects double", () => {
    expect(recurringAmountMismatch.evaluate(rentCtx(rentLine("5000.00", "2026-03-01", "2026-04-30")), {})).toEqual([]);
  });

  it.each([
    { from: undefined, to: undefined, reason: "missing" },
    { from: "2027-01-01", to: "2027-01-31", reason: "outside_term" },
    { from: "2026-03-10", to: "2026-04-09", reason: "not_aligned" },
  ])("RECURRING_PERIOD_INVALID: $reason", ({ from, to, reason }) => {
    expect(recurringPeriodInvalid.evaluate(rentCtx(rentLine("2500.00", from, to)), {})[0]?.params.reason).toBe(reason);
  });

  it("RECURRING_PERIOD_DUPLICATE: same month invoiced twice", () => {
    const prior = ledgerEntry({ termId: "r1", invoiceNumber: "AG0042", period: { from: "2026-03-01", to: "2026-03-31" } });
    const issues = recurringPeriodDuplicate.evaluate(rentCtx(rentLine("2500.00", "2026-03-01", "2026-03-31"), [prior]), {});
    expect(issues[0]?.params.previousInvoice).toBe("AG0042");
    expect(recurringPeriodDuplicate.evaluate(rentCtx(rentLine("2500.00", "2026-04-01", "2026-04-30"), [prior]), {})).toEqual([]);
  });
});
