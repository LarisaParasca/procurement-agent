import { describe, expect, it } from "vitest";
import {
  currencyMismatch,
  dateOutsideValidity,
  itemNotCovered,
  lowMatchConfidence,
  noMatchingAgreement,
} from "../../src/rules/rules/matching.js";
import { agreement, ctx, invoice, line } from "../factories.js";

describe("NO_MATCHING_AGREEMENT", () => {
  it("fires only without an agreement", () => {
    expect(noMatchingAgreement.evaluate(ctx(), {})).toEqual([]);
    expect(noMatchingAgreement.evaluate(ctx({ agreement: null }), {})).toHaveLength(1);
  });
});

describe("LOW_MATCH_CONFIDENCE", () => {
  it("flags an LLM agreement match below threshold", () => {
    const c = ctx();
    c.match = { ...c.match, method: "llm", confidence: 0.6 };
    expect(lowMatchConfidence.evaluate(c, {})[0]?.params.level).toBe("agreement");
  });

  it("flags a weak line match but not an unmatched line", () => {
    const c = ctx({
      invoice: invoice({ lines: [line(), line({ lineNo: 2 })] }),
      lineMatches: [
        { lineNo: 1, termId: "t1", method: "llm", confidence: 0.5 },
        { lineNo: 2, termId: null, method: "none", confidence: 0 },
      ],
    });
    const issues = lowMatchConfidence.evaluate(c, {});
    expect(issues.map((i) => i.lineNo)).toEqual([1]);
  });
});

describe("CURRENCY_MISMATCH", () => {
  it("flags EUR agreement invoiced in RON", () => {
    const c = ctx({ agreement: agreement({ currency: "EUR" }) });
    expect(currencyMismatch.evaluate(c, {})[0]).toMatchObject({ expected: "EUR", actual: "RON" });
  });
});

describe("DATE_OUTSIDE_VALIDITY", () => {
  it.each([
    { date: "2026-06-01", grace: 0, flagged: false },
    { date: "2025-12-31", grace: 0, flagged: true },
    { date: "2027-01-10", grace: 0, flagged: true },
    { date: "2027-01-10", grace: 15, flagged: false },
  ])("$date with $grace grace days → flagged=$flagged", ({ date, grace, flagged }) => {
    const c = ctx({ invoice: invoice({ issueDate: date }) });
    expect(dateOutsideValidity.evaluate(c, { graceDays: grace }).length > 0).toBe(flagged);
  });

  it("open-ended validity never fires on the open side", () => {
    const c = ctx({ agreement: agreement({ validity: { from: "2026-01-01" } }), invoice: invoice({ issueDate: "2030-01-01" }) });
    expect(dateOutsideValidity.evaluate(c, { graceDays: 0 })).toEqual([]);
  });
});

describe("ITEM_NOT_COVERED", () => {
  it("one issue per unmatched line", () => {
    const c = ctx({
      invoice: invoice({ lines: [line(), line({ lineNo: 2, description: "Transport" })] }),
      lineMatches: [
        { lineNo: 1, termId: "t1", method: "exact", confidence: 1 },
        { lineNo: 2, termId: null, method: "none", confidence: 0 },
      ],
    });
    expect(itemNotCovered.evaluate(c, {})).toEqual([{ lineNo: 2, actual: "Transport", params: { net: "3000.00" } }]);
  });

  it("does not fire when there is no agreement (NO_MATCHING_AGREEMENT covers it)", () => {
    expect(itemNotCovered.evaluate(ctx({ agreement: null, lineMatches: [] }), {})).toEqual([]);
  });
});
